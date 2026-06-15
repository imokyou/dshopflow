"""商品 → Shopify 同步服务（商品管理模块）。
有有效店铺 access_token 则调真实 Shopify API；否则模拟成功（生成假 shopify_id）。
不涉及选品池。
"""
import random
from datetime import datetime, timezone
from app.integrations.shopify.client import ShopifyClient


def _utcnow():
    return datetime.now(timezone.utc)


def _fake_id() -> int:
    return random.randint(10_000_000_000, 99_999_999_999)


def build_shopify_payload(product, status: str) -> dict:
    """把本地 Product 组装成 Shopify product payload"""
    options = product.options or []
    variants = product.variants or []
    images = product.images or []

    sh_options = []
    for o in options:
        if isinstance(o, dict) and o.get("name"):
            sh_options.append({"name": o["name"], "values": o.get("values") or []})
    if not sh_options:
        sh_options = [{"name": "Title", "values": ["Default Title"]}]

    sh_variants = []
    for v in (variants or []):
        if not isinstance(v, dict):
            continue
        item = {}
        if v.get("option1"):
            item["option1"] = str(v["option1"])
        if v.get("option2"):
            item["option2"] = str(v["option2"])
        if v.get("option3"):
            item["option3"] = str(v["option3"])
        if not item:
            item["option1"] = "Default Title"
        if v.get("price") is not None:
            item["price"] = str(v["price"])
        if v.get("compare_at_price"):
            item["compare_at_price"] = str(v["compare_at_price"])
        if v.get("sku"):
            item["sku"] = v["sku"]
        if v.get("barcode"):
            item["barcode"] = v["barcode"]
        item["inventory_quantity"] = int(v.get("inventory_quantity") or 0)
        sh_variants.append(item)
    if not sh_variants:
        sh_variants = [{"option1": "Default Title", "price": str(product.price or "0.00")}]

    sh_images = []
    for i, im in enumerate(images or []):
        src = im.get("src") if isinstance(im, dict) else im
        if src and str(src).startswith("http"):
            entry = {"src": src, "position": i + 1}
            if isinstance(im, dict) and im.get("alt"):
                entry["alt"] = im["alt"]
            sh_images.append(entry)

    payload = {
        "title": (product.title or product.title_en or product.title_cn or "Untitled")[:255],
        "body_html": product.body_html or "",
        "vendor": product.vendor or "DropShipFlow",
        "status": status,  # active | draft | archived
        "options": sh_options,
        "variants": sh_variants,
    }
    if product.product_type:
        payload["product_type"] = product.product_type
    if product.tags:
        payload["tags"] = product.tags
    if sh_images:
        payload["images"] = sh_images
    return payload


async def sync_to_shopify(db, product, shop, status: str) -> dict:
    """把商品以指定 status 推到 Shopify（创建或更新），无店铺凭证则模拟。"""
    payload = build_shopify_payload(product, status)
    mocked = True

    if shop and getattr(shop, "shop_domain", None) and getattr(shop, "access_token_encrypted", None):
        client = ShopifyClient(shop.shop_domain, shop.access_token_encrypted)
        try:
            if product.shopify_product_id:
                # 更新：基本字段 + status（变体/图片更新较复杂，这里同步主字段与状态）
                fields = {k: payload[k] for k in ("title", "body_html", "vendor", "status", "product_type", "tags") if k in payload}
                res = await client.update_product(int(product.shopify_product_id), fields)
            else:
                res = await client.create_product_raw(payload)
            sp = (res or {}).get("product", {})
            if sp.get("id"):
                product.shopify_product_id = sp["id"]
            if sp.get("handle"):
                product.shopify_handle = sp["handle"]
            product.shop_id = shop.id
            mocked = False
        except Exception as e:
            raise RuntimeError(f"Shopify 同步失败: {e}")

    if mocked and not product.shopify_product_id:
        product.shopify_product_id = _fake_id()

    product.status = status
    product.shopify_synced_at = _utcnow()
    await db.commit()
    await db.refresh(product)
    return {
        "mocked": mocked,
        "status": product.status,
        "shopify_product_id": product.shopify_product_id,
        "shopify_handle": product.shopify_handle,
    }
