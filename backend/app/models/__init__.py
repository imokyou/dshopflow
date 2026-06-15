import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Boolean, Integer, Float, Text, DateTime,
    ForeignKey, UniqueConstraint, Index, JSON, BigInteger,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base


def utcnow():
    return datetime.now(timezone.utc)


def new_uuid():
    return str(uuid.uuid4())


# ──────────────────────────────────────
# 团队
# ──────────────────────────────────────
class Team(Base):
    __tablename__ = "teams"

    id = Column(String(36), primary_key=True, default=new_uuid)
    name = Column(String(100), nullable=False)
    plan_id = Column(String(36), ForeignKey("subscription_plans.id"), nullable=True)
    created_by = Column(String(36), ForeignKey("users.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    plan = relationship("SubscriptionPlan", lazy="joined")
    users = relationship("User", back_populates="team", foreign_keys="[User.team_id]")
    shops = relationship("Shop", back_populates="team")
    pricing_rules = relationship("PricingRule", back_populates="team")
    import_tasks = relationship("ImportTask", back_populates="team")
    products = relationship("Product", back_populates="team")
    audit_logs = relationship("AuditLog", back_populates="team")
    product_pools = relationship("ProductPool", back_populates="team")


# ──────────────────────────────────────
# 用户
# ──────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=new_uuid)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    name = Column(String(100))
    role = Column(String(20), nullable=False, default="member")  # super_admin | manager | member
    team_id = Column(String(36), ForeignKey("teams.id", ondelete="SET NULL"), nullable=True, index=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    team = relationship("Team", back_populates="users", foreign_keys="[User.team_id]")


# ──────────────────────────────────────
# Shopify 店铺
# ──────────────────────────────────────
class Shop(Base):
    __tablename__ = "shops"
    __table_args__ = (UniqueConstraint("team_id", "shop_domain"),)

    id = Column(String(36), primary_key=True, default=new_uuid)
    team_id = Column(String(36), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by = Column(String(36), ForeignKey("users.id"), nullable=False)
    shop_domain = Column(String(255), nullable=False)
    shop_name = Column(String(255))
    access_token_encrypted = Column(String, nullable=False)
    alias = Column(String(100))
    custom_domain = Column(String(255))
    tags = Column(String(255))
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    team = relationship("Team", back_populates="shops")


# ──────────────────────────────────────
# 定价规则
# ──────────────────────────────────────
class PricingRule(Base):
    __tablename__ = "pricing_rules"

    id = Column(String(36), primary_key=True, default=new_uuid)
    team_id = Column(String(36), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by = Column(String(36), ForeignKey("users.id"), nullable=False)
    name = Column(String(100), nullable=False)
    priority = Column(Integer, default=0)
    conditions = Column(JSON, default=[])
    formula = Column(JSON, default={})
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    team = relationship("Team", back_populates="pricing_rules")


# ──────────────────────────────────────
# 导入任务
# ──────────────────────────────────────
class ImportTask(Base):
    __tablename__ = "import_tasks"

    id = Column(String(36), primary_key=True, default=new_uuid)
    team_id = Column(String(36), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    shop_id = Column(String(36), ForeignKey("shops.id"), nullable=False)
    source_url = Column(String(500), nullable=False)
    offer_id = Column(String(50), index=True)
    status = Column(String(30), default="pending")
    progress = Column(Integer, default=0)
    raw_data = Column(JSON)
    translated_data = Column(JSON)
    processed_images = Column(JSON)
    pricing_result = Column(JSON)
    shopify_product_id = Column(BigInteger)
    shopify_product_url = Column(String(500))
    error_message = Column(Text)
    celery_task_id = Column(String(255))
    completed_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    team = relationship("Team", back_populates="import_tasks")


# ──────────────────────────────────────
# Shopify 商品记录
# ──────────────────────────────────────
class Product(Base):
    """商品管理模块（Shopify 后台式），独立于选品池(product_pools)"""
    __tablename__ = "products"

    id = Column(String(36), primary_key=True, default=new_uuid)
    # 来源/归属（从零新建时可空）
    import_task_id = Column(String(36), ForeignKey("import_tasks.id"), nullable=True)
    team_id = Column(String(36), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    shop_id = Column(String(36), ForeignKey("shops.id"), nullable=True)

    # Shopify 关联
    shopify_product_id = Column(BigInteger, nullable=True, index=True)
    shopify_handle = Column(String(255))
    handle = Column(String(255))
    shopify_synced_at = Column(DateTime(timezone=True))
    source_pool_id = Column(String(36), index=True)  # 来源选品池 id（标记是否转入）

    # 基本信息
    title = Column(String(500))           # 主标题（Shopify title）
    title_cn = Column(String(500))
    title_en = Column(String(500))
    body_html = Column(Text)              # 富文本描述
    vendor = Column(String(255))
    product_type = Column(String(255))
    tags = Column(String(500))            # 逗号分隔
    price = Column(Float)                 # 便捷字段：最低变体价

    # 多变体 / 图片 / 合集（JSON 存储）
    options = Column(JSON, default=list)        # [{name, values:[...]}]
    variants = Column(JSON, default=list)       # [{id,title,option1,option2,option3,price,compare_at_price,sku,inventory_quantity,barcode,shopify_variant_id}]
    images = Column(JSON, default=list)         # [{src,alt,position,shopify_image_id}]
    collection_ids = Column(JSON, default=list) # [collection_id,...]

    # SEO
    seo_title = Column(String(255))
    seo_description = Column(String(500))

    status = Column(String(30), default="draft")  # draft | active | archived
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    team = relationship("Team", back_populates="products")


# ──────────────────────────────────────
# 转入商品后台任务队列（选品池→商品管理）
# ──────────────────────────────────────
class TransferJob(Base):
    __tablename__ = "transfer_jobs"

    id = Column(String(36), primary_key=True, default=new_uuid)
    team_id = Column(String(36), nullable=False, index=True)
    user_id = Column(String(36))
    pool_id = Column(String(36), index=True)
    pool_title = Column(String(500))
    status = Column(String(20), default="pending", index=True)  # pending|running|completed|failed
    options = Column(JSON, default=dict)
    product_id = Column(String(36))
    error = Column(Text)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    completed_at = Column(DateTime(timezone=True))


# ──────────────────────────────────────
# SPU 规则（SKU 编码前缀）
# ──────────────────────────────────────
class SpuRule(Base):
    __tablename__ = "spu_rules"

    id = Column(String(36), primary_key=True, default=new_uuid)
    team_id = Column(String(36), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    code = Column(String(64), nullable=False)   # SKU 前缀，如 MK
    remark = Column(Text)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


# ──────────────────────────────────────
# 商品合集 (Collection)
# ──────────────────────────────────────
class Collection(Base):
    __tablename__ = "collections"

    id = Column(String(36), primary_key=True, default=new_uuid)
    team_id = Column(String(36), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    handle = Column(String(255))
    body_html = Column(Text)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


# ──────────────────────────────────────
# 邀请链接
# ──────────────────────────────────────
class Invitation(Base):
    __tablename__ = "invitations"

    id = Column(String(36), primary_key=True, default=new_uuid)
    team_id = Column(String(36), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by = Column(String(36), ForeignKey("users.id"), nullable=False)
    email = Column(String(255))
    token = Column(String(64), unique=True, nullable=False, index=True)
    role = Column(String(20), default="member")
    expires_at = Column(DateTime(timezone=True), nullable=False)
    accepted_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), default=utcnow)


# ──────────────────────────────────────
# 订阅套餐
# ──────────────────────────────────────
class SubscriptionPlan(Base):
    __tablename__ = "subscription_plans"

    id = Column(String(36), primary_key=True, default=new_uuid)
    name = Column(String(50), nullable=False)
    slug = Column(String(30), unique=True, nullable=False, index=True)
    monthly_price = Column(Float, default=0)
    yearly_price = Column(Float, default=0)
    quota_rule_id = Column(String(36), ForeignKey("quota_rules.id"), nullable=False)
    features = Column(JSON, default={})
    is_active = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    quota_rule = relationship("QuotaRule", lazy="joined")


# ──────────────────────────────────────
# 配额规则
# ──────────────────────────────────────
class QuotaRule(Base):
    __tablename__ = "quota_rules"

    id = Column(String(36), primary_key=True, default=new_uuid)
    name = Column(String(100), nullable=False)
    max_team_members = Column(Integer, default=1)
    max_shops = Column(Integer, default=1)
    daily_import_limit = Column(Integer, default=0)
    daily_image_limit = Column(Integer, default=0)
    monthly_import_limit = Column(Integer, default=0)
    monthly_image_limit = Column(Integer, default=0)
    max_images_per_product = Column(Integer, default=8)
    watermark_removal = Column(Boolean, default=False)
    white_background = Column(Boolean, default=False)
    marketing_image = Column(Boolean, default=False)
    scene_generation = Column(Boolean, default=False)
    multi_language = Column(Boolean, default=False)
    custom_pricing = Column(Boolean, default=False)
    priority_queue = Column(Boolean, default=False)
    api_access = Column(Boolean, default=False)
    data_export = Column(Boolean, default=False)
    data_dashboard = Column(Boolean, default=False)
    audit_log_retention_days = Column(Integer, default=30)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


# ──────────────────────────────────────
# AI 提供商配置
# ──────────────────────────────────────
class AIProvider(Base):
    __tablename__ = "ai_providers"

    id = Column(String(36), primary_key=True, default=new_uuid)
    name = Column(String(50), nullable=False)
    slug = Column(String(30), unique=True, nullable=False, index=True)
    provider_type = Column(String(30), nullable=False)
    category = Column(String(20), nullable=False, default="text")
    api_base_url = Column(String(255), nullable=False)
    api_key_encrypted = Column(String, nullable=False)
    default_model = Column(String(100), nullable=False)
    available_models = Column(JSON, default=[])
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    priority = Column(Integer, default=0)
    max_retries = Column(Integer, default=3)
    timeout_seconds = Column(Integer, default=30)
    pricing = Column(JSON, default={})
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


# ──────────────────────────────────────
# 审计日志 (只 INSERT)
# ──────────────────────────────────────
class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    team_id = Column(String(36), ForeignKey("teams.id", ondelete="SET NULL"), nullable=True, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    action = Column(String(50), nullable=False, index=True)
    entity_type = Column(String(30), nullable=False)
    entity_id = Column(String(100))
    entity_label = Column(String(500))
    old_values = Column(JSON)
    new_values = Column(JSON)
    ip_address = Column(String(45))
    user_agent = Column(Text)
    extra_data = Column(JSON, default={})  # 额外上下文
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)

    team = relationship("Team", back_populates="audit_logs")
    user = relationship("User")


# ──────────────────────────────────────
# 选品池主表（V2：轻量，用于列表展示）
# ──────────────────────────────────────
class ProductPool(Base):
    __tablename__ = "product_pools"

    id = Column(String(36), primary_key=True, default=new_uuid)
    team_id = Column(String(36), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    offer_id = Column(String(50), nullable=False, index=True)
    source_url = Column(String(500), nullable=False)
    title_cn = Column(String(500))
    main_image_url = Column(String(500))
    cost_price = Column(Float)
    sku_count = Column(Integer, default=0)
    image_count = Column(Integer, default=0)

    # 定价结果（写完即读，不回源计算）
    final_price = Column(Float)
    compare_at_price = Column(Float)
    pricing_rule_name = Column(String(100))
    exchange_rate = Column(Float)
    markup = Column(Float)

    # 状态
    status = Column(String(30), default="captured", index=True)
    error_message = Column(Text)

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    __table_args__ = (UniqueConstraint("team_id", "offer_id"),)

    team = relationship("Team", back_populates="product_pools")
    detail = relationship("ProductDetail", back_populates="pool", uselist=False, cascade="all, delete-orphan")
    translations = relationship("ProductTranslation", back_populates="pool", cascade="all, delete-orphan")
    task_logs = relationship("TaskLog", back_populates="pool", cascade="all, delete-orphan")


# ──────────────────────────────────────
# 选品池副表1 — 中文原始内容 (1:1)
# ──────────────────────────────────────
class ProductDetail(Base):
    __tablename__ = "product_details"

    id = Column(String(36), primary_key=True, default=new_uuid)
    product_pool_id = Column(String(36), ForeignKey("product_pools.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    desc_cn = Column(Text)
    images = Column(JSON, default=[])
    skus = Column(JSON, default=[])
    attrs = Column(JSON, default=[])

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    pool = relationship("ProductPool", back_populates="detail")


# ──────────────────────────────────────
# 选品池副表2 — 多语言翻译 (1:N)
# ──────────────────────────────────────
class ProductTranslation(Base):
    __tablename__ = "product_translations"
    __table_args__ = (UniqueConstraint("product_pool_id", "language"),)

    id = Column(String(36), primary_key=True, default=new_uuid)
    product_pool_id = Column(String(36), ForeignKey("product_pools.id", ondelete="CASCADE"), nullable=False, index=True)
    language = Column(String(10), nullable=False)
    title = Column(String(500))
    description = Column(Text)
    bullet_points = Column(JSON, default=[])

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    pool = relationship("ProductPool", back_populates="translations")


# ──────────────────────────────────────
# 任务日志表（V2：翻译/修图/上架）
# ──────────────────────────────────────
class TaskLog(Base):
    __tablename__ = "task_logs"

    id = Column(String(36), primary_key=True, default=new_uuid)
    product_pool_id = Column(String(36), ForeignKey("product_pools.id", ondelete="CASCADE"), nullable=False, index=True)
    task_type = Column(String(30), nullable=False, index=True)
    status = Column(String(20), default="pending")
    language = Column(String(10))
    image_index = Column(Integer)
    message = Column(Text)
    result = Column(JSON, default={})
    retry_count = Column(Integer, default=0)
    started_at = Column(DateTime(timezone=True))
    completed_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), default=utcnow)

    pool = relationship("ProductPool", back_populates="task_logs")
