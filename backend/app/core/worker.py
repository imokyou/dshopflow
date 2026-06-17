"""统一后台任务 worker。

替代原先「每个任务起一个线程 + asyncio.run 新事件循环 + 新连接」的反模式：
- 单个常驻 asyncio 任务，运行在应用主事件循环内，串行处理任务，避免 SQLite 写锁争用；
- 任务持久化在数据库（TransferJob 转入任务 / TaskLog 翻译·定价），进程重启可恢复，不丢任务；
- 原子认领（UPDATE ... WHERE status='pending' 检查 rowcount）保证多进程/多 worker 下
  同一任务不会被重复处理（修复原布尔锁的多进程竞态）。

唤醒机制：入队后调用 notify() 立即唤醒，空闲时按 POLL_INTERVAL 轮询兜底。
"""
import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select, update

from app.database import async_session
from app.models import TransferJob, TaskLog, Material

logger = logging.getLogger("dropshipflow.worker")

POLL_INTERVAL = 2.0          # 空闲轮询兜底间隔（秒）
INTER_JOB_SLEEP = 0.3        # 任务间小憩，降低 DB/AI 压力
CLAIM_BATCH = 5              # 每次尝试认领的候选数
POOL_TASK_TYPES = ("translate", "pricing")

_wake: asyncio.Event | None = None
_task: asyncio.Task | None = None


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def notify() -> None:
    """入队后唤醒 worker（在事件循环线程内调用）。"""
    if _wake is not None:
        try:
            _wake.set()
        except RuntimeError:
            pass


async def start_worker() -> None:
    """在应用启动时调用一次，拉起常驻 worker 任务。"""
    global _wake, _task
    if _task is not None and not _task.done():
        return
    _wake = asyncio.Event()
    _task = asyncio.create_task(_run_loop(), name="dropshipflow-worker")
    logger.info("background worker started")


async def _run_loop() -> None:
    assert _wake is not None
    while True:
        try:
            processed = await _process_one()
        except Exception:
            logger.exception("worker iteration failed")
            processed = False

        if processed:
            # 刚处理完一个，立即尝试下一个（小憩降压）
            await asyncio.sleep(INTER_JOB_SLEEP)
            continue
        # 空闲：等待唤醒或轮询超时
        try:
            await asyncio.wait_for(_wake.wait(), timeout=POLL_INTERVAL)
        except asyncio.TimeoutError:
            pass
        _wake.clear()


async def _process_one() -> bool:
    """认领并处理一个任务。处理了返回 True，无任务返回 False。"""
    async with async_session() as db:
        job = await _claim_transfer(db)
        if job is not None:
            await _process_transfer(db, job)
            return True
        log = await _claim_pool_task(db)
        if log is not None:
            await _process_pool_task(db, log)
            return True
        mat = await _claim_material(db)
        if mat is not None:
            await _process_material(db, mat)
            return True
    return False


# ── 原子认领 ──

async def _claim_transfer(db) -> TransferJob | None:
    ids = (await db.scalars(
        select(TransferJob.id).where(TransferJob.status == "pending")
        .order_by(TransferJob.created_at.asc()).limit(CLAIM_BATCH)
    )).all()
    for jid in ids:
        res = await db.execute(
            update(TransferJob)
            .where(TransferJob.id == jid, TransferJob.status == "pending")
            .values(status="running", updated_at=_utcnow())
        )
        await db.commit()
        if res.rowcount == 1:
            return await db.get(TransferJob, jid)
    return None


async def _claim_pool_task(db) -> TaskLog | None:
    ids = (await db.scalars(
        select(TaskLog.id).where(
            TaskLog.status == "pending", TaskLog.task_type.in_(POOL_TASK_TYPES)
        ).order_by(TaskLog.created_at.asc()).limit(CLAIM_BATCH)
    )).all()
    for jid in ids:
        res = await db.execute(
            update(TaskLog)
            .where(TaskLog.id == jid, TaskLog.status == "pending")
            .values(status="running", started_at=_utcnow())
        )
        await db.commit()
        if res.rowcount == 1:
            return await db.get(TaskLog, jid)
    return None


async def _claim_material(db) -> Material | None:
    ids = (await db.scalars(
        select(Material.id).where(Material.status == "pending")
        .order_by(Material.created_at.asc()).limit(CLAIM_BATCH)
    )).all()
    for jid in ids:
        res = await db.execute(
            update(Material)
            .where(Material.id == jid, Material.status == "pending")
            .values(status="running")
        )
        await db.commit()
        if res.rowcount == 1:
            return await db.get(Material, jid)
    return None


# ── 处理（逻辑委托给各业务模块，懒导入避免循环依赖）──

async def _process_transfer(db, job: TransferJob) -> None:
    from app.api.v1.products import _load_pool_full, _transfer_build_and_save
    job_id = job.id  # 先存：rollback 后访问 job.id 会触发过期属性同步重载而报错
    try:
        pool = await _load_pool_full(db, job.pool_id)
        if not pool:
            raise ValueError("选品池商品已不存在")
        product = await _transfer_build_and_save(db, pool, job.team_id, job.user_id, job.options or {})
        job.status = "completed"
        job.product_id = product.id
        job.completed_at = _utcnow()
    except Exception as e:
        await db.rollback()
        job = await db.get(TransferJob, job_id)
        if job is not None:
            job.status = "failed"
            job.error = str(e)
            job.completed_at = _utcnow()
    await db.commit()


async def _process_pool_task(db, log: TaskLog) -> None:
    from app.api.v1.product_pool import process_translation_log, process_pricing_log
    log_id = log.id  # 先存：rollback 后访问 log.id 会触发过期属性同步重载而报错
    try:
        if log.task_type == "translate":
            await process_translation_log(db, log)
        elif log.task_type == "pricing":
            await process_pricing_log(db, log)
        else:
            log.status = "failed"
            log.message = f"unsupported task type: {log.task_type}"
            log.completed_at = _utcnow()
            await db.commit()
    except Exception as e:
        await db.rollback()
        log = await db.get(TaskLog, log_id)
        if log is not None:
            log.status = "failed"
            log.message = str(e)
            log.completed_at = _utcnow()
            await db.commit()


async def _process_material(db, mat: Material) -> None:
    from app.models import Product
    from app.services.material_service import generate_material_description
    mat_id = mat.id  # 先存：rollback 后访问 mat.id 会触发过期属性同步重载而报错（卡 running 的真凶）
    try:
        title = None
        if mat.product_id:
            product = await db.get(Product, mat.product_id)
            title = product.title if product else None
        desc = await generate_material_description(
            db, mat.image_url, spu=mat.spu, sku=mat.sku, title=title
        )
        mat.description = desc
        mat.status = "done"
        mat.error = None
        await db.commit()
    except Exception as e:
        await db.rollback()
        m2 = await db.get(Material, mat_id)
        if m2 is not None:
            m2.status = "failed"
            m2.error = str(e)[:500]
            await db.commit()


# ── 启动恢复 ──

async def resume_interrupted() -> None:
    """启动时把中断的 running 重置为 pending，便于 worker 继续处理。

    注意：单进程/开发环境安全。多进程部署若需精确恢复，应改为基于心跳/租约。
    """
    async with async_session() as db:
        await db.execute(
            update(TransferJob).where(TransferJob.status == "running").values(status="pending")
        )
        await db.execute(
            update(TaskLog).where(
                TaskLog.status == "running", TaskLog.task_type.in_(POOL_TASK_TYPES)
            ).values(status="pending")
        )
        await db.execute(
            update(Material).where(Material.status == "running").values(status="pending")
        )
        await db.commit()
