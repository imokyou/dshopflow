"""商品 → Shopify 同步服务（商品管理模块）。

走 Shopify Admin **GraphQL**（productSet）：一个 mutation 同时创建/更新 商品+选项+变体+图片+库存，
并回填 Shopify 商品 id 与各变体 variant id（存进本地变体 JSON）。无凭证则明确报错。
"""
import re
from datetime import datetime, timezone

from app.core.crypto import decrypt_secret
from app.integrations.shopify.graphql import ShopifyGraphQL, ShopifyGraphQLError


def _utcnow():
    return datetime.now(timezone.utc)


_STATUS_GQL = {"active": "ACTIVE", "draft": "DRAFT", "archived": "ARCHIVED"}


def _gid_num(gid: str):
    """gid://shopify/Product/123 → 123（int）。"""
    m = re.search(r"/(\d+)$", str(gid or ""))
    return int(m.group(1)) if m else None


PRODUCT_SET = """
mutation productSet($input: ProductSetInput!, $synchronous: Boolean!) {
  productSet(synchronous: $synchronous, input: $input) {
    product {
      id
      handle
      variants(first: 100) { nodes { id sku selectedOptions { name value } } }
    }
    userErrors { field message }
  }
}
"""

LOCATIONS_Q = "query { locations(first: 1) { nodes { id } } }"


async def _primary_location(gql: ShopifyGraphQL):
    try:
        data = await gql.execute(LOCATIONS_Q)
        nodes = ((data.get("locations") or {}).get("nodes")) or []
        return nodes[0]["id"] if nodes else None
    except Exception:
        return None


def _to_product_set_input(product, payload: dict, status: str, location_id: str | None) -> dict:
    """把 build_shopify_payload 的归一化结构转成 GraphQL ProductSetInput。"""
    inp: dict = {
        "title": payload["title"],
        "descriptionHtml": payload.get("body_html") or "",
        "vendor": payload.get("vendor") or "",
        "status": _STATUS_GQL.get(status, "DRAFT"),
    }
    if product.shopify_product_id:
        inp["id"] = f"gid://shopify/Product/{int(product.shopify_product_id)}"
    if payload.get("product_type"):
        inp["productType"] = payload["product_type"]
    if payload.get("tags"):
        inp["tags"] = [t.strip() for t in str(payload["tags"]).split(",") if t.strip()]

    # 真实选项（排除单变体的占位 Title）
    real_opts = [o for o in (payload.get("options") or []) if o.get("name") and o["name"] != "Title"]
    if real_opts:
        inp["productOptions"] = [
            {"name": o["name"], "position": i + 1, "values": [{"name": v} for v in (o.get("values") or [])]}
            for i, o in enumerate(real_opts)
        ]

    variants_in = []
    for v in (payload.get("variants") or []):
        vi: dict = {}
        ov = []
        for idx, o in enumerate(real_opts):
            val = v.get(f"option{idx + 1}")
            if val:
                ov.append({"optionName": o["name"], "name": str(val)})
        if ov:
            vi["optionValues"] = ov
        if v.get("price") is not None:
            vi["price"] = str(v["price"])
        if v.get("compare_at_price"):
            vi["compareAtPrice"] = str(v["compare_at_price"])
        if v.get("sku"):
            vi["sku"] = v["sku"]
        if v.get("barcode"):
            vi["barcode"] = v["barcode"]
        if location_id:
            vi["inventoryQuantities"] = [{
                "locationId": location_id, "name": "available",
                "quantity": int(v.get("inventory_quantity") or 0),
            }]
        variants_in.append(vi)
    if variants_in:
        inp["variants"] = variants_in

    files = []
    for im in (payload.get("images") or []):
        src = im.get("src") if isinstance(im, dict) else im
        if src and str(src).startswith("http"):
            f = {"originalSource": src, "contentType": "IMAGE"}
            if isinstance(im, dict) and im.get("alt"):
                f["alt"] = im["alt"]
            files.append(f)
    if files:
        inp["files"] = files
    return inp


def _backfill_variant_ids(product, nodes: list):
    """把 productSet 返回的变体 variant id 回填到本地变体 JSON（按 SKU 匹配，兜底按选项组合）。"""
    by_sku = {n.get("sku"): n["id"] for n in nodes if n.get("sku")}

    def opt_key(selected):
        return "|".join(f"{o.get('name')}={o.get('value')}" for o in (selected or []))
    by_opts = {opt_key(n.get("selectedOptions")): n["id"] for n in nodes}

    variants = list(product.variants or [])
    opt_names = [o["name"] for o in (product.options or []) if isinstance(o, dict) and o.get("name")]
    for v in variants:
        if not isinstance(v, dict):
            continue
        gid = None
        if v.get("sku") and v["sku"] in by_sku:
            gid = by_sku[v["sku"]]
        else:
            sel = []
            for idx, name in enumerate(opt_names):
                val = v.get(f"option{idx + 1}")
                if val:
                    sel.append({"name": name, "value": str(val)})
            gid = by_opts.get(opt_key(sel))
        if gid:
            v["shopify_variant_id"] = gid
    product.variants = variants


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
    """用 GraphQL productSet 把商品以指定 status 推到 Shopify（创建或更新，全量：选项/变体/图片/库存），
    并回填商品 id 与各变体 variant id。无凭证则明确报错。"""
    if not (shop and getattr(shop, "shop_domain", None) and getattr(shop, "access_token_encrypted", None)):
        raise RuntimeError("未连接可用的 Shopify 店铺，请先在『店铺管理』授权连接后再上架")

    payload = build_shopify_payload(product, status)
    gql = ShopifyGraphQL(shop.shop_domain, decrypt_secret(shop.access_token_encrypted) or "")
    location_id = await _primary_location(gql)
    inp = _to_product_set_input(product, payload, status, location_id)

    try:
        result = await gql.execute_mutation(PRODUCT_SET, {"input": inp, "synchronous": True}, "productSet")
    except ShopifyGraphQLError as e:
        raise RuntimeError(f"Shopify 同步失败: {e}")
    except Exception as e:
        raise RuntimeError(f"Shopify 同步失败: {e}")

    sp = result.get("product") or {}
    if sp.get("id"):
        product.shopify_product_id = _gid_num(sp["id"])
    if sp.get("handle"):
        product.shopify_handle = sp["handle"]
    product.shop_id = shop.id
    _backfill_variant_ids(product, (sp.get("variants") or {}).get("nodes") or [])

    product.status = status
    product.shopify_synced_at = _utcnow()
    await db.commit()
    await db.refresh(product)
    return {
        "status": product.status,
        "shopify_product_id": product.shopify_product_id,
        "shopify_handle": product.shopify_handle,
        "shop_domain": shop.shop_domain,
    }
