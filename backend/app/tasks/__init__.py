"""Celery 异步任务 — 导入管道各步骤。

提供两种模式：
1. run_pipeline(task_id) — 单个编排任务，串联全流程
2. 分步任务 — translate / download_images / process_images / calculate_price / sync_shopify

任务通过 Celery chain 串联，每步自动更新 ImportTask 状态。
"""
import asyncio
import logging
from datetime import datetime, timezone

from app.tasks.celery_app import celery_app
from app.database import async_session
from app.models import ImportTask, Shop
from app.services.image_service import image_service
from app.services.pricing_service import PricingEngine
from app.services.pipeline_service import Pipeline
from app.integrations.llm.provider_router import ProviderRouter
from app.integrations.shopify.client import ShopifyClient
from app.integrations.comfyui.client import ComfyUIClient

logger = logging.getLogger(__name__)


# ── 编排任务（推荐：一键全流程）──

@celery_app.task(bind=True, max_retries=2, default_retry_delay=60)
def run_pipeline(self, import_task_id: str):
    """执行完整导入管道：翻译 → 下载图片 → 处理 → 定价 → 上架"""
    try:
        return asyncio.run(Pipeline.run_sync(import_task_id))
    except Exception as exc:
        logger.error(f"Pipeline failed for task {import_task_id}: {exc}")
        # Update task status to failed
        async def _mark_failed():
            async with async_session() as db:
                task = await db.get(ImportTask, import_task_id)
                if task:
                    task.status = "failed"
                    task.error_message = str(exc)
                    await db.commit()

        asyncio.run(_mark_failed())
        raise self.retry(exc=exc)


# ── 分步任务（可独立调用或手动 chaining）──

@celery_app.task(bind=True, max_retries=2, default_retry_delay=30)
def translate_task(self, import_task_id: str):
    """AI 翻译商品文本"""

    async def _run():
        async with async_session() as db:
            task = await db.get(ImportTask, import_task_id)
            if not task or not task.raw_data:
                return {"status": "skipped", "reason": "no data"}

            raw = task.raw_data
            router = ProviderRouter(category="text")
            prompt = Pipeline._build_translation_prompt(
                raw.get("title", ""), raw.get("description", "")
            )
            result_raw = await router.call(db, prompt)
            translated = Pipeline._parse_translation(
                result_raw, raw.get("title", ""), raw.get("description", "")
            )
            task.translated_data = translated
            task.status = "translated"
            await db.commit()
            return {"status": "ok", "title_en": translated.get("title_en", "")[:50]}

    return asyncio.run(_run())


@celery_app.task(bind=True, max_retries=2, default_retry_delay=30)
def download_images_task(self, import_task_id: str):
    """下载 1688 商品图片"""

    async def _run():
        async with async_session() as db:
            task = await db.get(ImportTask, import_task_id)
            if not task or not task.raw_data:
                return {"status": "skipped"}

            urls = task.raw_data.get("images", [])
            if not urls:
                task.status = "images_downloaded"
                task.processed_images = {"original": [], "downloaded": []}
                await db.commit()
                return {"status": "skipped", "reason": "no images"}

            downloaded = await image_service.download_batch(urls, f"import_{import_task_id}")
            task.processed_images = {
                "original": urls,
                "downloaded": [d for d in downloaded if d.get("local_path")],
                "errors": [d for d in downloaded if d.get("error")],
            }
            task.status = "images_downloaded"
            task.progress = 30
            await db.commit()
            return {"status": "ok", "count": len([d for d in downloaded if d.get("local_path")])}

    return asyncio.run(_run())


@celery_app.task(bind=True, max_retries=1, default_retry_delay=60)
def process_images_task(self, import_task_id: str):
    """ComfyUI 图片处理（去水印、白底图）"""

    async def _run():
        async with async_session() as db:
            task = await db.get(ImportTask, import_task_id)
            if not task:
                return {"status": "skipped"}

            existing = task.processed_images or {}
            downloaded = existing.get("downloaded", [])

            if not downloaded:
                task.status = "images_processed"
                task.progress = 50
                await db.commit()
                return {"status": "skipped", "reason": "no downloaded images"}

            # Try ComfyUI
            comfyui = ComfyUIClient()
            try:
                healthy = await comfyui.health_check()
            except Exception:
                healthy = False

            result = {
                "processed": [d.get("public_url", d.get("url", "")) for d in downloaded],
                "comfyui_available": healthy,
                "skipped": not healthy,
                "note": "ComfyUI not available, using original images" if not healthy else "processed",
            }

            existing["result"] = result
            task.processed_images = existing
            task.status = "images_processed"
            task.progress = 50
            await db.commit()
            return result

    return asyncio.run(_run())


@celery_app.task(bind=True, max_retries=1)
def calculate_price_task(self, import_task_id: str):
    """定价计算"""

    async def _run():
        async with async_session() as db:
            task = await db.get(ImportTask, import_task_id)
            if not task:
                return {"status": "skipped"}

            raw = task.raw_data or {}
            skus = raw.get("skus", [])
            engine = PricingEngine(task.team_id)
            await engine.load_rules(db)
            base, sku_results = engine.calculate_skus(skus)

            pricing_result = {"base": base, "skus": sku_results, "exchange_rate": engine.exchange_rate}
            task.pricing_result = pricing_result
            task.status = "price_calculated"
            task.progress = 70
            await db.commit()
            return {"status": "ok", "base_price": base.get("final_price")}

    return asyncio.run(_run())


@celery_app.task(bind=True, max_retries=3, default_retry_delay=30)
def sync_shopify_task(self, import_task_id: str):
    """同步到 Shopify"""

    async def _run():
        async with async_session() as db:
            task = await db.get(ImportTask, import_task_id)
            if not task:
                return {"status": "skipped"}

            shop = await db.get(Shop, task.shop_id)
            if not shop:
                task.status = "failed"
                task.error_message = "Shop not found"
                await db.commit()
                return {"status": "error", "reason": "shop not found"}

            from app.core.crypto import decrypt_secret
            shopify = ShopifyClient(shop.shop_domain, decrypt_secret(shop.access_token_encrypted))
            raw = task.raw_data or {}
            translated = task.translated_data or {}
            pricing = task.pricing_result or {}
            processed = (task.processed_images or {}).get("result", {})

            base_price = pricing.get("base", {})
            title_en = translated.get("title_en") or raw.get("title", "Imported")
            desc_en = translated.get("description_en", "")
            bullet_points = translated.get("bullet_points", [])

            desc_html = f"<p>{desc_en}</p>"
            if bullet_points:
                desc_html += "<ul>" + "".join(f"<li>{bp}</li>" for bp in bullet_points) + "</ul>"

            # Create product
            result = await shopify.create_product(
                title=title_en[:255],
                body_html=desc_html,
                vendor="DropShipFlow",
                options=[{"name": "Title"}],
            )
            product_id = result["product"]["id"]
            product_url = f"https://admin.shopify.com/store/products/{product_id}"

            # Create variants
            for sku in pricing.get("skus", []):
                sp = sku.get("pricing", {})
                await shopify.create_variant(
                    product_id=product_id,
                    option1=sku.get("spec", "Default"),
                    price=str(sp.get("final_price", base_price.get("final_price", "0.00"))),
                    sku=sku.get("sku") or None,
                )

            # Upload images
            image_urls = processed.get("processed", [])
            if not image_urls:
                dl = task.processed_images or {}
                image_urls = [d.get("public_url", d.get("url", "")) for d in dl.get("downloaded", [])]

            for i, img_url in enumerate(image_urls):
                if img_url and img_url.startswith("http"):
                    try:
                        await shopify.create_image(product_id, img_url, position=i + 1)
                    except Exception:
                        continue

            # Update task
            task.shopify_product_id = product_id
            task.shopify_product_url = product_url
            task.status = "completed"
            task.progress = 100
            task.completed_at = datetime.now(timezone.utc)

            # Create Product record
            from app.models import Product
            product_record = Product(
                import_task_id=task.id, team_id=task.team_id, user_id=task.user_id,
                shop_id=task.shop_id, shopify_product_id=product_id,
                shopify_handle=result["product"].get("handle", ""),
                title_cn=raw.get("title", ""), title_en=title_en, status="draft",
            )
            db.add(product_record)
            await db.commit()

            return {"status": "ok", "product_id": product_id, "url": product_url}

    return asyncio.run(_run())


# ── Celery Chain: 按顺序串联所有步骤 ──

@celery_app.task
def chain_pipeline(import_task_id: str):
    """创建 Celery chain 执行全流程。

    使用方式：chain_pipeline.delay(task_id)
    等同于手动 chain:
      translate → download_images → process_images → calculate_price → sync_shopify
    """
    from celery import chain as celery_chain

    workflow = celery_chain(
        translate_task.s(import_task_id),
        download_images_task.s(import_task_id),
        process_images_task.s(import_task_id),
        calculate_price_task.s(import_task_id),
        sync_shopify_task.s(import_task_id),
    )
    return workflow.apply_async()
