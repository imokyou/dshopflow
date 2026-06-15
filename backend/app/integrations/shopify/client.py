import httpx
from typing import Optional


class ShopifyClient:
    def __init__(self, shop_domain: str, access_token: str):
        self.base_url = f"https://{shop_domain}/admin/api/2024-01"
        self.headers = {
            "X-Shopify-Access-Token": access_token,
            "Content-Type": "application/json",
        }

    async def _request(self, method: str, path: str, json: dict = None) -> dict:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.request(method, f"{self.base_url}{path}", json=json, headers=self.headers)
            resp.raise_for_status()
            return resp.json()

    async def create_product(self, title: str, body_html: str, vendor: str = "DropShipFlow",
                             product_type: str = None, tags: str = None, options: list = None) -> dict:
        product_data = {
            "title": title, "body_html": body_html, "vendor": vendor,
            "status": "draft",
        }
        if product_type:
            product_data["product_type"] = product_type
        if tags:
            product_data["tags"] = tags
        if options:
            product_data["options"] = options
        return await self._request("POST", "/products.json", {"product": product_data})

    async def create_variant(self, product_id: int, option1: str = None, option2: str = None,
                             option3: str = None, price: str = None, sku: str = None,
                             inventory_quantity: int = 100) -> dict:
        variant_data = {"product_id": product_id, "requires_shipping": True}
        if option1:
            variant_data["option1"] = option1
        if option2:
            variant_data["option2"] = option2
        if option3:
            variant_data["option3"] = option3
        if price:
            variant_data["price"] = price
        if sku:
            variant_data["sku"] = sku
        variant_data["inventory_quantity"] = inventory_quantity
        return await self._request("POST", f"/products/{product_id}/variants.json", {"variant": variant_data})

    async def create_image(self, product_id: int, image_url: str, variant_ids: list = None, position: int = 1) -> dict:
        image_data = {"src": image_url, "position": position}
        if variant_ids:
            image_data["variant_ids"] = variant_ids
        return await self._request("POST", f"/products/{product_id}/images.json", {"image": image_data})

    async def get_product(self, product_id: int) -> dict:
        return await self._request("GET", f"/products/{product_id}.json")

    async def create_product_raw(self, product: dict) -> dict:
        """用完整 product dict（含 variants/images/options）一次性创建"""
        return await self._request("POST", "/products.json", {"product": product})

    async def update_product(self, product_id: int, fields: dict) -> dict:
        """更新商品基本字段 + status（active/draft/archived）"""
        payload = {"product": {"id": product_id, **fields}}
        return await self._request("PUT", f"/products/{product_id}.json", payload)

    async def delete_product(self, product_id: int) -> dict:
        return await self._request("DELETE", f"/products/{product_id}.json")

    async def update_variant(self, variant_id: int, fields: dict) -> dict:
        payload = {"variant": {"id": variant_id, **fields}}
        return await self._request("PUT", f"/variants/{variant_id}.json", payload)

    async def delete_variant(self, product_id: int, variant_id: int) -> dict:
        return await self._request("DELETE", f"/products/{product_id}/variants/{variant_id}.json")
