from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, ImportTask, Shop
from app.core.permissions import require, Permission, get_current_team_or_raise, QuotaChecker

router = APIRouter(prefix="/imports", tags=["imports"])


class CreateImportRequest(BaseModel):
    team_id: str
    shop_id: str
    source_url: str
    offer_id: str | None = None
    raw_data: dict = {}


class ProcessImportRequest(BaseModel):
    mode: str = "celery"  # "celery" | "direct"


@router.post("", status_code=201)
async def create_import(
    req: CreateImportRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.IMPORT_PRODUCT),
):
    team = await get_current_team_or_raise(req.team_id, current_user, db)
    checker = QuotaChecker(team)
    if not await checker.check_monthly_import(db):
        raise HTTPException(status_code=403, detail="Monthly import limit reached")
    shop = await db.get(Shop, req.shop_id)
    if not shop or shop.team_id != team.id:
        raise HTTPException(status_code=404, detail="Shop not found in team")
    task = ImportTask(
        team_id=team.id, user_id=current_user.id, shop_id=shop.id,
        source_url=req.source_url, offer_id=req.offer_id, raw_data=req.raw_data,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return {
        "id": task.id,
        "status": task.status,
        "source_url": task.source_url,
    }


@router.get("")
async def list_imports(
    team_id: str | None = None,
    status: str | None = None,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(ImportTask).order_by(ImportTask.created_at.desc()).limit(limit)
    if current_user.role != "super_admin":
        query = query.where(ImportTask.team_id == current_user.team_id)
    elif team_id:
        query = query.where(ImportTask.team_id == team_id)
    if status:
        query = query.where(ImportTask.status == status)
    tasks = await db.scalars(query)
    return [
        {
            "id": t.id,
            "status": t.status,
            "progress": t.progress,
            "source_url": t.source_url,
            "offer_id": t.offer_id,
            "shopify_product_url": t.shopify_product_url,
            "error_message": t.error_message,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "completed_at": t.completed_at.isoformat() if t.completed_at else None,
        }
        for t in tasks
    ]


@router.get("/{task_id}")
async def get_import(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    task = await db.get(ImportTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Import task not found")
    if current_user.role != "super_admin" and task.team_id != current_user.team_id:
        raise HTTPException(status_code=403, detail="Access denied")

    return {
        "id": task.id,
        "team_id": task.team_id,
        "shop_id": task.shop_id,
        "status": task.status,
        "progress": task.progress,
        "source_url": task.source_url,
        "offer_id": task.offer_id,
        "raw_data": task.raw_data,
        "translated_data": task.translated_data,
        "processed_images": task.processed_images,
        "pricing_result": task.pricing_result,
        "shopify_product_id": task.shopify_product_id,
        "shopify_product_url": task.shopify_product_url,
        "error_message": task.error_message,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
    }


@router.post("/{task_id}/process")
async def process_import(
    task_id: str,
    req: ProcessImportRequest = ProcessImportRequest(),
    background_tasks: BackgroundTasks = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """触发导入管道处理"""
    task = await db.get(ImportTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Import task not found")
    if current_user.role != "super_admin" and task.team_id != current_user.team_id:
        raise HTTPException(status_code=403, detail="Access denied")
    if task.status not in ("pending", "failed"):
        raise HTTPException(status_code=400, detail=f"Task already in progress ({task.status})")

    # Reset status
    task.status = "pending"
    task.error_message = None
    await db.commit()

    if req.mode == "direct":
        # 同步模式（开发/无 Redis 环境）：在独立线程中运行
        import threading
        from app.services.pipeline_service import Pipeline

        def _run_in_thread():
            import asyncio
            asyncio.run(Pipeline.run_sync(task_id))

        thread = threading.Thread(target=_run_in_thread, daemon=True)
        thread.start()
        return {"message": "Pipeline started in background", "mode": "direct", "task_id": task_id}
    else:
        # Celery 模式
        from app.tasks import run_pipeline
        celery_task = run_pipeline.delay(task_id)
        task.celery_task_id = celery_task.id
        await db.commit()
        return {"message": "Pipeline queued", "mode": "celery", "celery_task_id": celery_task.id, "task_id": task_id}


@router.get("/{task_id}/status")
async def get_import_status(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """轻量轮询端点 — 只返回 status + progress"""
    task = await db.get(ImportTask, task_id)
    if not task:
        raise HTTPException(status_code=404)
    return {
        "id": task.id,
        "status": task.status,
        "progress": task.progress,
        "error_message": task.error_message,
    }
