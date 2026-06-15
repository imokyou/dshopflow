from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, func
from pydantic import BaseModel
from typing import Any
import re
import threading
from datetime import datetime, timezone
from sqlalchemy.orm import joinedload
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User, Product, Shop, Collection, ProductPool, PricingRule, TransferJob, SpuRule
from app.core.permissions import require, Permission
from app.services.shopify_product_service import sync_to_shopify
from app.services.translate_service import translate_product, translate_terms
from app.services.pricing_service import PricingEngine

router = APIRouter(prefix="/products", tags=["products"])


def _strip_html(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()


def _gen_seo(title: str, body_html: str) -> tuple[str, str]:
    seo_title = (title or "").strip()[:70]
    desc = _strip_html(body_html)
    if not desc:
        desc = seo_title
    return seo_title, desc[:160]


# ── Schemas ──
class ProductIn(BaseModel):
    title: str | None = None
    title_cn: str | None = None
    title_en: str | None = None
    body_html: str | None = None
    vendor: str | None = None
    product_type: str | None = None
    tags: str | None = None
    price: float | None = None
    options: list[Any] | None = None
    variants: list[Any] | None = None
    images: list[Any] | None = None
    collection_ids: list[Any] | None = None
    seo_title: str | None = None
    seo_description: str | None = None
    status: str | None = None          # draft | active | archived
    shop_id: str | None = None


def _min_price(variants):
    prices = []
    for v in (variants or []):
        try:
            p = float(v.get("price"))
            if p > 0:
                prices.append(p)
        except (TypeError, ValueError):
            continue
    return min(prices) if prices else None


def _inventory(variants):
    total = 0
    for v in (variants or []):
        try:
            total += int(v.get("inventory_quantity") or 0)
        except (TypeError, ValueError):
            continue
    return total


def _summary(p: Product) -> dict:
    imgs = p.images or []
    return {
        "id": p.id, "title": p.title or p.title_en or p.title_cn, "status": p.status,
        "vendor": p.vendor, "product_type": p.product_type, "tags": p.tags,
        "price": p.price, "image": (imgs[0].get("src") if imgs and isinstance(imgs[0], dict) else None),
        "image_count": len(imgs), "variant_count": len(p.variants or []),
        "inventory": _inventory(p.variants), "shopify_product_id": p.shopify_product_id,
        "shopify_synced_at": (p.shopify_synced_at.isoformat() + "+00:00") if p.shopify_synced_at else None,
        "created_at": (p.created_at.isoformat() + "+00:00") if p.created_at else None,
        "updated_at": (p.updated_at.isoformat() + "+00:00") if p.updated_at else None,
    }


def _detail(p: Product) -> dict:
    return {
        "id": p.id, "title": p.title, "title_cn": p.title_cn, "title_en": p.title_en,
        "body_html": p.body_html, "vendor": p.vendor, "product_type": p.product_type,
        "tags": p.tags, "price": p.price, "options": p.options or [], "variants": p.variants or [],
        "images": p.images or [], "collection_ids": p.collection_ids or [],
        "seo_title": p.seo_title, "seo_description": p.seo_description, "status": p.status,
        "shop_id": p.shop_id, "shopify_product_id": p.shopify_product_id, "shopify_handle": p.shopify_handle,
        "shopify_synced_at": (p.shopify_synced_at.isoformat() + "+00:00") if p.shopify_synced_at else None,
        "created_at": (p.created_at.isoformat() + "+00:00") if p.created_at else None,
        "updated_at": (p.updated_at.isoformat() + "+00:00") if p.updated_at else None,
    }


def _apply(p: Product, req: ProductIn):
    data = req.model_dump(exclude_unset=True)
    for field in ("title", "title_cn", "title_en", "body_html", "vendor", "product_type",
                  "tags", "options", "variants", "images", "collection_ids",
                  "seo_title", "seo_description", "status", "shop_id"):
        if field in data:
            setattr(p, field, data[field])
    # price 优先用显式值，否则按变体最低价
    if "price" in data and data["price"] is not None:
        p.price = data["price"]
    elif "variants" in data:
        p.price = _min_price(p.variants)


async def _get_owned(product_id: str, current_user: User, db: AsyncSession) -> Product:
    p = await db.get(Product, product_id)
    if not p:
        raise HTTPException(status_code=404, detail="商品不存在")
    if current_user.role != "super_admin" and p.team_id != current_user.team_id:
        raise HTTPException(status_code=403, detail="无权访问")
    return p


async def _pick_shop(p: Product, db: AsyncSession) -> Shop | None:
    if p.shop_id:
        s = await db.get(Shop, p.shop_id)
        if s:
            return s
    return await db.scalar(select(Shop).where(Shop.team_id == p.team_id, Shop.is_active == True).limit(1))


# ── List ──
@router.get("")
async def list_products(
    team_id: str | None = Query(None),
    status: str | None = Query(None),
    search: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Product)
    if current_user.role != "super_admin":
        stmt = stmt.where(Product.team_id == current_user.team_id)
    elif team_id:
        stmt = stmt.where(Product.team_id == team_id)
    if status:
        stmt = stmt.where(Product.status == status)
    if search:
        like = f"%{search}%"
        stmt = stmt.where(or_(Product.title.ilike(like), Product.title_en.ilike(like), Product.title_cn.ilike(like)))

    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    stmt = stmt.order_by(Product.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
    rows = await db.scalars(stmt)
    return {"items": [_summary(p) for p in rows], "total": total, "page": page, "page_size": page_size}


# ── 转入队列列表（必须在 /{product_id} 之前注册，否则被动态路由抢占）──
@router.get("/transfer-jobs")
async def list_transfer_jobs(
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(TransferJob)
    if current_user.role != "super_admin":
        stmt = stmt.where(TransferJob.team_id == current_user.team_id)
    rows = list(await db.scalars(stmt.order_by(TransferJob.created_at.desc()).limit(limit)))
    counts = {"pending": 0, "running": 0, "completed": 0, "failed": 0}
    for j in rows:
        counts[j.status] = counts.get(j.status, 0) + 1
    return {
        "items": [{
            "id": j.id, "pool_title": j.pool_title, "status": j.status, "product_id": j.product_id,
            "error": j.error, "created_at": (j.created_at.isoformat() + "+00:00") if j.created_at else None,
            "completed_at": (j.completed_at.isoformat() + "+00:00") if j.completed_at else None,
        } for j in rows],
        "counts": counts,
    }


# ── Detail ──
@router.get("/{product_id}")
async def get_product(product_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    p = await _get_owned(product_id, current_user, db)
    return _detail(p)


# ── Create ──
@router.post("", status_code=201)
async def create_product(
    req: ProductIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.EDIT_PRODUCT),
):
    p = Product(
        team_id=current_user.team_id,
        user_id=current_user.id,
        status=(req.status or "draft"),
        options=[], variants=[], images=[], collection_ids=[],
    )
    _apply(p, req)
    if not (p.title or p.title_en or p.title_cn):
        raise HTTPException(status_code=400, detail="标题不能为空")
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return _detail(p)


# ── 从选品池转入（只读取选品池，不修改其数据）──
class FromPoolRequest(BaseModel):
    pool_id: str
    spu_rule_id: str                       # 必填：SPU 规则（SKU 编码前缀）
    pricing_rule_id: str | None = None     # 选定价规则 → 自动算售价/划线价；空则用选品池已有售价
    translate: bool = False                # 是否 AI 翻译
    language: str = "en"                   # en | de | fr
    generate_seo: bool = True              # 自动生成 SEO 标题/描述


def _pool_image_src(im):
    if isinstance(im, dict):
        return im.get("processed_url") or im.get("s3_url") or im.get("url")
    return im if isinstance(im, str) else None


def _to_float(v):
    try:
        return float(str(v).replace("¥", "").replace("￥", "").strip())
    except (TypeError, ValueError):
        return 0.0


# 中文颜色 → 英文（多字在前，避免「酒红→红」误匹配）
COLOR_MAP = [
    ("卡其", "KHAKI"), ("藏青", "NAVY"), ("酒红", "WINE"), ("墨绿", "DARKGREEN"),
    ("army", "ARMY"), ("黄", "YELLOW"), ("蓝", "BLUE"), ("绿", "GREEN"), ("红", "RED"),
    ("黑", "BLACK"), ("白", "WHITE"), ("粉", "PINK"), ("灰", "GRAY"), ("紫", "PURPLE"),
    ("橙", "ORANGE"), ("棕", "BROWN"), ("咖", "COFFEE"), ("米", "BEIGE"), ("杏", "APRICOT"),
    ("裸", "NUDE"), ("银", "SILVER"), ("金", "GOLD"), ("花", "FLORAL"), ("驼", "CAMEL"),
]


def _sku_value_part(v: str) -> str:
    """把一个规格值转成 SKU 片段：颜色→编码+英文色(PM04-YELLOW)，尺码→大写(80CM/XL)。"""
    s = str(v or "").strip()
    s = re.sub(r"[（(【\[][^)）\]】]*[)）\]】]", "", s)  # 去括号说明，如（清货老款）
    s = s.strip(" -·、")
    if not s:
        return ""
    code_m = re.match(r"^([A-Za-z]{1,5}\d{1,4})", s)
    code = code_m.group(1).upper() if code_m else ""
    color = next((en for zh, en in COLOR_MAP if zh in s), "")
    if color:
        return f"{code}-{color}" if code else color
    cleaned = re.sub(r"[^0-9A-Za-z]+", "", s).upper()  # 尺码/身高/数字
    return cleaned or (code if code else "")


def _make_sku(code: str, variant: dict) -> str:
    parts = [code]
    for k in ("option1", "option2", "option3"):
        v = variant.get(k)
        if v:
            p = _sku_value_part(v)
            if p:
                parts.append(p)
    return "-".join([p for p in parts if p])


def _finalize_parts(raw_vals, en_map) -> list:
    """把规格值列表转成「SKU 就绪的英文片段」，保证唯一非空。
    en_map: {原文: AI英文} 优先用；否则 COLOR_MAP/尺码规整；再不行用编码或序号兜底。"""
    out, seen = [], set()
    for idx, v in enumerate(raw_vals):
        part = ""
        eng = (en_map or {}).get(v)
        if eng:
            code_m = re.match(r"^([A-Za-z]{1,5}\d{1,4})", str(v))
            code = code_m.group(1).upper() if code_m else ""
            e = re.sub(r"[^0-9A-Za-z]+", "", eng).upper()
            part = (f"{code}-{e}" if code and e else (e or code))
        if not part:
            part = _sku_value_part(v)
        if not part:
            part = f"V{idx + 1}"
        base, n = part, 2
        while part in seen:
            part = f"{base}{n}"
            n += 1
        seen.add(part)
        out.append(part)
    return out


def _attr_values(attrs, keywords) -> list:
    """从商品属性里按名称关键词取多值（颜色/尺码等），按 、，/；| 拆分。"""
    for a in (attrs or []):
        name = (a.get("name") if isinstance(a, dict) else "") or ""
        if any(k in name for k in keywords):
            raw = (a.get("value") if isinstance(a, dict) else "") or ""
            vals = [p.strip() for p in re.split(r"[、,，/／;；|]+", raw) if p.strip()]
            if vals:
                return vals
    return []


async def _transfer_build_and_save(db: AsyncSession, pool, team_id: str, user_id: str, opts: dict) -> Product:
    """选品池 → Product（草稿）。opts: spu_rule_id(必填)/pricing_rule_id/translate/language/generate_seo。
    业务错误抛 ValueError。"""
    # SPU 规则（必填）
    spu = await db.get(SpuRule, opts.get("spu_rule_id")) if opts.get("spu_rule_id") else None
    if not spu or spu.team_id != pool.team_id:
        raise ValueError("请先选择有效的 SPU 规则")
    spu_code = (spu.code or "").strip()

    language = opts.get("language") or "en"
    detail = pool.detail
    desc_cn = detail.desc_cn if detail else ""

    # 标题 / 描述
    title_final = pool.title_cn or "未命名商品"
    title_en = None
    body = desc_cn or ""
    if opts.get("translate"):
        tr = await translate_product(db, pool.title_cn or "", desc_cn or "", language)
        if tr.get("error"):
            raise ValueError(f"AI 翻译失败：{tr['error']}（请在「AI 提供商」中配置并启用 text 类别的提供商）")
        title_final = tr.get("title") or title_final
        title_en = tr.get("title")
        body = f"<div>{tr.get('description') or ''}</div>"
        if tr.get("bullet_points"):
            body += "<ul>" + "".join(f"<li>{bp}</li>" for bp in tr['bullet_points']) + "</ul>"
    else:
        trans = next((t for t in (pool.translations or []) if t.language == language), None) \
            or (pool.translations[0] if pool.translations else None)
        if trans:
            title_final = trans.title or title_final
            title_en = trans.title
            if trans.description:
                body = f"<div>{trans.description}</div>"
                if trans.bullet_points:
                    body += "<ul>" + "".join(f"<li>{bp}</li>" for bp in trans.bullet_points) + "</ul>"

    # 图片
    images = []
    for i, im in enumerate(((detail.images if detail else None) or [])):
        src = _pool_image_src(im)
        if src and str(src).startswith("http"):
            images.append({"src": src, "alt": "", "position": i + 1})
    if not images and pool.main_image_url:
        images.append({"src": pool.main_image_url, "alt": "", "position": 1})

    # 定价
    skus = (detail.skus if detail else None) or []
    rule = None
    engine = None
    if opts.get("pricing_rule_id"):
        rule = await db.get(PricingRule, opts["pricing_rule_id"])
        if not rule or rule.team_id != pool.team_id:
            raise ValueError("定价规则无效")
        engine = PricingEngine(pool.team_id)
        await engine.load_rules(db)

    def price_for(cost_cny: float):
        if engine and rule:
            r = engine.calculate(cost_cny, matched_rule=rule)
            return r["final_price"], r["compare_at_price"]
        return pool.final_price, pool.compare_at_price

    options, variants = [], []
    fp, cap = price_for(_to_float(pool.cost_price))
    stocks = [int((s.get("stock") if isinstance(s, dict) else 0) or 0) for s in skus]
    rep_stock = max(stocks) if stocks else 0
    if rep_stock <= 0:
        rep_stock = 100

    # 1) 优先：从商品属性识别 颜色 / 尺码 → 两个 Options 笛卡尔积（变体值统一英文，SKU 段唯一非空）
    attrs = (detail.attrs if detail else None) or []
    color_raw = _attr_values(attrs, ["颜色"])[:50]
    size_raw = _attr_values(attrs, ["尺码", "尺寸", "适合身高", "身高", "鞋码", "码数", "脚长"])[:50]

    # 颜色含中文款式名时（COLOR_MAP 无法映射），勾了 AI 翻译则用 AI 译成英文
    color_en_map = {}
    if opts.get("translate") and color_raw:
        color_en_map = await translate_terms(db, color_raw, opts.get("language") or "en")

    color_vals = _finalize_parts(color_raw, color_en_map)
    size_vals = _finalize_parts(size_raw, {})
    opt_defs = []
    if color_vals:
        opt_defs.append(("Color", color_vals))
    if size_vals:
        opt_defs.append(("Size", size_vals))

    if opt_defs:
        import itertools
        options = [{"name": n, "values": vals} for n, vals in opt_defs]
        combos = list(itertools.product(*[vals for _, vals in opt_defs]))[:100]  # Shopify 上限 100
        for combo in combos:
            # 值已是 SKU 就绪的英文片段，直接拼接为 SKU
            v = {"title": " / ".join(combo),
                 "option1": combo[0], "option2": combo[1] if len(combo) > 1 else None,
                 "option3": combo[2] if len(combo) > 2 else None,
                 "price": fp, "compare_at_price": cap,
                 "sku": "-".join([spu_code] + [c for c in combo if c]),
                 "inventory_quantity": rep_stock, "barcode": ""}
            variants.append(v)

    # 2) 退而求其次：用抓到的 SKU 规格
    if not variants:
        specs = []
        for s in skus:
            sp = (s.get("spec") if isinstance(s, dict) else None) or ""
            if sp and sp != "默认" and sp not in specs:
                specs.append(sp)
        if specs:
            options = [{"name": "规格", "values": specs}]
            for s in skus:
                sp = (s.get("spec") if isinstance(s, dict) else "") or ""
                if not sp or sp == "默认":
                    continue
                pfp, pcap = price_for(_to_float(s.get("price") if isinstance(s, dict) else 0))
                v = {"title": sp, "option1": sp, "option2": None, "option3": None,
                     "price": pfp, "compare_at_price": pcap, "sku": "",
                     "inventory_quantity": int((s.get("stock") if isinstance(s, dict) else 0) or 0), "barcode": ""}
                v["sku"] = _make_sku(spu_code, v)
                variants.append(v)

    # 3) 兜底：单一默认变体
    if not variants:
        total_stock = sum(stocks) or rep_stock
        v = {"title": "Default", "option1": None, "option2": None, "option3": None,
             "price": fp, "compare_at_price": cap, "sku": spu_code, "inventory_quantity": total_stock, "barcode": ""}
        variants = [v]

    seo_title, seo_desc = (_gen_seo(title_final, body) if opts.get("generate_seo", True) else (None, None))

    # 内容字段（重复转入时覆盖；保留 vendor/类型/标签/合集 等人工编辑）
    content = dict(
        title=title_final, title_cn=pool.title_cn, title_en=title_en,
        body_html=body, price=_min_price(variants),
        options=options, variants=variants, images=images,
        seo_title=seo_title, seo_description=seo_desc, status="draft",
    )

    # 已转入过同一选品池商品 → 覆盖更新；否则新建
    existing = await db.scalar(
        select(Product).where(Product.source_pool_id == pool.id, Product.team_id == team_id)
        .order_by(Product.created_at.desc()).limit(1)
    )
    if existing:
        for k, v in content.items():
            setattr(existing, k, v)
        p = existing
    else:
        p = Product(team_id=team_id, user_id=user_id, source_pool_id=pool.id,
                    vendor="", product_type="", tags="", collection_ids=[], **content)
        db.add(p)
    await db.commit()
    await db.refresh(p)
    return p


async def _load_pool_full(db: AsyncSession, pool_id: str):
    return await db.scalar(
        select(ProductPool).where(ProductPool.id == pool_id).options(
            joinedload(ProductPool.detail), joinedload(ProductPool.translations),
        )
    )


@router.post("/from-pool", status_code=201)
async def create_from_pool(
    req: FromPoolRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.EDIT_PRODUCT),
):
    pool = await _load_pool_full(db, req.pool_id)
    if not pool:
        raise HTTPException(status_code=404, detail="选品池商品不存在")
    if current_user.role != "super_admin" and pool.team_id != current_user.team_id:
        raise HTTPException(status_code=403, detail="无权访问")
    try:
        p = await _transfer_build_and_save(db, pool, current_user.team_id, current_user.id, req.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _detail(p)


# ── 后台队列：批量入队，慢慢处理 ──
class QueueTransferRequest(BaseModel):
    pool_ids: list[str]
    spu_rule_id: str
    pricing_rule_id: str | None = None
    translate: bool = False
    language: str = "en"
    generate_seo: bool = True


@router.post("/from-pool/queue", status_code=202)
async def queue_from_pool(
    req: QueueTransferRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.EDIT_PRODUCT),
):
    if not req.spu_rule_id:
        raise HTTPException(status_code=400, detail="请先选择 SPU 规则")
    spu = await db.get(SpuRule, req.spu_rule_id)
    if not spu or (current_user.role != "super_admin" and spu.team_id != current_user.team_id):
        raise HTTPException(status_code=400, detail="SPU 规则无效")

    opts = {"spu_rule_id": req.spu_rule_id, "pricing_rule_id": req.pricing_rule_id,
            "translate": req.translate, "language": req.language, "generate_seo": req.generate_seo}
    queued = 0
    for pid in req.pool_ids:
        pool = await db.get(ProductPool, pid)
        if not pool:
            continue
        if current_user.role != "super_admin" and pool.team_id != current_user.team_id:
            continue
        db.add(TransferJob(team_id=current_user.team_id, user_id=current_user.id, pool_id=pid,
                           pool_title=pool.title_cn, status="pending", options=opts))
        queued += 1
    await db.commit()
    _ensure_worker()
    return {"queued": queued}


@router.delete("/transfer-jobs/cleared")
async def clear_finished_jobs(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import delete as sa_delete
    stmt = sa_delete(TransferJob).where(TransferJob.status.in_(["completed", "failed"]))
    if current_user.role != "super_admin":
        stmt = stmt.where(TransferJob.team_id == current_user.team_id)
    await db.execute(stmt)
    await db.commit()
    return {"ok": True}


# ── 后台 worker（单例线程，逐个处理 pending 任务）──
_worker_lock = threading.Lock()
_worker_running = False


def _ensure_worker():
    global _worker_running
    with _worker_lock:
        if _worker_running:
            return
        _worker_running = True
    threading.Thread(target=_worker_loop, daemon=True).start()


def _worker_loop():
    global _worker_running
    import asyncio
    try:
        asyncio.run(_drain())
    except Exception:
        pass
    finally:
        with _worker_lock:
            _worker_running = False


async def resume_pending_jobs():
    """启动时调用：把中断的 running 重置为 pending，并拉起 worker 继续处理。"""
    from sqlalchemy import update as sa_update
    from app.database import async_session
    async with async_session() as db:
        await db.execute(sa_update(TransferJob).where(TransferJob.status == "running").values(status="pending"))
        await db.commit()
        cnt = await db.scalar(select(func.count()).select_from(TransferJob).where(TransferJob.status == "pending"))
    if cnt and cnt > 0:
        _ensure_worker()


async def _drain():
    import asyncio
    from app.database import async_session
    while True:
        async with async_session() as db:
            job = await db.scalar(
                select(TransferJob).where(TransferJob.status == "pending").order_by(TransferJob.created_at.asc()).limit(1)
            )
            if not job:
                return
            job.status = "running"
            await db.commit()
            try:
                pool = await _load_pool_full(db, job.pool_id)
                if not pool:
                    raise ValueError("选品池商品已不存在")
                product = await _transfer_build_and_save(db, pool, job.team_id, job.user_id, job.options or {})
                job.status = "completed"
                job.product_id = product.id
                job.completed_at = datetime.now(timezone.utc)
            except Exception as e:
                job.status = "failed"
                job.error = str(e)
                job.completed_at = datetime.now(timezone.utc)
            await db.commit()
        await asyncio.sleep(0.3)  # 慢慢处理，降低 DB/AI 压力


# ── Update ──
@router.put("/{product_id}")
async def update_product(
    product_id: str,
    req: ProductIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.EDIT_PRODUCT),
):
    p = await _get_owned(product_id, current_user, db)
    _apply(p, req)
    await db.commit()
    await db.refresh(p)
    return _detail(p)


# ── Delete（同时尝试删 Shopify 商品）──
@router.delete("/{product_id}")
async def delete_product(
    product_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.DELETE_PRODUCT),
):
    p = await _get_owned(product_id, current_user, db)
    if p.shopify_product_id:
        shop = await _pick_shop(p, db)
        if shop and shop.shop_domain and shop.access_token_encrypted:
            from app.integrations.shopify.client import ShopifyClient
            try:
                await ShopifyClient(shop.shop_domain, shop.access_token_encrypted).delete_product(int(p.shopify_product_id))
            except Exception:
                pass  # 远端删除失败不阻塞本地删除
    await db.delete(p)
    await db.commit()
    return {"ok": True}


# ── Publish / Unpublish / Sync ──
@router.post("/{product_id}/publish")
async def publish_product(
    product_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.EDIT_PRODUCT),
):
    p = await _get_owned(product_id, current_user, db)
    shop = await _pick_shop(p, db)
    result = await sync_to_shopify(db, p, shop, status="active")
    return {"ok": True, **result}


@router.post("/{product_id}/unpublish")
async def unpublish_product(
    product_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.EDIT_PRODUCT),
):
    p = await _get_owned(product_id, current_user, db)
    shop = await _pick_shop(p, db)
    result = await sync_to_shopify(db, p, shop, status="draft")
    return {"ok": True, **result}


@router.post("/{product_id}/sync")
async def sync_product(
    product_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: User = require(Permission.EDIT_PRODUCT),
):
    p = await _get_owned(product_id, current_user, db)
    shop = await _pick_shop(p, db)
    result = await sync_to_shopify(db, p, shop, status=(p.status or "draft"))
    return {"ok": True, **result}
