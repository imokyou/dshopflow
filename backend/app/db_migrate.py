"""幂等 schema 迁移：商品管理模块（products 扩展 + collections）。
只影响 products / collections 两张表，不触碰选品池(product_pools 等)。
启动时自动运行，可重复执行。SQLite 专用（ALTER 受限，用表重建放宽 NOT NULL）。
"""
from app.database import engine

# products 目标 schema（{name} 占位，便于表重建时建临时表）
PRODUCTS_DDL = """
CREATE TABLE {name} (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    import_task_id VARCHAR(36),
    team_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36),
    shop_id VARCHAR(36),
    shopify_product_id BIGINT,
    shopify_handle VARCHAR(255),
    handle VARCHAR(255),
    shopify_synced_at DATETIME,
    source_pool_id VARCHAR(36),
    spu VARCHAR(64),
    spu_code VARCHAR(64),
    title VARCHAR(500),
    title_cn VARCHAR(500),
    title_en VARCHAR(500),
    body_html TEXT,
    vendor VARCHAR(255),
    product_type VARCHAR(255),
    tags VARCHAR(500),
    price FLOAT,
    options JSON,
    variants JSON,
    images JSON,
    collection_ids JSON,
    seo_title VARCHAR(255),
    seo_description VARCHAR(500),
    status VARCHAR(30) DEFAULT 'draft',
    created_at DATETIME,
    updated_at DATETIME
)
"""

COLLECTIONS_DDL = """
CREATE TABLE IF NOT EXISTS collections (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    team_id VARCHAR(36) NOT NULL,
    title VARCHAR(255) NOT NULL,
    handle VARCHAR(255),
    body_html TEXT,
    created_at DATETIME,
    updated_at DATETIME
)
"""

SPU_RULES_DDL = """
CREATE TABLE IF NOT EXISTS spu_rules (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    team_id VARCHAR(36) NOT NULL,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(64) NOT NULL,
    remark TEXT,
    created_at DATETIME,
    updated_at DATETIME
)
"""

TRANSFER_JOBS_DDL = """
CREATE TABLE IF NOT EXISTS transfer_jobs (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    team_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36),
    pool_id VARCHAR(36),
    pool_title VARCHAR(500),
    status VARCHAR(20) DEFAULT 'pending',
    options JSON,
    product_id VARCHAR(36),
    error TEXT,
    created_at DATETIME,
    updated_at DATETIME,
    completed_at DATETIME
)
"""

MATERIALS_DDL = """
CREATE TABLE IF NOT EXISTS materials (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    team_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36),
    product_id VARCHAR(36),
    source_pool_id VARCHAR(36),
    spu VARCHAR(64),
    sku VARCHAR(128),
    image_url TEXT,
    description TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    error TEXT,
    position INTEGER DEFAULT 0,
    created_at DATETIME,
    updated_at DATETIME
)
"""

# 旧表 → 新表拷贝时可能存在的重叠列
_COPYABLE = [
    "id", "import_task_id", "team_id", "user_id", "shop_id",
    "shopify_product_id", "shopify_handle", "title_cn", "title_en",
    "status", "created_at", "updated_at",
]


def _sync_ensure(conn):
    def table_exists(name):
        r = conn.exec_driver_sql(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,)
        ).fetchone()
        return bool(r)

    def columns(table):
        rows = conn.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()
        # row: (cid, name, type, notnull, dflt_value, pk)
        return {r[1]: r for r in rows}

    # 1) collections
    conn.exec_driver_sql(COLLECTIONS_DDL)
    conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_collections_team_id ON collections(team_id)")

    # 1.5) transfer_jobs（转入队列）
    conn.exec_driver_sql(TRANSFER_JOBS_DDL)
    conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_transfer_jobs_team_id ON transfer_jobs(team_id)")
    conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_transfer_jobs_status ON transfer_jobs(status)")

    # 1.6) spu_rules
    conn.exec_driver_sql(SPU_RULES_DDL)
    conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_spu_rules_team_id ON spu_rules(team_id)")

    # 1.65) platform_settings（平台级设置，超管管理）
    conn.exec_driver_sql(
        "CREATE TABLE IF NOT EXISTS platform_settings ("
        "key VARCHAR(100) NOT NULL PRIMARY KEY, value TEXT, updated_at DATETIME)"
    )

    # 1.66) shops 增量补列：连接状态检测
    if table_exists("shops"):
        sc = columns("shops")
        if "conn_status" not in sc:
            conn.exec_driver_sql("ALTER TABLE shops ADD COLUMN conn_status VARCHAR(20) DEFAULT 'unknown'")
        if "conn_checked_at" not in sc:
            conn.exec_driver_sql("ALTER TABLE shops ADD COLUMN conn_checked_at DATETIME")
        if "conn_error" not in sc:
            conn.exec_driver_sql("ALTER TABLE shops ADD COLUMN conn_error TEXT")

    # 1.7) materials（素材库）
    conn.exec_driver_sql(MATERIALS_DDL)
    conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_materials_team_id ON materials(team_id)")
    conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_materials_product_id ON materials(product_id)")
    conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_materials_spu ON materials(spu)")
    conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_materials_status ON materials(status)")

    # 2) products
    if not table_exists("products"):
        conn.exec_driver_sql(PRODUCTS_DDL.format(name="products"))
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_products_team_id ON products(team_id)")
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_products_shopify_product_id ON products(shopify_product_id)")
        return

    pc = columns("products")
    # 增量补列：source_pool_id（标记是否转入）
    if "source_pool_id" not in pc:
        conn.exec_driver_sql("ALTER TABLE products ADD COLUMN source_pool_id VARCHAR(36)")
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_products_source_pool_id ON products(source_pool_id)")
        pc["source_pool_id"] = None

    # 增量补列：spu / spu_code（商品款号）
    if "spu" not in pc:
        conn.exec_driver_sql("ALTER TABLE products ADD COLUMN spu VARCHAR(64)")
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_products_spu ON products(spu)")
        pc["spu"] = None
    if "spu_code" not in pc:
        conn.exec_driver_sql("ALTER TABLE products ADD COLUMN spu_code VARCHAR(64)")
        conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_products_spu_code ON products(spu_code)")
        pc["spu_code"] = None

    has_new = "body_html" in pc
    ref_not_null = "import_task_id" in pc and pc["import_task_id"][3] == 1
    if has_new and not ref_not_null:
        return  # 已是新 schema

    # 表重建（同时补列 + 放宽 NOT NULL）
    conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
    conn.exec_driver_sql("DROP TABLE IF EXISTS products_new")
    conn.exec_driver_sql(PRODUCTS_DDL.format(name="products_new"))
    common = [c for c in _COPYABLE if c in pc]
    collist = ", ".join(common)
    conn.exec_driver_sql(f"INSERT INTO products_new ({collist}) SELECT {collist} FROM products")
    conn.exec_driver_sql("DROP TABLE products")
    conn.exec_driver_sql("ALTER TABLE products_new RENAME TO products")
    conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_products_team_id ON products(team_id)")
    conn.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_products_shopify_product_id ON products(shopify_product_id)")
    conn.exec_driver_sql("PRAGMA foreign_keys=ON")


async def ensure_schema():
    # SQLite 专用增量迁移（PRAGMA/sqlite_master/表重建）。Postgres 等由 create_all 建表，跳过。
    if engine.dialect.name != "sqlite":
        return
    async with engine.begin() as conn:
        await conn.run_sync(_sync_ensure)


# ── 跨库增量补列（SQLite + Postgres 通用，用 inspector 判断、ALTER ADD COLUMN）──
# 给已存在的表补新列（create_all 不会改既有表）。新建库 create_all 已含这些列，此处幂等跳过。
_ADD_COLUMNS = {
    "materials": [("s3_uploaded", "BOOLEAN DEFAULT FALSE")],
}


def _sync_ensure_columns(conn):
    from sqlalchemy import inspect
    insp = inspect(conn)
    tables = set(insp.get_table_names())
    for table, cols in _ADD_COLUMNS.items():
        if table not in tables:
            continue
        have = {c["name"] for c in insp.get_columns(table)}
        for name, ddl in cols:
            if name not in have:
                conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")


async def ensure_columns():
    async with engine.begin() as conn:
        await conn.run_sync(_sync_ensure_columns)
