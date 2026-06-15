# DropShipFlow v2 开发计划 — 选品池 + 分段管道

> 创建: 2026-06-10 | 状态: 待开工

---

## 1. 架构变更总览

### 旧流程（已实现）
```
插件抓取 → ImportTask → 管道一次跑完（翻译+下载+修图+定价+上架）
```

### 新流程
```
插件抓取 → ProductPool（选品池）
                │
                ├──→ [分段1] 翻译 + 定价（快速，可批量）
                │
                ├──→ [分段2] 修图（慢速，逐张预览确认）
                │
                └──→ [分段3] 创建 ImportTask → Shopify 上架
```

### 核心设计原则
- **选品池去重**：同一 offerId 重复抓取 → 覆盖更新
- **图片懒加载**：抓取时只存 URL，修图触发时才下载→S3→ComfyUI
- **分段可控**：每段可独立触发，人工确认后再进下一段
- **修图预览**：原图 vs 处理后左右对比，逐张确认/舍弃/重试

---

## 2. 数据模型

### 2.1 选品池三表设计

**主表 `product_pools`** — 轻量，用于列表展示

```python
class ProductPool(Base):
    __tablename__ = "product_pools"

    id                UUID       PK
    team_id           FK→teams   所属团队
    user_id           FK→users   抓取人
    offer_id          String     1688商品ID (唯一索引，去重)
    source_url        String     1688商品页URL
    title_cn          String     中文标题(短)
    main_image_url    String     主图URL(列表缩略图)
    cost_price        Float      最低SKU成本价(¥)
    sku_count         Integer    SKU数量
    image_count       Integer    图片数量

    # 定价结果
    final_price       Float      最终售价($)
    compare_at_price  Float      划线价($)
    pricing_rule_name String    匹配到的定价规则名
    exchange_rate     Float      使用的汇率
    markup            Float      加价倍率

    # 状态
    status            String     captured|translating|translated|pricing|priced|images_processing|images_ready|imported
    error_message     Text

    created_at        DateTime
    updated_at        DateTime
```

**副表1 `product_details`** — 中文原始内容（1:1）

```python
class ProductDetail(Base):
    __tablename__ = "product_details"

    id                UUID       PK
    product_pool_id   FK         FK→product_pools (unique)
    desc_cn           Text       中文描述(HTML)
    images            JSON       图片列表 [{url, status, s3_url, processed_url}]
    skus              JSON       SKU列表 [{spec, price, stock, image}]
    attrs             JSON       商品属性 [{name, value}]

    created_at        DateTime
    updated_at        DateTime
```

**副表2 `product_translations`** — 多语言翻译（1:N）

```python
class ProductTranslation(Base):
    __tablename__ = "product_translations"

    id                UUID       PK
    product_pool_id   FK         FK→product_pools
    language          String     语言代码 en|de|fr|es|ja...
    title             String     翻译后标题
    description       Text       翻译后描述
    bullet_points     JSON       卖点列表

    created_at        DateTime
    updated_at        DateTime

    # 唯一约束: (product_pool_id, language)
```

### 2.2 任务日志表 `task_logs`

三种操作（翻译/修图/上架）统一记录，每次触发新增一条，可追溯重试。

```python
class TaskLog(Base):
    __tablename__ = "task_logs"

    id                UUID      PK
    product_pool_id   FK        FK→product_pools
    task_type         String    translate | process_images | sync_shopify
    status            String    pending | running | completed | failed
    language          String    翻译时用 (en/de/fr...)
    image_index       Integer   修图时用 (第几张图片)
    message           Text      日志/错误信息
    result            JSON      结果数据 (翻译文本, 处理后URL, shopify_product_id 等)
    retry_count       Integer   重试次数
    started_at        DateTime
    completed_at      DateTime
    created_at        DateTime
```

**查询示例：**
```
GET /product-pool/{id}/tasks                    → 该商品所有任务日志
GET /product-pool/{id}/tasks?type=translate     → 只看翻译
POST /product-pool/{id}/tasks/{task_id}/retry   → 重试失败任务
```

### 2.3 ImportTask 职责缩小

ImportTask 不再管翻译/定价/修图，只负责 Shopify 同步：

```python
# ImportTask 简化
- 移除: raw_data, translated_data, processed_images, pricing_result
- 保留: team_id, user_id, shop_id, source_url, offer_id, status, progress
- 新增: product_pool_id (FK→product_pools)
```

---

## 3. API 设计

### 3.1 选品池

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/product-pool` | 插件抓取入库（offerId 去重，同时创建 detail 记录） |
| `GET` | `/product-pool` | 列表（主表字段，支持 status/搜索/分页） |
| `GET` | `/product-pool/{id}` | 详情（含 detail + translations） |
| `DELETE` | `/product-pool/{id}` | 删除（级联删除 detail + translations） |

### 3.2 翻译（分段1）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/product-pool/{id}/translate` | 触发翻译，写入 product_translations（可指定 language，默认 en） |
| `PUT` | `/product-pool/{id}/translate/{lang}` | 手动修正某语言的翻译结果 |
| `POST` | `/product-pool/batch-translate` | 批量翻译 {ids: [], language: "en"} |

### 3.3 定价（分段1）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/product-pool/{id}/price` | 触发定价计算，结果写回主表 |
| `PUT` | `/product-pool/{id}/price` | 手动调整售价 |
| `POST` | `/product-pool/batch-price` | 批量定价 {ids: []} |

### 3.4 修图（分段2）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/product-pool/{id}/process-images` | 触发修图（从 detail.images 读取，下载→S3→ComfyUI） |
| `GET` | `/product-pool/{id}/images` | 获取图片对比列表（原图 vs 处理后） |
| `PUT` | `/product-pool/{id}/images/{idx}` | 确认/舍弃/重试单张图片 |

### 3.5 上架（分段3）

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/imports` | 从选品池创建上架任务（关联 product_pool_id + shop_id） |
| `POST` | `/imports/{id}/sync` | 触发 Shopify 同步（从主表+detail+translation 组装数据） |

### 3.6 任务日志

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/product-pool/{id}/tasks` | 该商品所有任务日志（支持 ?type=translate） |
| `POST` | `/product-pool/{id}/tasks/{task_id}/retry` | 重试失败任务 |

---

## 4. 前端页面

### 4.1 选品池页面 `/product-pool`

**列表视图：**
| 主图 | 商品标题 | 成本价 | 状态 | 操作 |
|------|---------|--------|------|------|
| 缩略图 | 夏季纯棉T恤... | ¥12.50 | 🟡已抓取 | 翻译定价 / 修图 / 上架 / 删除 |

- 状态标签颜色映射
- 批量选择 + 批量翻译定价
- 搜索（标题）+ 状态筛选

**详情视图（点击行展开或弹框）：**
- 原始数据：标题、描述、图片列表、SKU 表格
- 翻译结果：英文标题/描述（可编辑）
- 定价明细：成本→汇率→倍率→售价（可调整）
- 图片对比：原图 | 处理后，逐张确认
- **任务日志**：时间线展示翻译/修图/上架各次执行状态，失败可重试

### 4.2 任务日志面板（详情内嵌）

```
┌─────────────────────────────────────────┐
│  📋 任务日志                              │
│  ┌─────────────────────────────────────┐ │
│  │ 2026-06-10 15:30  🌐 翻译 (en)       │ │
│  │ ✅ 完成  耗时 2.3s                    │ │
│  │ → "Summer Cotton T-Shirt..."        │ │
│  ├─────────────────────────────────────┤ │
│  │ 2026-06-10 15:32  🖼 修图 (图片 3/8) │ │
│  │ ❌ 失败  水印去除不完整               │ │
│  │ [🔄 重试]                            │ │
│  ├─────────────────────────────────────┤ │
│  │ 2026-06-10 15:35  🚀 上架           │ │
│  │ ✅ 完成  Shopify ID: 123456789      │ │
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 4.3 修图预览组件
```
┌─────────────────────────────────────────┐
│  图片 1/8                                │
│  ┌──────────┐    ┌──────────┐           │
│  │  原图     │ → │  处理后   │           │
│  │  (1688)  │    │  (S3)    │           │
│  └──────────┘    └──────────┘           │
│  [✓ 确认]  [↻ 重试]  [✗ 舍弃]          │
└─────────────────────────────────────────┘
```

### 4.4 导入任务页面 `/imports`

- 新增「从选品池创建」按钮
- 选择目标店铺 → 确认上架
- 列表显示同步状态

---

## 5. 实施步骤

| 序号 | 任务 | 涉及文件 |
|:----:|------|---------|
| 1 | 创建四表模型 + DB 迁移 (product_pools, product_details, product_translations, task_logs) | `models/__init__.py` |
| 2 | 选品池 CRUD API（创建时同时写主表+detail，去重逻辑） | `api/v1/product_pool.py` |
| 3 | 翻译服务（写 product_translations，支持多语言） | `services/translate_service.py` |
| 4 | 定价服务（读 detail.skus 计算，结果写回主表） | `services/pricing_service.py` (改) |
| 5 | 修图服务（读 detail.images，下载→S3→ComfyUI，状态跟踪） | `services/image_service.py` (改) |
| 6 | ImportTask 简化 + 关联 product_pool_id | `models/`, `api/v1/imports.py` |
| 7 | Shopify 同步服务（从主表+detail+translation 组装数据） | `services/shopify_sync_service.py` |
| 8 | 批量翻译/定价端点 | `api/v1/product_pool.py` |
| 9 | 插件改造（调 `/product-pool`） | `extension/src/` |
| 10 | 选品池前端页面 + 详情弹框（翻译/定价/修图对比） | `admin/src/app/product-pool/` |
| 11 | 修图预览组件（左右对比 + 逐张确认） | `admin/src/components/ImageCompare.tsx` |
| 12 | 导入任务前端改造（从选品池创建上架） | `admin/src/app/imports/` |

---

## 6. 技术备忘

- 图片处理流程：URL → `ImageService.download()` → `ImageService.upload_to_s3()` → `ComfyUIClient.process()` → 写回 `processed_url`
- 每张图片独立状态：`url_only | downloaded | processing | done | failed`
- 去重逻辑：`offer_id` 唯一索引，`INSERT OR REPLACE` 语义
- 翻译/定价使用现有 `ProviderRouter` 和 `PricingEngine`，只是调用入口从 Pipeline 移到独立的 Service
