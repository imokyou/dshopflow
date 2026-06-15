"""选品池 API — V2 分段管道入口"""
import json
import threading
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, exists
from sqlalchemy.orm import joinedload
from pydantic import BaseModel
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, ProductPool, ProductDetail, ProductTranslation, TaskLog, Product
from app.core.permissions import require, Permission

router = APIRouter(prefix="/product-pool", tags=["product-pool"])


# ═══════════════════════════════════════════
# 请求模型
# ═══════════════════════════════════════════

class ProductCaptureRequest(BaseModel):
    """插件抓取入库请求"""
    team_id: str
    offer_id: str
    source_url: str = ""
    title_cn: str = ""
    main_image_url: str = ""
    cost_price: float = 0.0
    sku_count: int = 0
    image_count: int = 0
    desc_cn: str = ""
    images: list = []
    skus: list = []
    attrs: list = []


class TranslateRequest(BaseModel):
    language: str = "en"


class BatchTranslateRequest(BaseModel):
    ids: list[str]
    language: str = "en"


class UpdateTranslationRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    bullet_points: list | None = None


class PriceRequest(BaseModel):
    """手动调整售价"""
    final_price: float | None = None
    compare_at_price: float | None = None
    pricing_rule_name: str | None = None
    exchange_rate: float | None = None
    markup: float | None = None


class BatchPriceRequest(BaseModel):
    ids: list[str]


# ═══════════════════════════════════════════
# 选品池 CRUD
# ═══════════════════════════════════════════

@router.post("", status_code=201)
async def capture_product(
    req: ProductCaptureRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.IMPORT_PRODUCT),
):
    team_id = req.team_id

    existing = await db.scalar(
        select(ProductPool).where(
            ProductPool.team_id == team_id,
            ProductPool.offer_id == req.offer_id,
        )
    )

    if existing:
        existing.source_url = req.source_url or existing.source_url
        existing.title_cn = req.title_cn or existing.title_cn
        existing.main_image_url = req.main_image_url or existing.main_image_url
        existing.cost_price = req.cost_price
        existing.sku_count = req.sku_count
        existing.image_count = req.image_count
        existing.status = "captured"
        existing.error_message = None

        detail = await db.scalar(
            select(ProductDetail).where(ProductDetail.product_pool_id == existing.id)
        )
        if detail:
            if req.desc_cn:
                detail.desc_cn = req.desc_cn
            if req.images:
                detail.images = req.images
            if req.skus:
                detail.skus = req.skus
            if req.attrs:
                detail.attrs = req.attrs

        await db.commit()
        await db.refresh(existing)
        return {"id": existing.id, "offer_id": existing.offer_id, "status": existing.status, "updated": True}

    pool = ProductPool(
        team_id=team_id, user_id=current_user.id,
        offer_id=req.offer_id, source_url=req.source_url,
        title_cn=req.title_cn, main_image_url=req.main_image_url,
        cost_price=req.cost_price, sku_count=req.sku_count, image_count=req.image_count,
        status="captured",
    )
    db.add(pool)
    await db.flush()

    detail = ProductDetail(
        product_pool_id=pool.id,
        desc_cn=req.desc_cn, images=req.images, skus=req.skus, attrs=req.attrs,
    )
    db.add(detail)
    await db.commit()
    await db.refresh(pool)

    return {"id": pool.id, "offer_id": pool.offer_id, "status": pool.status, "updated": False}


@router.get("")
async def list_pool(
    team_id: str | None = Query(None),
    status: str | None = Query(None),
    search: str | None = Query(None),
    transferred: str | None = Query(None),  # "true" | "false" 是否已转入商品
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ProductPool)

    if current_user.role != "super_admin":
        stmt = stmt.where(ProductPool.team_id == current_user.team_id)
    elif team_id:
        stmt = stmt.where(ProductPool.team_id == team_id)

    if status:
        stmt = stmt.where(ProductPool.status == status)
    if search:
        stmt = stmt.where(or_(ProductPool.title_cn.ilike(f"%{search}%"), ProductPool.offer_id.ilike(f"%{search}%")))

    # 是否已转入商品（products.source_pool_id 存在）
    transferred_exists = exists().where(Product.source_pool_id == ProductPool.id)
    if transferred == "true":
        stmt = stmt.where(transferred_exists)
    elif transferred == "false":
        stmt = stmt.where(~transferred_exists)

    count_q = select(func.count()).select_from(stmt.subquery())
    total = await db.scalar(count_q)

    stmt = stmt.order_by(ProductPool.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
    rows = list(await db.scalars(stmt))

    # 批量查出本页哪些已转入
    ids = [r.id for r in rows]
    transferred_ids: set[str] = set()
    if ids:
        res = await db.scalars(select(Product.source_pool_id).where(Product.source_pool_id.in_(ids)))
        transferred_ids = {x for x in res if x}

    return {
        "items": [
            {
                "id": r.id, "offer_id": r.offer_id, "source_url": r.source_url, "title_cn": r.title_cn,
                "main_image_url": r.main_image_url, "cost_price": r.cost_price, "sku_count": r.sku_count,
                "image_count": r.image_count, "final_price": r.final_price, "compare_at_price": r.compare_at_price,
                "pricing_rule_name": r.pricing_rule_name, "status": r.status, "error_message": r.error_message,
                "transferred": r.id in transferred_ids,
                "created_at": (r.created_at.isoformat() + "+00:00") if r.created_at else None,
                "updated_at": (r.updated_at.isoformat() + "+00:00") if r.updated_at else None,
            }
            for r in rows
        ],
        "total": total, "page": page, "page_size": page_size,
    }


@router.get("/{pool_id}")
async def get_pool_detail(
    pool_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pool = await db.scalar(
        select(ProductPool).where(ProductPool.id == pool_id).options(
            joinedload(ProductPool.detail),
            joinedload(ProductPool.translations),
            joinedload(ProductPool.task_logs),
        )
    )
    if not pool:
        raise HTTPException(status_code=404)
    if current_user.role != "super_admin" and pool.team_id != current_user.team_id:
        raise HTTPException(status_code=403)

    def ts(dt): return (dt.isoformat() + "+00:00") if dt else None

    return {
        "id": pool.id, "team_id": pool.team_id, "offer_id": pool.offer_id, "source_url": pool.source_url,
        "title_cn": pool.title_cn, "main_image_url": pool.main_image_url, "cost_price": pool.cost_price,
        "sku_count": pool.sku_count, "image_count": pool.image_count,
        "final_price": pool.final_price, "compare_at_price": pool.compare_at_price,
        "pricing_rule_name": pool.pricing_rule_name, "exchange_rate": pool.exchange_rate, "markup": pool.markup,
        "status": pool.status, "error_message": pool.error_message,
        "created_at": ts(pool.created_at), "updated_at": ts(pool.updated_at),
        "detail": {
            "desc_cn": pool.detail.desc_cn,
            "images": pool.detail.images or [],
            "skus": pool.detail.skus or [],
            "attrs": pool.detail.attrs or [],
        } if pool.detail else None,
        "translations": [
            {"id": t.id, "language": t.language, "title": t.title, "description": t.description, "bullet_points": t.bullet_points or []}
            for t in (pool.translations or [])
        ],
        "task_logs": [
            {"id": l.id, "task_type": l.task_type, "status": l.status, "language": l.language,
             "image_index": l.image_index, "message": l.message, "result": l.result,
             "retry_count": l.retry_count, "started_at": ts(l.started_at),
             "completed_at": ts(l.completed_at), "created_at": ts(l.created_at)}
            for l in (pool.task_logs or [])
        ],
    }


@router.delete("/{pool_id}")
async def delete_pool(
    pool_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.DELETE_PRODUCT),
):
    pool = await db.get(ProductPool, pool_id)
    if not pool:
        raise HTTPException(status_code=404)
    if current_user.role != "super_admin" and pool.team_id != current_user.team_id:
        raise HTTPException(status_code=403)

    await db.delete(pool)
    await db.commit()
    return {"deleted": True}


# ═══════════════════════════════════════════
# 翻译（分段1）
# ═══════════════════════════════════════════

def _build_translation_prompt(title_cn: str, desc_cn: str, target_lang: str) -> str:
    lang_name = {"en": "English", "de": "German", "fr": "French", "es": "Spanish", "ja": "Japanese"}
    name = lang_name.get(target_lang, target_lang)
    return f"""You are a professional e-commerce translator. Translate the following Chinese product information into native {name} suitable for a Shopify store.

**Title:**
{title_cn}

**Description:**
{desc_cn}

Return ONLY a valid JSON object with these fields:
{{
  "title": "SEO-optimized title under 70 characters",
  "description": "Marketing description (HTML allowed, <p> tags only)",
  "bullet_points": ["Feature 1", "Feature 2", "Feature 3", "Feature 4", "Feature 5"]
}}"""


def _parse_translation_result(result: str, title_cn: str, desc_cn: str) -> dict:
    result = result.strip()
    if result.startswith("```"):
        lines = result.split("\n")
        result = "\n".join(lines[1:]) if len(lines) > 1 else result
    if result.endswith("```"):
        result = result.rsplit("```", 1)[0]
    try:
        parsed = json.loads(result)
    except json.JSONDecodeError:
        return {"title": title_cn[:255], "description": desc_cn, "bullet_points": []}
    return {
        "title": parsed.get("title", title_cn)[:255],
        "description": parsed.get("description", desc_cn),
        "bullet_points": parsed.get("bullet_points", []),
    }


def _run_translation(pool_id: str, language: str):
    """在独立线程中执行翻译"""
    from app.database import async_session

    async def _do():
        async with async_session() as db:
            from app.integrations.llm.provider_router import ProviderRouter

            pool = await db.get(ProductPool, pool_id)
            if not pool:
                return

            # Create task log
            log = TaskLog(product_pool_id=pool_id, task_type="translate", status="running", language=language,
                          started_at=datetime.now(timezone.utc))
            db.add(log)

            # Update pool status
            pool.status = "translating"
            await db.flush()

            try:
                detail = await db.scalar(select(ProductDetail).where(ProductDetail.product_pool_id == pool_id))
                title_cn = pool.title_cn or ""
                desc_cn = detail.desc_cn if detail else ""

                if not title_cn and not desc_cn:
                    translated = {"title": title_cn, "description": desc_cn, "bullet_points": []}
                else:
                    router = ProviderRouter(category="text")
                    prompt = _build_translation_prompt(title_cn, desc_cn, language)
                    try:
                        raw = await router.call(db, prompt)
                        translated = _parse_translation_result(raw, title_cn, desc_cn)
                    except Exception as e:
                        translated = {"title": title_cn, "description": desc_cn, "bullet_points": [],
                                      "translation_error": str(e)}

                # Upsert translation
                existing = await db.scalar(
                    select(ProductTranslation).where(
                        ProductTranslation.product_pool_id == pool_id,
                        ProductTranslation.language == language,
                    )
                )
                if existing:
                    existing.title = translated["title"]
                    existing.description = translated["description"]
                    existing.bullet_points = translated.get("bullet_points", [])
                else:
                    t = ProductTranslation(
                        product_pool_id=pool_id, language=language,
                        title=translated["title"], description=translated["description"],
                        bullet_points=translated.get("bullet_points", []),
                    )
                    db.add(t)

                # Update log
                log.status = "completed"
                log.result = translated
                log.completed_at = datetime.now(timezone.utc)
                pool.status = "translated"

            except Exception as e:
                log.status = "failed"
                log.message = str(e)
                pool.status = "captured"
                pool.error_message = str(e)

            await db.commit()

    asyncio = __import__("asyncio")
    asyncio.run(_do())


@router.post("/{pool_id}/translate", status_code=202)
async def trigger_translate(
    pool_id: str,
    req: TranslateRequest = TranslateRequest(),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.IMPORT_PRODUCT),
):
    pool = await db.get(ProductPool, pool_id)
    if not pool:
        raise HTTPException(status_code=404)
    if current_user.role != "super_admin" and pool.team_id != current_user.team_id:
        raise HTTPException(status_code=403)

    thread = threading.Thread(target=lambda: _run_translation(pool_id, req.language), daemon=True)
    thread.start()
    return {"message": f"Translation to {req.language} started", "pool_id": pool_id}


@router.put("/{pool_id}/translate/{lang}")
async def update_translation(
    pool_id: str, lang: str, req: UpdateTranslationRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.EDIT_PRODUCT),
):
    t = await db.scalar(
        select(ProductTranslation).where(
            ProductTranslation.product_pool_id == pool_id,
            ProductTranslation.language == lang,
        )
    )
    if not t:
        raise HTTPException(status_code=404, detail=f"No translation for language '{lang}'")

    if req.title is not None:
        t.title = req.title
    if req.description is not None:
        t.description = req.description
    if req.bullet_points is not None:
        t.bullet_points = req.bullet_points
    await db.commit()
    await db.refresh(t)
    return {"id": t.id, "language": t.language, "title": t.title}


@router.post("/batch-translate", status_code=202)
async def batch_translate(
    req: BatchTranslateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.IMPORT_PRODUCT),
):
    for pid in req.ids:
        pool = await db.get(ProductPool, pid)
        if not pool:
            continue
        if current_user.role != "super_admin" and pool.team_id != current_user.team_id:
            continue
        thread = threading.Thread(target=lambda p=pid, l=req.language: _run_translation(p, l), daemon=True)
        thread.start()

    return {"message": f"Batch translation started for {len(req.ids)} items"}


# ═══════════════════════════════════════════
# 定价（分段1）
# ═══════════════════════════════════════════

def _run_pricing(pool_id: str):
    import asyncio as _asyncio
    from app.database import async_session
    from app.services.pricing_service import PricingEngine

    async def _do():
        async with async_session() as db:
            pool = await db.get(ProductPool, pool_id)
            if not pool:
                return

            log = TaskLog(product_pool_id=pool_id, task_type="pricing", status="running",
                          started_at=datetime.now(timezone.utc))
            db.add(log)
            pool.status = "pricing"
            await db.flush()

            try:
                detail = await db.scalar(select(ProductDetail).where(ProductDetail.product_pool_id == pool_id))
                skus = detail.skus if detail else []

                engine = PricingEngine(pool.team_id)
                await engine.load_rules(db)
                base, sku_results = engine.calculate_skus(skus)

                pool.final_price = base.get("final_price")
                pool.compare_at_price = base.get("compare_at_price")
                pool.pricing_rule_name = base.get("rule_name")
                pool.exchange_rate = engine.exchange_rate
                pool.markup = base.get("markup")
                pool.status = "priced"

                log.status = "completed"
                log.result = {"base": base, "skus": sku_results}
                log.completed_at = datetime.now(timezone.utc)

            except Exception as e:
                log.status = "failed"
                log.message = str(e)
                pool.status = "captured"
                pool.error_message = str(e)

            await db.commit()

    _asyncio.run(_do())


@router.post("/{pool_id}/price", status_code=202)
async def trigger_pricing(
    pool_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.IMPORT_PRODUCT),
):
    pool = await db.get(ProductPool, pool_id)
    if not pool:
        raise HTTPException(status_code=404)
    if current_user.role != "super_admin" and pool.team_id != current_user.team_id:
        raise HTTPException(status_code=403)

    thread = threading.Thread(target=lambda: _run_pricing(pool_id), daemon=True)
    thread.start()
    return {"message": "Pricing started", "pool_id": pool_id}


@router.put("/{pool_id}/price")
async def update_price(
    pool_id: str, req: PriceRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.EDIT_PRODUCT),
):
    pool = await db.get(ProductPool, pool_id)
    if not pool:
        raise HTTPException(status_code=404)
    if current_user.role != "super_admin" and pool.team_id != current_user.team_id:
        raise HTTPException(status_code=403)

    if req.final_price is not None:
        pool.final_price = req.final_price
    if req.compare_at_price is not None:
        pool.compare_at_price = req.compare_at_price
    if req.pricing_rule_name is not None:
        pool.pricing_rule_name = req.pricing_rule_name
    if req.exchange_rate is not None:
        pool.exchange_rate = req.exchange_rate
    if req.markup is not None:
        pool.markup = req.markup

    await db.commit()
    await db.refresh(pool)
    return {"id": pool.id, "final_price": pool.final_price, "compare_at_price": pool.compare_at_price}


@router.post("/batch-price", status_code=202)
async def batch_pricing(
    req: BatchPriceRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.IMPORT_PRODUCT),
):
    for pid in req.ids:
        pool = await db.get(ProductPool, pid)
        if not pool:
            continue
        if current_user.role != "super_admin" and pool.team_id != current_user.team_id:
            continue
        thread = threading.Thread(target=lambda p=pid: _run_pricing(p), daemon=True)
        thread.start()

    return {"message": f"Batch pricing started for {len(req.ids)} items"}


# ═══════════════════════════════════════════
# 任务日志
# ═══════════════════════════════════════════

@router.get("/{pool_id}/tasks")
async def get_task_logs(
    pool_id: str,
    task_type: str | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    pool = await db.get(ProductPool, pool_id)
    if not pool:
        raise HTTPException(status_code=404)
    if current_user.role != "super_admin" and pool.team_id != current_user.team_id:
        raise HTTPException(status_code=403)

    stmt = select(TaskLog).where(TaskLog.product_pool_id == pool_id)
    if task_type:
        stmt = stmt.where(TaskLog.task_type == task_type)
    stmt = stmt.order_by(TaskLog.created_at.desc())

    logs = await db.scalars(stmt)
    return [
        {
            "id": l.id, "task_type": l.task_type, "status": l.status, "language": l.language,
            "image_index": l.image_index, "message": l.message, "result": l.result,
            "retry_count": l.retry_count,
            "started_at": (l.started_at.isoformat() + "+00:00") if l.started_at else None,
            "completed_at": (l.completed_at.isoformat() + "+00:00") if l.completed_at else None,
            "created_at": (l.created_at.isoformat() + "+00:00") if l.created_at else None,
        }
        for l in logs
    ]


@router.post("/{pool_id}/tasks/{task_id}/retry", status_code=202)
async def retry_task(
    pool_id: str, task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.IMPORT_PRODUCT),
):
    log = await db.get(TaskLog, task_id)
    if not log or log.product_pool_id != pool_id:
        raise HTTPException(status_code=404)

    log.status = "pending"
    log.retry_count = (log.retry_count or 0) + 1
    log.message = None
    log.result = {}
    await db.commit()

    # Retrigger based on task_type
    if log.task_type == "translate":
        lang = log.language or "en"
        thread = threading.Thread(target=lambda: _run_translation(pool_id, lang), daemon=True)
        thread.start()
    elif log.task_type == "pricing":
        thread = threading.Thread(target=lambda: _run_pricing(pool_id), daemon=True)
        thread.start()
    else:
        raise HTTPException(status_code=400, detail=f"Retry not supported for task type '{log.task_type}'")

    return {"message": f"Retry started for {log.task_type} task", "retry_count": log.retry_count}
