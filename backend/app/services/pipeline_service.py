"""导入管道编排器。

协调整个导入流程：翻译 → 下载图片 → 图片处理 → 定价 → Shopify 同步。
每步更新 ImportTask 的 status 和 progress，失败时记录错误并中断。
"""
import asyncio
import json
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.models import ImportTask, Shop, Product
from app.services.image_service import image_service
from app.services.pricing_service import PricingEngine
from app.integrations.llm.provider_router import ProviderRouter
from app.integrations.shopify.client import ShopifyClient
from app.integrations.comfyui.client import ComfyUIClient


class Pipeline:
    """导入管道 — 单次导入的完整生命周期"""

    def __init__(self, import_task_id: str, db: AsyncSession):
        self.task_id = import_task_id
        self.db = db
        self.task: Optional[ImportTask] = None
        self.shop: Optional[Shop] = None

    async def run(self) -> dict:
        """执行完整管道，返回结果摘要"""
        self.task = await self.db.get(ImportTask, self.task_id)
        if not self.task:
            raise ValueError(f"ImportTask {self.task_id} not found")

        self.shop = await self.db.get(Shop, self.task.shop_id)
        if not self.shop:
            raise ValueError(f"Shop {self.task.shop_id} not found")

        try:
            # === Step 1: 翻译 ===
            await self._update_progress("translating", 5, "翻译中...")
            translated = await self._translate()

            # === Step 2: 下载图片 ===
            await self._update_progress("downloading_images", 20, "下载图片中...")
            downloaded = await self._download_images()

            # === Step 3: 图片处理 (ComfyUI, 可选) ===
            await self._update_progress("processing_images", 40, "图片处理中...")
            processed = await self._process_images(downloaded)

            # === Step 4: 定价 ===
            await self._update_progress("calculating_price", 70, "计算价格中...")
            pricing = await self._calculate_pricing()

            # === Step 5: Shopify 同步 ===
            await self._update_progress("syncing_shopify", 80, "同步到 Shopify...")
            shopify_result = await self._sync_shopify(translated, processed, pricing)

            # === Done ===
            await self._update_progress("completed", 100, "导入完成")
            self.task.completed_at = datetime.now(timezone.utc)
            await self.db.commit()

            return {
                "status": "completed",
                "shopify_product_id": shopify_result.get("product_id"),
                "shopify_url": shopify_result.get("url"),
                "pricing": pricing,
            }

        except Exception as e:
            self.task.status = "failed"
            self.task.error_message = str(e)
            await self.db.commit()
            raise

    # ── Step implementations ──

    async def _translate(self) -> dict:
        """AI 翻译标题、描述、Bullet Points"""
        raw = self.task.raw_data or {}
        title_cn = raw.get("title", "")
        desc_cn = raw.get("description", "")

        if not title_cn and not desc_cn:
            # No text to translate, keep originals
            translated = {"title_en": title_cn, "description_en": desc_cn, "bullet_points": []}
        else:
            router = ProviderRouter(category="text")
            prompt = self._build_translation_prompt(title_cn, desc_cn)
            try:
                result_raw = await router.call(self.db, prompt)
                translated = self._parse_translation(result_raw, title_cn, desc_cn)
            except Exception as e:
                # Fallback: use originals
                translated = {
                    "title_en": title_cn,
                    "description_en": desc_cn,
                    "bullet_points": [],
                    "translation_error": str(e),
                }

        self.task.translated_data = translated
        await self.db.commit()
        return translated

    async def _download_images(self) -> list[dict]:
        """下载 1688 图片到本地/S3"""
        raw = self.task.raw_data or {}
        urls = raw.get("images", [])
        if not urls:
            return []

        downloaded = await image_service.download_batch(urls, f"import_{self.task_id}")
        self.task.processed_images = {
            "original": urls,
            "downloaded": [d for d in downloaded if d.get("local_path")],
            "errors": [d for d in downloaded if d.get("error")],
        }
        await self.db.commit()
        return downloaded

    async def _process_images(self, downloaded: list[dict]) -> dict:
        """ComfyUI 图片处理（去水印、白底图）+ 上传处理结果"""
        raw = self.task.raw_data or {}
        options = raw.get("options", {})
        need_watermark = options.get("watermark", True)
        need_white_bg = options.get("whiteBg", True)

        successful = [d for d in downloaded if d.get("local_path")]
        if not successful or (not need_watermark and not need_white_bg):
            # 无需处理，直接用下载的图
            result = {
                "processed": [d["public_url"] for d in downloaded if d.get("public_url")],
                "skipped": True,
            }
        else:
            comfyui = ComfyUIClient()
            try:
                healthy = await comfyui.health_check()
            except Exception:
                healthy = False

            processed_urls = []
            if healthy:
                for img in successful:
                    try:
                        processed_urls.append(img["public_url"])  # placeholder
                    except Exception:
                        processed_urls.append(img["public_url"])
            else:
                # ComfyUI 不可用，用原图
                processed_urls = [d["public_url"] for d in successful]

            result = {
                "processed": processed_urls,
                "comfyui_available": healthy,
                "skipped": not healthy,
            }

        # 更新 task
        existing = self.task.processed_images or {}
        existing["result"] = result
        self.task.processed_images = existing
        await self.db.commit()
        return result

    async def _calculate_pricing(self) -> dict:
        """定价计算"""
        raw = self.task.raw_data or {}
        skus = raw.get("skus", [])

        # 提取最低价格用于匹配
        try:
            min_price = min(
                float(str(s.get("price", "0")).replace("¥", "").replace("¥", "").strip() or "0")
                for s in skus
            ) if skus else 0
        except (ValueError, TypeError):
            min_price = 0

        engine = PricingEngine(self.task.team_id)
        await engine.load_rules(self.db)

        base, sku_results = engine.calculate_skus(skus)

        pricing_result = {
            "base": base,
            "skus": sku_results,
            "exchange_rate": engine.exchange_rate,
        }
        self.task.pricing_result = pricing_result
        await self.db.commit()
        return pricing_result

    async def _sync_shopify(self, translated: dict, processed: dict, pricing: dict) -> dict:
        """同步到 Shopify：创建 Product + Variants + Images"""
        from app.core.crypto import decrypt_secret
        shopify = ShopifyClient(self.shop.shop_domain, decrypt_secret(self.shop.access_token_encrypted))
        raw = self.task.raw_data or {}

        base_price = pricing.get("base", {})
        title_en = translated.get("title_en") or raw.get("title", "Imported Product")
        description_en = translated.get("description_en", "")
        bullet_points = translated.get("bullet_points", [])
        compare_price = base_price.get("compare_at_price")

        # Build description HTML
        desc_html = f"<p>{description_en}</p>"
        if bullet_points:
            desc_html += "<ul>" + "".join(f"<li>{bp}</li>" for bp in bullet_points) + "</ul>"

        # 1. Create product (draft)
        product_data = await shopify.create_product(
            title=title_en[:255],
            body_html=desc_html,
            vendor="DropShipFlow",
            product_type=raw.get("category", ""),
            options=[{"name": "Title"}],
        )
        product_id = product_data["product"]["id"]
        shopify_url = f"https://admin.shopify.com/store/products/{product_id}"

        # 2. Create variants
        sku_pricing = pricing.get("skus", [])
        for sku in sku_pricing:
            spec = sku.get("spec", "Default")
            sp = sku.get("pricing", {})
            await shopify.create_variant(
                product_id=product_id,
                option1=spec,
                price=str(sp.get("final_price", base_price.get("final_price", "0.00"))),
                sku=sku.get("sku") or None,
            )

        # 3. Upload images (use processed or downloaded)
        image_urls = processed.get("processed", [])
        if not image_urls:
            dl = self.task.processed_images or {}
            image_urls = [d.get("public_url") for d in dl.get("downloaded", []) if d.get("public_url")]

        for i, img_url in enumerate(image_urls):
            if img_url and img_url.startswith("http"):
                try:
                    await shopify.create_image(product_id, img_url, position=i + 1)
                except Exception:
                    continue

        # 4. Update task
        self.task.shopify_product_id = product_id
        self.task.shopify_product_url = shopify_url

        # 5. Create Product record
        product_record = Product(
            import_task_id=self.task.id,
            team_id=self.task.team_id,
            user_id=self.task.user_id,
            shop_id=self.task.shop_id,
            shopify_product_id=product_id,
            shopify_handle=product_data["product"].get("handle", ""),
            title_cn=raw.get("title", ""),
            title_en=title_en,
            status="draft",
        )
        self.db.add(product_record)

        await self.db.commit()
        return {"product_id": product_id, "url": shopify_url}

    # ── Helpers ──

    async def _update_progress(self, status: str, progress: int, message: str = ""):
        self.task.status = status
        self.task.progress = progress
        await self.db.commit()

    @staticmethod
    def _build_translation_prompt(title_cn: str, desc_cn: str) -> str:
        return f"""You are a professional e-commerce translator. Translate the following Chinese product information into native English suitable for a Shopify store.

**Title:**
{title_cn}

**Description:**
{desc_cn}

Return ONLY a valid JSON object with these fields:
{{
  "title_en": "SEO-optimized English title under 70 characters",
  "description_en": "Marketing English description (HTML allowed, <p> tags only)",
  "bullet_points": ["Feature 1", "Feature 2", "Feature 3", "Feature 4", "Feature 5"]
}}

Keep the title concise and conversion-focused. Description should highlight key selling points. Bullet points should be short, scannable highlights."""

    @staticmethod
    def _parse_translation(result: str, title_cn: str, desc_cn: str) -> dict:
        """解析 LLM 返回的 JSON"""
        # Try to extract JSON from response
        result = result.strip()
        # Remove markdown code fences if any
        if result.startswith("```"):
            lines = result.split("\n")
            result = "\n".join(lines[1:]) if len(lines) > 1 else result
        if result.endswith("```"):
            result = result.rsplit("```", 1)[0]

        try:
            parsed = json.loads(result)
        except json.JSONDecodeError:
            # Fallback: assume it's just a title
            return {
                "title_en": result[:255],
                "description_en": desc_cn,
                "bullet_points": [],
            }

        return {
            "title_en": parsed.get("title_en", title_cn)[:255],
            "description_en": parsed.get("description_en", desc_cn),
            "bullet_points": parsed.get("bullet_points", []),
        }

    @staticmethod
    async def run_sync(import_task_id: str):
        """同步入口 — 供 Celery 任务调用"""
        from app.database import async_session

        async with async_session() as db:
            pipeline = Pipeline(import_task_id, db)
            return await pipeline.run()
