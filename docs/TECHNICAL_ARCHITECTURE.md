# 技术架构文档

## DropShipFlow — 1688 → Shopify 一键上架系统

| 文档信息 | |
|---------|---|
| **版本** | v1.0 |
| **状态** | 草案 |
| **创建日期** | 2026-06-09 |
| **最后更新** | 2026-06-09 |

---

## 目录

1. [架构概述](#1-架构概述)
2. [系统架构图](#2-系统架构图)
3. [技术栈选型](#3-技术栈选型)
4. [模块详细设计](#4-模块详细设计)
   - 4.1 [浏览器插件](#41-浏览器插件)
   - 4.2 [API 网关与后端服务](#42-api-网关与后端服务)
   - 4.3 [用户与认证模块](#43-用户与认证模块)
   - 4.4 [商品管理模块](#44-商品管理模块)
   - 4.5 [AI 翻译模块](#45-ai-翻译模块)
   - 4.6 [ComfyUI 图像处理模块](#46-comfyui-图像处理模块)
   - 4.7 [定价规则引擎](#47-定价规则引擎)
   - 4.8 [Shopify 同步模块](#48-shopify-同步模块)
   - 4.9 [任务队列与编排](#49-任务队列与编排)
   - 4.10 [素材存储与 CDN](#410-素材存储与-cdn)
5. [数据库设计](#5-数据库设计)
6. [API 接口设计](#6-api-接口设计)
7. [数据流与交互时序](#7-数据流与交互时序)
8. [安全设计](#8-安全设计)
9. [部署架构](#9-部署架构)
10. [监控与运维](#10-监控与运维)
11. [扩展性设计](#11-扩展性设计)

---

## 1. 架构概述

### 1.1 架构原则

| 原则 | 说明 |
|------|------|
| **关注点分离** | 抓取、翻译、图像处理、定价、上传各自独立为模块，通过消息队列解耦 |
| **异步优先** | 所有耗时操作（翻译、图像处理、Shopify 同步）均异步执行，前端通过 WebSocket/轮询获取进度 |
| **配置驱动** | DOM 选择器、定价规则、ComfyUI Workflow 均为远程配置，避免硬编码 |
| **防御性设计** | 每个外部依赖都有降级策略，任一环节失败不影响其他 |
| **12-Factor App** | 配置环境变量化、无状态进程、端口绑定、日志流式输出 |

### 1.2 系统边界

```
┌─────────────────────────────────────────────────────────┐
│                     DropShipFlow 系统边界                 │
│                                                           │
│   ┌──────────┐     ┌──────────────┐     ┌────────────┐  │
│   │ Chrome   │────▶│  后端服务     │────▶│  Shopify   │  │
│   │ Extension│     │  (FastAPI)   │     │  API       │  │
│   └──────────┘     └──────┬───────┘     └────────────┘  │
│                           │                               │
│              ┌────────────┼────────────┐                 │
│              ▼            ▼            ▼                 │
│        ┌─────────┐ ┌──────────┐ ┌──────────┐           │
│        │ DeepSeek│ │ ComfyUI  │ │ OSS/CDN  │           │
│        │ API     │ │ Server   │ │ (R2/S3)  │           │
│        └─────────┘ └──────────┘ └──────────┘           │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

---

## 2. 系统架构图

> 完整的交互式架构图请查看：[architecture-diagram.html](./architecture-diagram.html)

### 2.1 架构分层

| 层级 | 组件 | 职责 |
|------|------|------|
| **表现层 (Presentation)** | Chrome Extension、管理后台 Web App | 用户交互、数据展示 |
| **网关层 (Gateway)** | Nginx / Traefik | 反向代理、SSL 终止、限流 |
| **应用层 (Application)** | FastAPI 后端服务 | 业务逻辑、API 路由、认证授权 |
| **消息层 (Messaging)** | Celery + Redis | 异步任务分发、重试、优先级队列 |
| **处理层 (Processing)** | Celery Workers (翻译/图像/上传) | 执行具体的耗时任务 |
| **数据层 (Data)** | PostgreSQL、Redis、Cloudflare R2 | 持久化存储、缓存、文件存储 |
| **外部层 (External)** | DeepSeek API、ComfyUI Server、Shopify API | 第三方服务依赖 |

---

## 3. 技术栈选型

### 3.1 详细选型

| 组件 | 技术 | 版本 | 选型理由 |
|------|------|------|---------|
| **浏览器插件** | Plasmo (React + TypeScript) | ^1.0 | Manifest V3 开箱即用、HMR 开发体验、TypeScript 类型安全 |
| **插件 UI** | React 18 + Tailwind CSS | 18.x | 轻量、生态丰富、样式原子化 |
| **后端框架** | Python FastAPI | 0.111+ | 异步原生、自动 API 文档、Pydantic 验证、AI 生态兼容 |
| **ORM** | SQLAlchemy 2.0 + Alembic | 2.0 | 异步支持、迁移工具、社区成熟 |
| **任务队列** | Celery + Redis | 5.4 + 7.x | Python 原生、稳定可靠、支持优先级和定时任务 |
| **数据库** | PostgreSQL | 16 | JSONB 灵活存储、全文搜索、成熟可靠 |
| **缓存** | Redis | 7.x | 高性能、支持多种数据结构 |
| **文件存储** | Cloudflare R2 (S3 兼容) | — | 零出口费用、全球 CDN、S3 API 兼容 |
| **AI 翻译** | DeepSeek V3 / OpenAI GPT-4o-mini | — | 高性价比、中文翻译质量优秀 |
| **图像处理** | ComfyUI | latest | 可视化工作流、API 支持、社区活跃 |
| **图像模型** | LaMa (去水印), RMBG-2.0 (去背景), Flux (生成) | — | 各自领域 SOTA |
| **前端管理台** | Next.js 14 + shadcn/ui | 14.x | React 全栈、SSR、组件库美观 |
| **部署** | Docker + Docker Compose | — | 环境一致性、简化部署 |
| **CI/CD** | GitHub Actions | — | 免费额度、生态集成 |
| **监控** | Prometheus + Grafana / Sentry | — | 指标采集、错误追踪、可视化 |

### 3.2 为什么不选其他方案

| 方案 | 不选的理由 |
|------|-----------|
| Node.js 后端 | Python 在 AI/图像处理生态上有天然优势（ComfyUI SDK、图像处理库） |
| MongoDB | 商品数据有强关系（用户-店铺-商品-任务），关系型数据库更合适 |
| RabbitMQ | Celery + Redis 已满足需求，减少运维组件 |
| AWS S3 | R2 零出口费，对图片 CDN 分发场景更友好 |
| Kubernetes | MVP 阶段过度设计，Docker Compose 足够 |

---

## 4. 模块详细设计

### 4.1 浏览器插件

#### 4.1.1 目录结构

```
extension/
├── package.json
├── plasmo.config.ts
├── tsconfig.json
├── src/
│   ├── contents/
│   │   ├── 1688-product.ts        # 1688 商品页 Content Script
│   │   └── 1688-search.ts          # 1688 搜索页 Content Script (P2)
│   ├── background/
│   │   ├── index.ts                # Service Worker（含 onMessageExternal 监听）
│   │   └── messages/
│   │       ├── scraper.ts          # 抓取消息处理
│   │       └── auth.ts             # Token 接收/存储/刷新
│   ├── popup/
│   │   ├── index.tsx               # Popup 入口
│   │   ├── components/
│   │   │   ├── ProductPreview.tsx  # 商品预览卡片
│   │   │   ├── SkuList.tsx         # SKU 列表
│   │   │   ├── ImageGallery.tsx    # 素材图预览
│   │   │   ├── UploadOptions.tsx   # 上传选项
│   │   │   └── ProgressIndicator.tsx
│   │   └── hooks/
│   │       ├── useProductData.ts   # 抓取数据 hook
│   │       └── useAuth.ts          # 认证状态 hook
│   ├── components/
│   │   └── FloatingButton.tsx      # 页面浮动按钮
│   ├── lib/
│   │   ├── scraper-config.ts       # 远程配置加载
│   │   ├── dom-selectors.ts        # DOM 选择器引擎
│   │   ├── api-client.ts           # 后端 API 客户端
│   │   └── image-downloader.ts     # 图片下载工具
│   └── assets/
│       └── icon.svg
```

#### 4.1.2 Content Script 核心逻辑

```typescript
// contents/1688-product.ts — 简化版架构
import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["*://detail.1688.com/offer/*.html"],
  world: "MAIN"  // 访问页面主世界的 JavaScript 对象
}

// 1. 从远程加载 DOM 选择器配置
async function loadSelectorConfig() {
  const res = await fetch("https://api.dropshipflow.com/v1/config/scraper")
  return res.json()
}

// 2. 使用选择器提取数据
async function scrapeProduct(selectors: SelectorConfig): Promise<ProductData> {
  return {
    title: extractText(selectors.title),
    priceRange: extractText(selectors.price),
    images: extractImages(selectors.images),
    skus: extractSkus(selectors.skus),
    description: extractHTML(selectors.description),
    videoUrl: extractAttr(selectors.video, 'src'),
    offerId: extractOfferIdFromURL(),
  }
}

// 3. 通过消息通道发送给 Popup/Background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SCRAPE_PRODUCT") {
    scrapeProduct(msg.selectors).then(sendResponse)
    return true  // 保持消息通道开放（异步响应）
  }
})
```

#### 4.1.3 选择器配置协议

```typescript
// 远程配置 JSON Schema
interface SelectorConfig {
  version: string           // 配置版本号，如 "2026-06-09"
  platform: "1688"
  selectors: {
    title: SelectorRule
    price: SelectorRule
    images: SelectorRule
    skus: {
      container: SelectorRule
      spec: SelectorRule
      price: SelectorRule
      stock: SelectorRule
      image: SelectorRule
    }
    description: SelectorRule
    video: SelectorRule
    attributes: SelectorRule
  }
}

interface SelectorRule {
  primary: string           // 主选择器，如 ".offer-title"
  fallback?: string         // 备用选择器
  attribute?: string        // 提取属性而非 textContent，如 "src"
  type: "text" | "html" | "attr" | "list"
  postProcess?: string      // 后处理函数名（注册在插件中的转换函数）
}
```

#### 4.1.4 Popup 组件状态机

```
States:
  UNAUTHENTICATED — 未登录，显示登录入口
  IDLE            — 已登录，等待用户操作（可能在或不在商品页）
  INVALID_PAGE    — 已登录但不在 1688 商品详情页
  SCRAPING        — 正在抓取页面数据
  PREVIEW         — 显示抓取结果，等待用户确认
  UPLOADING       — 正在提交到后端
  ERROR           — 抓取/提交失败

Transitions:
  UNAUTHENTICATED → IDLE       (Web 端登录成功，Token 回传)
  IDLE → UNAUTHENTICATED       (用户退出登录 / Token 过期且无法刷新)
  IDLE → SCRAPING              (在商品页，用户点击抓取)
  IDLE → INVALID_PAGE          (检测到不在商品页)
  INVALID_PAGE → IDLE          (导航到商品页)
  SCRAPING → PREVIEW           (抓取成功)
  SCRAPING → ERROR             (抓取失败)
  PREVIEW → UPLOADING          (用户点击确认)
  PREVIEW → IDLE               (用户取消)
  UPLOADING → IDLE             (提交成功)
  UPLOADING → ERROR            (提交失败)
```

### 4.2 API 网关与后端服务

#### 4.2.1 后端目录结构

```
backend/
├── Dockerfile
├── pyproject.toml
├── alembic.ini
├── alembic/
│   └── versions/
├── app/
│   ├── main.py                 # FastAPI 应用入口
│   ├── config.py               # 配置管理（pydantic-settings）
│   ├── dependencies.py         # 依赖注入
│   ├── api/
│   │   ├── v1/
│   │   │   ├── router.py
│   │   │   ├── auth.py         # 认证接口
│   │   │   ├── products.py     # 商品 CRUD
│   │   │   ├── imports.py      # 导入任务接口
│   │   │   ├── shops.py        # 店铺管理
│   │   │   ├── pricing.py      # 定价规则
│   │   │   ├── config.py       # 远程配置下发
│   │   │   └── webhooks.py     # Shopify Webhook 接收
│   ├── models/
│   │   ├── user.py
│   │   ├── shop.py
│   │   ├── product.py
│   │   ├── import_task.py
│   │   └── pricing_rule.py
│   ├── schemas/                 # Pydantic 请求/响应模型
│   ├── services/
│   │   ├── auth_service.py
│   │   ├── product_service.py
│   │   ├── import_service.py    # 导入编排
│   │   ├── pricing_service.py   # 定价计算
│   │   ├── shopify_service.py   # Shopify API 封装
│   │   └── image_service.py     # 图片上传管理
│   ├── tasks/                   # Celery 任务
│   │   ├── celery_app.py
│   │   ├── translate.py
│   │   ├── process_image.py
│   │   ├── calculate_price.py
│   │   └── sync_shopify.py
│   ├── integrations/
│   │   ├── llm/
│   │   │   ├── base.py
│   │   │   ├── deepseek.py
│   │   │   └── openai.py
│   │   ├── comfyui/
│   │   │   ├── client.py        # ComfyUI WebSocket API 客户端
│   │   │   └── workflows/       # Workflow JSON 模板
│   │   └── shopify/
│   │       └── client.py        # Shopify REST + GraphQL 客户端
│   └── core/
│       ├── security.py
│       ├── logging.py
│       └── exceptions.py
└── tests/
```

#### 4.2.2 FastAPI 应用入口

```python
# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1.router import api_router
from app.config import settings

app = FastAPI(
    title="DropShipFlow API",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")

@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "1.0.0"}
```

#### 4.2.3 API 版本策略

- URL 路径版本化：`/api/v1/`, `/api/v2/`
- 向后兼容 2 个大版本
- Deprecation Header：`Sunset: Sat, 01 Jan 2027 00:00:00 GMT`

### 4.3 用户与认证模块

#### 4.3.1 认证流程

认证采用 **「Web 端登录 → Token 自动回传插件」** 方案。插件不内置登录表单。

```
┌──────────────────┐     ┌─────────────────┐     ┌──────────────┐     ┌───────────┐
│  Chrome Extension│     │  Web 管理后台    │     │   FastAPI    │     │ PostgreSQL│
│  (Popup/         │     │  admin.dropship │     │   Backend    │     │           │
│   Background)    │     │  flow.com       │     │              │     │           │
└────────┬─────────┘     └───────┬─────────┘     └──────┬───────┘     └─────┬─────┘
         │                       │                      │                   │
         │ ① 未登录 — Popup 显示  │                      │                   │
         │   "🔗 登录/注册"按钮    │                      │                   │
         │                       │                      │                   │
         │ chrome.tabs.create()  │                      │                   │
         │ 打开 /login?source=   │                      │                   │
         │ extension             │                      │                   │
         │──────────────────────▶│                      │                   │
         │                       │                      │                   │
         │                       │ ② 用户在 Web 端输入   │                   │
         │                       │ 邮箱+密码             │                   │
         │                       │ POST /api/v1/auth/   │                   │
         │                       │ login                │                   │
         │                       │─────────────────────▶│                   │
         │                       │                      │ SELECT + bcrypt  │
         │                       │                      │─────────────────▶│
         │                       │  200 {access_token,  │                   │
         │                       │       refresh_token} │                   │
         │                       │◀─────────────────────│                   │
         │                       │                      │                   │
         │ ③ Web 端通过           │                      │                   │
         │ chrome.runtime        │                      │                   │
         │ .sendMessage() 回传   │                      │                   │
         │ Token 给插件           │                      │                   │
         │◀──────────────────────│                      │                   │
         │                       │                      │                   │
         │ ④ 存入                 │                      │                   │
         │ chrome.storage.local  │                      │                   │
         │ 此后自动读取 Token     │                      │                   │
         │                       │                      │                   │
         │ ⑤ （后续 API 请求带    │                      │                   │
         │ Authorization: Bearer │                      │                   │
         │  {access_token}）     │                      │                   │
         │─────────────────────────────────────────────▶│                   │
```

**关键实现：**

| 要点 | 实现 |
|------|------|
| **Web → 插件通信** | `manifest.json` 中配置 `externally_connectable.matches: ["https://admin.dropshipflow.com/*"]`，Web 端通过 `chrome.runtime.sendMessage(EXTENSION_ID, {type: "AUTH_SUCCESS", ...})` 发送 Token |
| **插件接收 Token** | `background/index.ts` 中监听 `chrome.runtime.onMessageExternal`，验证 sender 是 admin 域名后存储 |
| **Token 存储** | `chrome.storage.local`，插件专属存储空间，其他网站/扩展无法访问 |
| **Token 刷新** | 每次 API 请求前检查过期时间，过期则用 Refresh Token 换新，用户完全无感 |
| **退出登录** | 清除 `chrome.storage.local` 中的 Token，Popup 回到 `UNAUTHENTICATED` 状态 |
| **安全** | Token 通过 Chrome 内部 IPC 传递（不经过网络、不暴露给网页 DOM）；插件 ID 固定；`externally_connectable` 白名单限制来源 |

#### 4.3.2 Token 设计

| Token 类型 | 有效期 | 存储位置 | 用途 |
|-----------|--------|---------|------|
| Access Token (JWT) | 15 分钟 | `chrome.storage.local`（插件）/ `localStorage`（Web） | API 请求认证 |
| Refresh Token | 30 天 | `chrome.storage.local`（插件）/ HttpOnly Cookie（Web） | 刷新 Access Token |
| Shopify Access Token | 永久 (直到 revoke) | 数据库（AES-256 加密） | 调用 Shopify API |

#### 4.3.3 RBAC 权限中间件

```python
# app/core/permissions.py
from functools import wraps
from fastapi import Depends, HTTPException, status
from app.dependencies import get_current_user
from app.models.user import User

class Permission:
    """权限常量"""
    # 团队管理
    CREATE_TEAM = "create_team"
    DELETE_TEAM = "delete_team"
    MANAGE_TEAM_MEMBERS = "manage_team_members"
    MANAGE_SHOPS = "manage_shops"

    # 商品操作
    IMPORT_PRODUCT = "import_product"
    EDIT_PRODUCT = "edit_product"
    DELETE_PRODUCT = "delete_product"

    # 定价规则
    MANAGE_PRICING = "manage_pricing"

# 角色 → 权限映射
ROLE_PERMISSIONS = {
    "super_admin": {
        Permission.CREATE_TEAM,
        Permission.DELETE_TEAM,
        Permission.MANAGE_TEAM_MEMBERS,
        Permission.MANAGE_SHOPS,
        Permission.IMPORT_PRODUCT,
        Permission.EDIT_PRODUCT,
        Permission.DELETE_PRODUCT,
        Permission.MANAGE_PRICING,
    },
    "manager": {
        Permission.MANAGE_TEAM_MEMBERS,
        Permission.MANAGE_SHOPS,
        Permission.IMPORT_PRODUCT,
        Permission.EDIT_PRODUCT,
        Permission.DELETE_PRODUCT,
        Permission.MANAGE_PRICING,
    },
    "member": {
        Permission.IMPORT_PRODUCT,
        Permission.EDIT_PRODUCT,
        Permission.DELETE_PRODUCT,
        Permission.MANAGE_PRICING,
    },
}

# 套餐 → 可用功能门控 (改为数据库驱动，以下仅为默认种子数据参考)
# 实际运行时通过 QuotaChecker 从 quota_rules 和 subscription_plans 表读取
    "free": {
        "max_imports_per_month": 10,
        "watermark_removal": False,
        "white_background": False,
        "marketing_image": False,
        "multi_language": False,
        "custom_pricing": False,
    },
    "pro": {
        "max_imports_per_month": 200,
        "watermark_removal": True,
        "white_background": True,
        "marketing_image": False,
        "multi_language": True,
        "custom_pricing": True,
    },
    "business": {
        "max_imports_per_month": 1000,
        "watermark_removal": True,
        "white_background": True,
        "marketing_image": True,
        "multi_language": True,
        "custom_pricing": True,
    },
    "enterprise": {
        "max_imports_per_month": -1,  # 无限
        "watermark_removal": True,
        "white_background": True,
        "marketing_image": True,
        "multi_language": True,
        "custom_pricing": True,
    },
}


def require_permission(permission: str):
    """权限校验装饰器：检查当前用户是否有指定权限"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, current_user: User = Depends(get_current_user), **kwargs):
            user_permissions = ROLE_PERMISSIONS.get(current_user.role, set())
            if permission not in user_permissions:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Role '{current_user.role}' lacks permission: {permission}"
                )
            return await func(*args, current_user=current_user, **kwargs)
        return wrapper
    return decorator


def require_team_access(allow_super_admin: bool = True):
    """团队数据隔离中间件：确保只能访问本团队数据，超管可选择绕过"""
    def decorator(func):
        @wraps(func)
        async def wrapper(
            *args,
            team_id: str,
            current_user: User = Depends(get_current_user),
            **kwargs
        ):
            if current_user.role == "super_admin" and allow_super_admin:
                # 超管可以访问任意团队
                pass
            elif current_user.team_id != team_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied: data belongs to another team"
                )
            return await func(*args, team_id=team_id, current_user=current_user, **kwargs)
        return wrapper
    return decorator


def check_plan_feature(feature: str):
    """套餐功能门控装饰器：从数据库读取配额规则检查功能开关"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, current_user: User = Depends(get_current_user), **kwargs):
            team = current_user.team
            if not team:
                raise HTTPException(status_code=400, detail="User has no team")

            # 从 DB 读取配额规则
            checker = QuotaChecker(team)
            has_feature = await checker.has_feature(feature)

            if not has_feature:
                raise HTTPException(
                    status_code=status.HTTP_402_PAYMENT_REQUIRED,
                    detail=f"Feature '{feature}' not available on your plan. Upgrade to unlock."
                )
            return await func(*args, current_user=current_user, **kwargs)
        return wrapper
    return decorator


# === 数据库驱动的配额检查器 ===

class QuotaChecker:
    """从 subscription_plans + quota_rules 表读取配额，实时校验"""

    def __init__(self, team):
        self.team = team
        self._quota = None  # lazy load

    async def _load(self):
        if self._quota is None:
            plan = await self.team.awaitable_attrs.plan  # subscription_plan
            self._quota = await plan.awaitable_attrs.quota_rule

    async def has_feature(self, feature: str) -> bool:
        await self._load()
        return getattr(self._quota, feature, False)

    async def check_team_members(self) -> bool:
        """检查团队人数是否超限"""
        await self._load()
        if self._quota.max_team_members == 0:
            return True  # 0 = 无限
        count = await db.scalar(
            select(func.count()).where(User.team_id == self.team.id)
        )
        return count <= self._quota.max_team_members

    async def check_daily_import(self) -> bool:
        """检查今日导入是否超限"""
        await self._load()
        if self._quota.daily_import_limit == 0:
            return True
        today = func.date(func.now())
        count = await db.scalar(
            select(func.count()).where(
                ImportTask.team_id == self.team.id,
                func.date(ImportTask.created_at) == today
            )
        )
        return count < self._quota.daily_import_limit

    async def check_monthly_import(self) -> bool:
        """检查本月导入是否超限"""
        await self._load()
        if self._quota.monthly_import_limit == 0:
            return True
        month_start = func.date_trunc('month', func.now())
        count = await db.scalar(
            select(func.count()).where(
                ImportTask.team_id == self.team.id,
                ImportTask.created_at >= month_start
            )
        )
        return count < self._quota.monthly_import_limit

    async def check_shops(self) -> bool:
        """检查店铺数量是否超限"""
        await self._load()
        if self._quota.max_shops == 0:
            return True
        count = await db.scalar(
            select(func.count()).where(Shop.team_id == self.team.id)
        )
        return count < self._quota.max_shops

    async def get_remaining_imports(self) -> int:
        """返回本月剩余可用导入次数"""
        await self._load()
        if self._quota.monthly_import_limit == 0:
            return -1  # 无限
        month_start = func.date_trunc('month', func.now())
        used = await db.scalar(
            select(func.count()).where(
                ImportTask.team_id == self.team.id,
                ImportTask.created_at >= month_start
            )
        )
        return self._quota.monthly_import_limit - used


# 使用示例:
# @router.post("/shops")
# @require_permission(Permission.MANAGE_SHOPS)
# @require_team_access()
# async def create_shop(team_id: str, ...): ...
#
# @router.post("/images/watermark-removal")
# @check_plan_feature("watermark_removal")
# async def remove_watermark(...): ...
```

#### 4.3.4 API 请求中的团队上下文注入

```python
# app/dependencies.py
from fastapi import Depends, HTTPException, status, Header
from app.models.user import User

async def get_current_team(
    current_user: User = Depends(get_current_user),
    x_team_id: str | None = Header(None)  # 超管通过 Header 指定要操作的团队
) -> str:
    """解析当前请求的团队上下文"""
    if current_user.role == "super_admin":
        if x_team_id:
            # 超管通过 X-Team-Id header 指定目标团队
            return x_team_id
        # 超管不指定团队时，返回特殊标记（用于全局查询）
        return None  # 表示"所有团队"
    else:
        # 非超管只能操作本团队
        return current_user.team_id
```

#### 4.3.5 审计日志中间件

```python
# app/core/audit.py
import json
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.audit_log import AuditLog

class AuditLogger:
    """审计日志记录器 — 全自动，零侵入"""

    def __init__(self, db: AsyncSession, user_id: str, team_id: str | None,
                 ip_address: str | None = None, user_agent: str | None = None):
        self.db = db
        self.user_id = user_id
        self.team_id = team_id
        self.ip_address = ip_address
        self.user_agent = user_agent

    async def log(self, action: str, entity_type: str, entity_id: str = None,
                  entity_label: str = None, old_values: dict = None,
                  new_values: dict = None, metadata: dict = None):
        """写入一条审计日志"""
        log_entry = AuditLog(
            team_id=self.team_id,
            user_id=self.user_id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id else None,
            entity_label=entity_label,
            old_values=old_values,
            new_values=new_values,
            ip_address=self.ip_address,
            user_agent=self.user_agent[:500] if self.user_agent else None,
            metadata=metadata or {},
        )
        self.db.add(log_entry)
        # 注意：不在此处 commit，由请求生命周期的 commit 统一处理


# === ORM 模型层自动捕获 ===

from sqlalchemy import event
from sqlalchemy.orm import Session

# 监听所有模型的 after_insert / after_update / after_delete
TRACKED_MODELS = ["Product", "PricingRule", "Shop", "ImportTask", "User", "Team"]


@event.listens_for(Session, "after_flush")
def capture_audit_logs(session, flush_context):
    """SQLAlchemy 事件钩子：自动捕获所有变更"""
    # 从 session.info 获取当前请求上下文
    ctx = session.info.get("audit_context")
    if not ctx:
        return  # 非 HTTP 请求（如 Celery worker、脚本）时跳过

    logger = AuditLogger(
        db=session,
        user_id=ctx["user_id"],
        team_id=ctx.get("team_id"),
        ip_address=ctx.get("ip_address"),
        user_agent=ctx.get("user_agent"),
    )

    for obj in session.new:
        if type(obj).__name__ in TRACKED_MODELS:
            session.info.setdefault("_audit_deferred", []).append(
                _build_create_log(obj, logger)
            )

    for obj in session.dirty:
        if type(obj).__name__ in TRACKED_MODELS:
            session.info.setdefault("_audit_deferred", []).append(
                _build_update_log(obj, logger)
            )

    for obj in session.deleted:
        if type(obj).__name__ in TRACKED_MODELS:
            session.info.setdefault("_audit_deferred", []).append(
                _build_delete_log(obj, logger)
            )


def _build_create_log(obj, logger):
    return logger.log(
        action=f"{type(obj).__name__.lower()}.create",
        entity_type=type(obj).__name__.lower(),
        entity_id=getattr(obj, "id", None),
        entity_label=_get_entity_label(obj),
        new_values=_serializable_dict(obj),
    )


def _build_update_log(obj, logger):
    """对比新旧值，只记录实际变更的字段"""
    old = {}
    new = {}
    for attr in obj.__mapper__.attrs.keys():
        hist = getattr(obj.__class__, attr).history
        if hist.has_changes():
            old[attr] = _safe_value(hist.deleted[0] if hist.deleted else None)
            new[attr] = _safe_value(hist.added[0] if hist.added else None)
    if old or new:
        return logger.log(
            action=f"{type(obj).__name__.lower()}.update",
            entity_type=type(obj).__name__.lower(),
            entity_id=getattr(obj, "id", None),
            entity_label=_get_entity_label(obj),
            old_values=old,
            new_values=new,
        )


def _get_entity_label(obj) -> str:
    """提取人类可读的对象标签"""
    for attr in ["name", "title", "title_en", "shop_domain", "email"]:
        label = getattr(obj, attr, None)
        if label and attr == "email":
            return label  # 邮箱直接返回
        if label and len(str(label)) > 0:
            return str(label)[:200]
    return str(getattr(obj, "id", "unknown"))


def _safe_value(val) -> str:
    """安全序列化值"""
    if isinstance(val, datetime):
        return val.isoformat()
    if val is None:
        return None
    try:
        json.dumps(val)
        return val
    except (TypeError, ValueError):
        return str(val)


def _serializable_dict(obj) -> dict:
    """将对象转为可序列化的字典"""
    result = {}
    for col in obj.__table__.columns:
        val = getattr(obj, col.name, None)
        if val is not None:
            result[col.name] = _safe_value(val)
    return result


# === 请求上下文中注入审计上下文 ===

# app/dependencies.py
from fastapi import Request
from app.core.audit import inject_audit_context

async def audit_middleware(request: Request, call_next):
    """在每个 HTTP 请求中注入审计上下文到 SQLAlchemy session"""
    try:
        current_user = await get_current_user_optional(request)
        if current_user:
            request.state.db_session.info["audit_context"] = {
                "user_id": current_user.id,
                "team_id": current_user.team_id,
                "ip_address": request.client.host if request.client else None,
                "user_agent": request.headers.get("user-agent"),
            }
    except Exception:
        pass  # 未登录请求不设置上下文
    return await call_next(request)
```

#### 4.3.6 日志清理定时任务

```python
# app/tasks/cleanup.py
from datetime import datetime, timedelta
from app.tasks.celery_app import celery_app
from app.models.audit_log import AuditLog

PLAN_RETENTION_DAYS = {
    "free": 30,
    "pro": 90,
    "business": 365,
    "enterprise": -1,  # 不自动清理
}

@celery_app.task
def cleanup_expired_audit_logs():
    """每天凌晨运行，清理过期的审计日志"""
    for plan, days in PLAN_RETENTION_DAYS.items():
        if days == -1:
            continue  # Enterprise 不自动清理
        cutoff = datetime.utcnow() - timedelta(days=days)
        # 查找该套餐下所有团队，删除过期的日志
        AuditLog.query.filter(
            AuditLog.team.has(plan=plan),
            AuditLog.created_at < cutoff
        ).delete()
        # 注意：由于撤销了 DELETE 权限，需使用 SUPERUSER 角色执行
```

#### 4.3.7 在线会话追踪

```python
# app/core/session_tracker.py
import json
import time
from redis import Redis

redis = Redis.from_url(settings.REDIS_URL)
SESSION_TTL = 15 * 60  # 15 分钟 (与 Access Token 一致)

class SessionTracker:
    """Redis 驱动的在线会话追踪"""

    @staticmethod
    def track(user_id: str, metadata: dict):
        """记录/刷新一次用户活动"""
        key = f"active_session:{user_id}"
        data = {
            **metadata,
            "last_activity": int(time.time()),
            "last_activity_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        redis.setex(key, SESSION_TTL, json.dumps(data))

    @staticmethod
    def get_active_sessions() -> list[dict]:
        """获取所有在线用户列表"""
        sessions = []
        for key in redis.scan_iter("active_session:*"):
            data = redis.get(key)
            if data:
                session = json.loads(data)
                # 计算剩余时间
                ttl = redis.ttl(key)
                session["ttl_seconds"] = ttl
                session["status"] = "active" if ttl > 300 else "idle"
                sessions.append(session)
        return sorted(sessions, key=lambda s: s["last_activity"], reverse=True)

    @staticmethod
    def get_online_count() -> int:
        """在线用户总数"""
        return sum(1 for _ in redis.scan_iter("active_session:*"))

    @staticmethod
    def remove_session(user_id: str):
        """删除指定用户的会话记录"""
        redis.delete(f"active_session:{user_id}")


# FastAPI 中间件 — 每次请求刷新 session
async def session_tracking_middleware(request: Request, call_next):
    response = await call_next(request)
    user = getattr(request.state, "current_user", None)
    if user:
        SessionTracker.track(user.id, {
            "user_id": user.id,
            "email": user.email,
            "name": user.name,
            "team_id": user.team_id,
            "team_name": user.team.name if user.team else "—",
            "role": user.role,
            "ip_address": request.client.host if request.client else None,
            "user_agent": request.headers.get("user-agent", "")[:200],
            "client_type": "extension" if "extension" in (request.headers.get("user-agent", "")) else "web",
            "login_time": getattr(user, "login_time", None),
        })
    return response
```

#### 4.3.8 JWT 黑名单 + 强制下线

```python
# app/core/jwt_blacklist.py
from redis import Redis
import time

redis = Redis.from_url(settings.REDIS_URL)
BLACKLIST_PREFIX = "jwt_blacklist:"

class JWTBlacklist:
    """JWT 黑名单 — 用于强制踢人下线"""

    @staticmethod
    def add(jti: str, ttl: int):
        """将 token 加入黑名单，TTL 设置为 token 剩余有效时间"""
        redis.setex(f"{BLACKLIST_PREFIX}{jti}", ttl, "revoked")

    @staticmethod
    def is_blacklisted(jti: str) -> bool:
        """检查 token 是否已被撤销"""
        return redis.exists(f"{BLACKLIST_PREFIX}{jti}") > 0

    @staticmethod
    def force_logout(user_id: str):
        """强制用户下线：删除 session + 加入黑名单"""
        import json

        # 1. 读取用户的活跃 session，获取 jti
        session_key = f"active_session:{user_id}"
        data = redis.get(session_key)
        if data:
            session = json.loads(data)
            jti = session.get("jti")
            ttl = redis.ttl(session_key)  # 剩余 TTL

            # 2. 加入黑名单
            if jti and ttl > 0:
                JWTBlacklist.add(jti, ttl)

            # 3. 删除 session
            redis.delete(session_key)


# FastAPI 中间件 — 每次请求检查黑名单
async def jwt_blacklist_middleware(request: Request, call_next):
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if token:
        try:
            payload = jwt.decode(token, options={"verify_signature": False})
            jti = payload.get("jti")
            if jti and JWTBlacklist.is_blacklisted(jti):
                return JSONResponse(
                    status_code=401,
                    content={"detail": "您的会话已被管理员终止，请重新登录。"}
                )
        except Exception:
            pass
    return await call_next(request)
```

---

### 4.4 商品管理模块

#### 4.4.1 商品生命周期

```
                    ┌─────────┐
                    │ IMPORTED│  (从1688抓取，未翻译)
                    └────┬────┘
                         │ AI 翻译 + 图片处理
                         ▼
                    ┌─────────┐
                    │PROCESSED│  (已翻译，已处理图片)
                    └────┬────┘
                         │ 定价计算 + 推送到Shopify
                         ▼
                    ┌─────────┐
                    │  DRAFT  │  (Shopify 草稿)
                    └────┬────┘
                         │ 用户审核
                    ┌────┴────┐
                    ▼         ▼
              ┌─────────┐  ┌─────────┐
              │PUBLISHED│  │REJECTED │
              └─────────┘  └─────────┘
```

#### 4.4.2 导入任务状态机

```
States:
  PENDING             — 已接收，等待处理
  DOWNLOADING         — 正在下载素材
  TRANSLATING         — 正在 AI 翻译
  PROCESSING_IMAGES   — 正在 ComfyUI 处理图片
  CALCULATING_PRICE   — 正在计算售价
  SYNCING_SHOPIFY     — 正在同步到 Shopify
  COMPLETED           — 全部完成
  FAILED              — 处理失败
  PARTIALLY_COMPLETED — 部分完成（如图片处理失败但翻译成功）

Transitions (由 Celery 任务链驱动):
  PENDING → DOWNLOADING → TRANSLATING → PROCESSING_IMAGES
  → CALCULATING_PRICE → SYNCING_SHOPIFY → COMPLETED
  any → FAILED (异常时)
  any → PARTIALLY_COMPLETED (部分步骤跳过/失败)
```

---

### 4.5 AI 翻译模块

#### 4.5.1 Provider 抽象层

#### 4.5.0 ProviderRouter — 数据库驱动的 AI 提供商选择

```python
# app/integrations/llm/provider_router.py
from app.models.ai_provider import AIProvider
from app.integrations.llm.deepseek import DeepSeekProvider
from app.integrations.llm.openai import OpenAIProvider
from app.integrations.llm.anthropic import AnthropicProvider

PROVIDER_CLASSES = {
    "deepseek": DeepSeekProvider,
    "openai": OpenAIProvider,
    "anthropic": AnthropicProvider,
}

class ProviderRouter:
    """从数据库读取提供商配置，按优先级降级调用。text 和 vision 各自独立路由。"""

    def __init__(self, category: str = "text"):
        # category: "text" (翻译/文案) | "vision" (截图识别/图像理解)
        self.category = category

    async def _get_providers(self) -> list[AIProvider]:
        """获取匹配类别的提供商，按优先级升序排列"""
        return await AIProvider.query.where(
            AIProvider.is_active == True,
            AIProvider.category == self.category
        ).order_by(AIProvider.priority.asc()).all()

    async def call(self, prompt, images=None, **kwargs) -> str:
        """调用 AI，自动按优先级降级。vision 模式可传入 images 列表"""
        providers = await self._get_providers()
        last_error = None

        for provider_record in providers:
            try:
                provider_cls = PROVIDER_CLASSES[provider_record.provider_type]
                provider = provider_cls(
                    api_key=decrypt(provider_record.api_key_encrypted),
                    base_url=provider_record.api_base_url,
                    model=kwargs.get("model") or provider_record.default_model,
                )
                result = await provider.translate(prompt, images=images, **kwargs)
                return result
            except Exception as e:
                last_error = e
                continue

        raise Exception(f"All '{self.category}' AI providers failed. Last error: {last_error}")

    async def test_connection(self, provider_id: str) -> dict:
        """测试提供商连接是否正常"""
        provider_record = await AIProvider.get(provider_id)
        provider_cls = PROVIDER_CLASSES[provider_record.provider_type]
        provider = provider_cls(
            api_key=decrypt(provider_record.api_key_encrypted),
            base_url=provider_record.api_base_url,
            model=provider_record.default_model,
        )
        try:
            result = await provider.translate("ping", source_lang="en", target_lang="en")
            return {"ok": True, "latency_ms": result.get("latency_ms")}
        except Exception as e:
            return {"ok": False, "error": str(e)}
```

#### 4.5.1 LLM Provider 抽象层 (原有)

```python
# app/integrations/llm/base.py
from abc import ABC, abstractmethod

class LLMProvider(ABC):
    @abstractmethod
    async def translate(self, text: str, source_lang: str, target_lang: str, context: dict) -> str:
        """翻译单段文本"""
        pass

    @abstractmethod
    async def translate_batch(self, texts: list[str], source_lang: str, target_lang: str) -> list[str]:
        """批量翻译"""
        pass
```

```python
# app/integrations/llm/deepseek.py
class DeepSeekProvider(LLMProvider):
    def __init__(self, api_key: str, model: str = "deepseek-chat"):
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.deepseek.com/v1"
        )
        self.model = model

    async def translate(self, text, source_lang, target_lang, context):
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": TRANSLATION_SYSTEM_PROMPT},
                {"role": "user", "content": f"{context}\n\nTranslate: {text}"}
            ],
            temperature=0.3,
            max_tokens=2000,
        )
        return response.choices[0].message.content
```

#### 4.5.2 翻译 System Prompt

```
You are an expert e-commerce translator specializing in converting Chinese 
product listings to native, conversion-optimized English for Shopify stores.

TRANSLATION RULES:
1. TITLE: ≤70 characters. Include primary keyword. Write for humans + SEO.
2. DESCRIPTION: Marketing tone. Use bullet points for features. Add <br> for Shopify HTML.
3. SPECIFICATIONS: Translate precisely. "纯棉"→"100% Cotton", "均码"→"One Size".
4. SKU OPTIONS: Keep standard abbreviations (S/M/L/XL, not Small/Medium...).
5. MEASUREMENTS: Convert "厘米" to "cm", keep numbers exact.

PROHIBITED:
- Do NOT fabricate features not in the original
- Do NOT make medical/health claims
- Do NOT use competitor brand names
- Do NOT use exaggerated claims ("best", "#1", "perfect")

TONALITY: Professional, trustworthy, benefit-focused.
```

#### 4.5.3 降级与容错

```
优先级 1: DeepSeek V3 (主 Provider)
  → 失败时 → 
优先级 2: OpenAI GPT-4o-mini (备用 Provider)
  → 失败时 →
优先级 3: 保留中文原文 + 标记 "Translation Pending"
```

### 4.6 ComfyUI 图像处理模块

#### 4.6.1 ComfyUI 客户端

```python
# app/integrations/comfyui/client.py
import json
import uuid
import aiohttp
from typing import AsyncIterator

class ComfyUIClient:
    def __init__(self, base_url: str, ws_url: str):
        self.base_url = base_url    # e.g., http://gpu-node:8188
        self.ws_url = ws_url        # e.g., ws://gpu-node:8188/ws

    async def queue_prompt(self, workflow: dict) -> str:
        """提交 workflow，返回 prompt_id"""
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.base_url}/prompt",
                json={"prompt": workflow, "client_id": str(uuid.uuid4())}
            ) as resp:
                data = await resp.json()
                return data["prompt_id"]

    async def wait_for_completion(self, prompt_id: str, timeout: int = 300) -> dict:
        """通过 WebSocket 等待执行完成，返回输出图片 URLs"""
        async with aiohttp.ClientSession() as session:
            async with session.ws_connect(
                f"{self.ws_url}?clientId={prompt_id}"
            ) as ws:
                async for msg in ws:
                    data = json.loads(msg.data)
                    if data["type"] == "executed":
                        return self._extract_outputs(data)

    async def process_image(self, workflow_template: str, inputs: dict) -> dict:
        """一站式调用：加载模板 → 注入参数 → 提交 → 等待完成"""
        workflow = self._load_workflow(workflow_template)
        workflow = self._inject_inputs(workflow, inputs)
        prompt_id = await self.queue_prompt(workflow)
        return await self.wait_for_completion(prompt_id)
```

#### 4.6.2 Workflow 模板系统

```
backend/app/integrations/comfyui/workflows/
├── remove_watermark.json       # LaMa Inpaint
├── remove_background.json      # RMBG-2.0
├── white_background.json       # 合成白底图
├── marketing_main.json         # 营销主图
├── lifestyle_scene.json        # 场景图
└── resize_standard.json        # 尺寸标准化
```

每个 workflow JSON 中的可变参数使用 `{{PLACEHOLDER}}` 标记，运行时由客户端动态注入：

```json
{
  "3": {
    "inputs": {
      "image": "{{INPUT_IMAGE_URL}}",
      "mask": "{{MASK_IMAGE_URL}}"
    },
    "class_type": "LoadImage"
  }
}
```

#### 4.6.3 处理队列与 Worker

```python
# app/tasks/process_image.py
from app.tasks.celery_app import celery_app
from app.integrations.comfyui.client import ComfyUIClient

@celery_app.task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    autoretry_for=(Exception,),
)
def process_product_images(self, import_task_id: str):
    """处理一个导入任务的所有图片"""
    task = ImportTask.get(import_task_id)
    images = task.raw_data["images"]

    comfyui = ComfyUIClient(settings.COMFYUI_URL, settings.COMFYUI_WS_URL)

    results = []
    for i, image_url in enumerate(images):
        # Step 1: 下载到 ComfyUI 可访问的路径
        local_path = download_to_local(image_url)

        # Step 2: 去水印
        cleaned = comfyui.process_image(
            "remove_watermark",
            {"INPUT_IMAGE_PATH": local_path}
        )

        # Step 3: 去背景 + 白底
        final = comfyui.process_image(
            "white_background",
            {"INPUT_IMAGE_PATH": cleaned["output_path"]}
        )

        # Step 4: 上传到 OSS
        cdn_url = upload_to_cdn(final["output_path"])
        results.append({"original": image_url, "processed": cdn_url, "position": i+1})

        # 更新进度
        task.progress = (i + 1) / len(images) * 100
        task.save()

    task.processed_images = results
    task.status = "IMAGES_PROCESSED"
    task.save()
```

### 4.7 定价规则引擎

#### 4.7.1 引擎架构

```python
# app/services/pricing_service.py
from dataclasses import dataclass
from typing import Optional
import re

@dataclass
class PricingRule:
    name: str
    priority: int
    conditions: list[dict]      # [{field, operator, value}]
    formula: dict               # {exchange_rate, markup_tiers, round_to, ...}

class PricingEngine:
    def __init__(self, rules: list[PricingRule]):
        self.rules = sorted(rules, key=lambda r: r.priority)

    def calculate(self, source_price_cny: float, context: dict) -> dict:
        """计算 SKU 售价"""
        # 1. 匹配规则
        rule = self._match_rule(source_price_cny, context)
        if not rule:
            raise NoMatchingRuleError()

        # 2. 获取汇率
        rate = self._get_exchange_rate(rule)

        # 3. 计算倍率（阶梯定价）
        multiplier = self._get_multiplier(source_price_cny, rule)

        # 4. 基础售价
        base_price = (source_price_cny / rate) * multiplier

        # 5. 尾数处理
        sale_price = self._round_price(base_price, rule.formula.get("round_to", ".99"))

        # 6. 划线价
        compare_at = sale_price * (1 + rule.formula.get("compare_at_markup", 0))

        return {
            "sale_price": sale_price,
            "compare_at_price": compare_at,
            "cost": source_price_cny / rate,
            "margin": sale_price - (source_price_cny / rate),
            "applied_rule": rule.name,
        }

    def _match_rule(self, price: float, context: dict) -> Optional[PricingRule]:
        for rule in self.rules:
            if all(self._check_condition(c, price, context) for c in rule.conditions):
                return rule
        return None

    def _get_multiplier(self, price: float, rule: PricingRule) -> float:
        tiers = rule.formula.get("markup_tiers", [])
        for tier in tiers:
            low, high = tier["range"]
            if low <= price <= high:
                return tier["multiplier"]
        return rule.formula.get("default_multiplier", 3.0)

    def _round_price(self, price: float, round_to: str) -> float:
        """尾数处理: '.99' → floor(x) + 0.99, '.95' → floor(x) + 0.95"""
        if round_to == ".99":
            return float(int(price)) + 0.99
        elif round_to == ".95":
            return float(int(price)) + 0.95
        elif round_to == ".00":
            return round(price)
        else:
            return round(price, 2)
```

#### 4.7.2 汇率获取

```python
# 每小时更新一次，缓存到 Redis
@celery_app.task
def update_exchange_rates():
    """从 exchangerate-api.com 拉取最新汇率"""
    resp = requests.get(f"https://v6.exchangerate-api.com/v6/{API_KEY}/latest/CNY")
    rates = resp.json()["conversion_rates"]
    redis.set("exchange_rate:USD", rates["USD"])
    redis.set("exchange_rate:EUR", rates["EUR"])
    redis.set("exchange_rate:GBP", rates["GBP"])
    redis.set("exchange_rate:updated_at", time.time())
```

### 4.8 Shopify 同步模块

#### 4.8.1 Shopify API 封装

```python
# app/integrations/shopify/client.py
import shopify
from typing import Optional

class ShopifyClient:
    def __init__(self, shop_domain: str, access_token: str):
        self.shop_domain = shop_domain
        session = shopify.Session(f"{shop_domain}.myshopify.com", "2024-01", access_token)
        shopify.ShopifyResource.activate_session(session)

    def create_product(self, data: dict) -> dict:
        """创建商品（草稿状态）"""
        product = shopify.Product.create({
            "title": data["title"],
            "body_html": data["body_html"],
            "vendor": data.get("vendor", "DropShipFlow"),
            "product_type": data.get("product_type"),
            "status": "draft",
            "options": data["options"],  # [{"name": "Color"}, {"name": "Size"}]
            "tags": data.get("tags", ""),
        })
        return product.to_dict()

    def create_variant(self, product_id: int, data: dict) -> dict:
        """为指定商品创建 Variant"""
        variant = shopify.Variant.create({
            "product_id": product_id,
            "option1": data.get("option1"),
            "option2": data.get("option2"),
            "option3": data.get("option3"),
            "price": str(data["price"]),
            "compare_at_price": str(data.get("compare_at_price", "")),
            "sku": data.get("sku"),
            "inventory_quantity": data.get("inventory_quantity", 100),
            "requires_shipping": True,
        })
        return variant.to_dict()

    def create_image(self, product_id: int, image_url: str, variant_ids: list[int] = None, position: int = 1) -> dict:
        """上传图片并关联 Variant"""
        image = shopify.Image.create({
            "product_id": product_id,
            "src": image_url,
            "variant_ids": variant_ids or [],
            "position": position,
        })
        return image.to_dict()
```

#### 4.8.2 同步顺序（关键约束）

```
必须严格按此顺序，因为 Shopify 的约束：
1. Product 必须先于 Variant 创建
2. Variant 必须先于 Image 创建（如果 Image 要关联 Variant）
3. Option values 必须在创建 Variant 时确定

同步顺序：
  Product.create(status=draft)
  → for each SKU group:
      Variant.create(option1, option2, price, sku, stock)
  → for each processed image:
      Image.create(src, variant_ids, position)
  → 更新 import_task.status = COMPLETED
```

#### 4.8.3 错误处理与重试

```python
def sync_with_retry(import_task_id: str):
    """带智能重试的同步逻辑"""
    retry_config = {
        "max_retries": 5,
        "base_delay": 2,
        "backoff_factor": 2,
        "retryable_codes": [429, 500, 502, 503, 504],
    }

    for attempt in range(retry_config["max_retries"]):
        try:
            result = do_sync(import_task_id)
            return result
        except ShopifyRateLimitError:
            # 读取 Retry-After header
            delay = get_retry_after() or retry_config["base_delay"] * (retry_config["backoff_factor"] ** attempt)
            time.sleep(delay)
        except ShopifyAPIError as e:
            if e.status_code in retry_config["retryable_codes"]:
                delay = retry_config["base_delay"] * (retry_config["backoff_factor"] ** attempt)
                time.sleep(delay)
            else:
                raise  # 不可重试的错误（如 401, 403, 404）
```

### 4.9 任务队列与编排

#### 4.9.1 Celery 任务链

```python
# 导入任务的完整编排
from celery import chain, group, chord

@celery_app.task
def process_import(import_task_id: str):
    """编排整个导入流程"""
    
    workflow = chain(
        # Step 1: 下载素材
        download_assets.s(import_task_id),
        
        # Step 2: 并行执行翻译和图片处理
        group(
            translate_product.s(import_task_id),
            process_images.s(import_task_id),
        ),
        
        # Step 3: 定价计算（依赖翻译结果获取 SKU 数据）
        calculate_pricing.s(import_task_id),
        
        # Step 4: 同步到 Shopify
        sync_to_shopify.s(import_task_id),
        
        # Step 5: 完成回调
        on_import_complete.s(import_task_id),
    )
    
    workflow.apply_async(
        link_error=on_import_failed.s(import_task_id)
    )
```

#### 4.9.2 队列设计

```
Queue 优先级设计:
  high_priority:     付费用户 (Business 套餐) 任务
  default:           普通用户 (Pro 套餐) 任务
  low_priority:      免费用户任务
  image_processing:  图片处理专用（需要与 GPU Worker 配合）
  maintenance:       定时任务（汇率更新、清理）

Worker 分配:
  worker-translate:  4 个并发 (CPU 轻量，IO 密集)
  worker-image:      2 个并发 (每个需要等待 GPU，限制并发防止 GPU OOM)
  worker-sync:       4 个并发 (IO 密集，Shopify API 调用)
  worker-default:    8 个并发 (通用)
```

### 4.10 素材存储与 CDN

#### 4.10.1 存储结构

```
Bucket: dropshipflow-assets
├── raw/{user_id}/{import_task_id}/
│   ├── 2024-06-09_main_01.jpg      # 1688 原始图片
│   ├── 2024-06-09_detail_01.jpg
│   └── ...
├── processed/{user_id}/{import_task_id}/
│   ├── cleaned_main_01.jpg         # 去水印后
│   ├── white_bg_main_01.jpg        # 白底图
│   ├── marketing_main_01.jpg       # 营销主图
│   └── ...
└── public/{user_id}/
    └── products/{shopify_product_id}/
        └── ...                      # 最终 CDN 路径
```

#### 4.10.2 CDN 策略

- **Provider:** Cloudflare R2 (S3 API) + Cloudflare CDN
- **自定义域名:** `cdn.dropshipflow.com`
- **缓存策略:**
  - 图片: `Cache-Control: public, max-age=31536000, immutable`
  - 签名 URL (私有图片): 过期时间 24 小时
- **图片处理 (Cloudflare Image Resizing):**
  - URL 参数: `?width=800&format=webp` 实现动态缩略图

---

## 5. 数据库设计

### 5.1 ER 图（简化）

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────────┐
│   User   │──N:1│   Team   │──1:N│   Shop   │──1:N│ ImportTask   │
└──────────┘     └──────────┘     └──────────┘     └──────┬───────┘
     │               │                                    │
     │ role:         │ plan:                              │ 1:1
     │ super_admin   │ free|pro|business|enterprise       ▼
     │ manager       │                           ┌──────────────┐
     │ member        │ 1:N                        │   Product    │
                     └────────▶┌──────────┐      └──────────────┘
                               │PricingRule│
                               └──────────┘

关系说明:
  · User.team_id → Team.id  (super_admin 的 team_id 为 NULL)
  · Shop.team_id → Team.id  (不再直接关联 User)
  · ImportTask / Product / PricingRule 均通过 team_id 隔离
```

### 5.2 表结构

```sql
-- 团队表
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    plan VARCHAR(20) NOT NULL DEFAULT 'free',  -- free, pro, business, enterprise
    created_by UUID NOT NULL REFERENCES users(id),
    max_members INTEGER DEFAULT 1,
    max_shops INTEGER DEFAULT 1,
    quota_monthly INTEGER DEFAULT 10,
    quota_remaining INTEGER DEFAULT 10,
    quota_reset_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 用户表 (重新设计)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100),
    role VARCHAR(20) NOT NULL DEFAULT 'member',
        -- 'super_admin': 全局角色，team_id = NULL
        -- 'manager':     团队管理者，team_id = 所属团队
        -- 'member':      普通成员，team_id = 所属团队
    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
        -- super_admin 为 NULL，其余角色必填
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 首个注册用户触发器：自动设为 super_admin
CREATE OR REPLACE FUNCTION set_first_user_super_admin()
RETURNS TRIGGER AS $$
BEGIN
    IF (SELECT COUNT(*) FROM users) = 0 THEN
        NEW.role := 'super_admin';
        NEW.team_id := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_first_user_super_admin
    BEFORE INSERT ON users
    FOR EACH ROW
    EXECUTE FUNCTION set_first_user_super_admin();

-- Shopify 店铺 (重新设计 — 关联团队而非用户)
CREATE TABLE shops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id),
    shop_domain VARCHAR(255) NOT NULL,          -- mystore.myshopify.com
    shop_name VARCHAR(255),
    access_token_encrypted BYTEA NOT NULL,      -- AES-256-GCM 加密
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(team_id, shop_domain)
);

-- 定价规则 (关联团队)
CREATE TABLE pricing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id),
    name VARCHAR(100) NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    conditions JSONB NOT NULL DEFAULT '[]',
    formula JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 导入任务 (关联团队)
CREATE TABLE import_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    shop_id UUID NOT NULL REFERENCES shops(id),
    source_url VARCHAR(500) NOT NULL,
    offer_id VARCHAR(50),
    status VARCHAR(30) DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    raw_data JSONB,
    translated_data JSONB,
    processed_images JSONB,
    pricing_result JSONB,
    shopify_product_id BIGINT,
    shopify_product_url VARCHAR(500),
    error_message TEXT,
    celery_task_id VARCHAR(255),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shopify 商品记录
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_task_id UUID NOT NULL REFERENCES import_tasks(id),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    shop_id UUID NOT NULL REFERENCES shops(id),
    shopify_product_id BIGINT NOT NULL,
    shopify_handle VARCHAR(255),
    title_cn VARCHAR(500),
    title_en VARCHAR(500),
    status VARCHAR(30) DEFAULT 'draft',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 邀请链接表 (用于管理者邀请成员)
CREATE TABLE invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    created_by UUID NOT NULL REFERENCES users(id),
    email VARCHAR(255),
    token VARCHAR(64) UNIQUE NOT NULL,
    role VARCHAR(20) DEFAULT 'member',
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_users_team ON users(team_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_shops_team ON shops(team_id);
CREATE INDEX idx_import_tasks_team_status ON import_tasks(team_id, status);
CREATE INDEX idx_import_tasks_offer_id ON import_tasks(offer_id);
CREATE INDEX idx_pricing_rules_team ON pricing_rules(team_id, priority);
CREATE INDEX idx_products_team ON products(team_id);
CREATE INDEX idx_products_shopify ON products(shopify_product_id);
CREATE INDEX idx_invitations_token ON invitations(token);
CREATE INDEX idx_invitations_team ON invitations(team_id);

-- 审计日志表 (只允许 INSERT，禁止 UPDATE/DELETE)
CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES users(id),
    action VARCHAR(50) NOT NULL,
        -- 格式: "entity.action"，如 "product.publish", "login"
    entity_type VARCHAR(30) NOT NULL,
        -- user, team, shop, product, pricing_rule, import_task, auth
    entity_id VARCHAR(100),
    entity_label VARCHAR(500),
        -- 人类可读的对象描述，如商品标题、店铺域名
    old_values JSONB,
        -- 变更前的值 (update/delete 时填充)
    new_values JSONB,
        -- 变更后的值 (create/update 时填充)
    ip_address INET,
    user_agent TEXT,
    metadata JSONB DEFAULT '{}',
        -- 额外上下文: 如 login_failed 的原因
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 审计日志索引
CREATE INDEX idx_audit_logs_team ON audit_logs(team_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

-- 撤销日志表的写权限（除 INSERT 外）
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM PUBLIC;

-- 订阅套餐表 (超管可配置)
CREATE TABLE subscription_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL,
    slug VARCHAR(30) UNIQUE NOT NULL,
    monthly_price DECIMAL(10,2) NOT NULL DEFAULT 0,
    yearly_price DECIMAL(10,2) NOT NULL DEFAULT 0,
    quota_rule_id UUID NOT NULL REFERENCES quota_rules(id),
    features JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 配额规则表 (超管可配置)
CREATE TABLE quota_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    -- 数量配额
    max_team_members INTEGER NOT NULL DEFAULT 1,
    max_shops INTEGER NOT NULL DEFAULT 1,
    daily_import_limit INTEGER NOT NULL DEFAULT 0,     -- 0 = 无限
    monthly_import_limit INTEGER NOT NULL DEFAULT 0,    -- 0 = 无限
    max_images_per_product INTEGER NOT NULL DEFAULT 8,
    -- 功能开关
    watermark_removal BOOLEAN DEFAULT false,
    white_background BOOLEAN DEFAULT false,
    marketing_image BOOLEAN DEFAULT false,
    scene_generation BOOLEAN DEFAULT false,
    multi_language BOOLEAN DEFAULT false,
    custom_pricing BOOLEAN DEFAULT false,
    priority_queue BOOLEAN DEFAULT false,
    api_access BOOLEAN DEFAULT false,
    data_export BOOLEAN DEFAULT false,
    data_dashboard BOOLEAN DEFAULT false,
    -- 其他
    audit_log_retention_days INTEGER DEFAULT 30,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 团队表更新：plan 字段改为引用 subscription_plans
ALTER TABLE teams ADD COLUMN plan_id UUID REFERENCES subscription_plans(id);
-- 迁移后删除旧的 plan VARCHAR 列
-- ALTER TABLE teams DROP COLUMN plan;

CREATE INDEX idx_subscription_plans_slug ON subscription_plans(slug);
CREATE INDEX idx_quota_rules_id ON quota_rules(id);

-- AI 提供商配置表 (超管可配置)
CREATE TABLE ai_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL,
    slug VARCHAR(30) UNIQUE NOT NULL,
    provider_type VARCHAR(30) NOT NULL,       -- deepseek / openai / anthropic / google
    category VARCHAR(20) NOT NULL DEFAULT 'text', -- "text" (文字AI) | "vision" (视觉AI)
    api_base_url VARCHAR(255) NOT NULL,
    api_key_encrypted BYTEA NOT NULL,         -- AES-256-GCM 加密
    default_model VARCHAR(100) NOT NULL,
    available_models JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT true,
    is_default BOOLEAN DEFAULT false,         -- 同 category 内只有一个可为 true
    priority INTEGER DEFAULT 0,               -- 同 category 内比较
    max_retries INTEGER DEFAULT 3,
    timeout_seconds INTEGER DEFAULT 30,
    pricing JSONB DEFAULT '{}',               -- {input_per_1k, output_per_1k}
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_ai_providers_default ON ai_providers(category, is_default) WHERE is_default = true;
```

### 5.3 数据迁移策略

- 使用 **Alembic** 进行数据库迁移
- 版本化迁移文件，支持 `upgrade` / `downgrade`
- CI/CD 中自动运行迁移
- 生产环境迁移前备份

---

## 6. API 接口设计

### 6.1 REST API 概览

```
认证
  POST   /api/v1/auth/register          — 注册
  POST   /api/v1/auth/login             — 登录
  POST   /api/v1/auth/refresh           — 刷新 Token

商品导入
  POST   /api/v1/imports                — 创建导入任务
  GET    /api/v1/imports                — 导入任务列表
  GET    /api/v1/imports/{id}           — 任务详情（含进度）
  DELETE /api/v1/imports/{id}           — 取消任务

店铺管理
  POST   /api/v1/shops                  — 绑定 Shopify 店铺
  GET    /api/v1/shops                  — 店铺列表
  DELETE /api/v1/shops/{id}             — 解绑店铺

定价规则
  POST   /api/v1/pricing-rules          — 创建定价规则
  GET    /api/v1/pricing-rules          — 规则列表
  PUT    /api/v1/pricing-rules/{id}     — 更新规则
  DELETE /api/v1/pricing-rules/{id}     — 删除规则

商品管理
  GET    /api/v1/products               — 已同步商品列表
  GET    /api/v1/products/{id}          — 商品详情
  PUT    /api/v1/products/{id}          — 更新商品（修改翻译/价格）
  POST   /api/v1/products/{id}/publish  — 发布到 Shopify

远程配置
  GET    /api/v1/config/scraper         — 获取最新 DOM 选择器配置

Webhook
  POST   /api/v1/webhooks/shopify       — 接收 Shopify 事件
```

### 6.2 核心 API 示例

#### 6.2.1 创建导入任务

```
POST /api/v1/imports
Authorization: Bearer <access_token>

Request:
{
  "source_url": "https://detail.1688.com/offer/123456789.html",
  "shop_id": "uuid-of-shop",
  "options": {
    "remove_watermark": true,
    "generate_white_bg": true,
    "generate_marketing_image": false,
    "translate_language": "en",
    "pricing_rule_id": "uuid-of-rule"  // 可选，不传则使用默认规则
  },
  "raw_data": {                         // 由插件抓取的数据
    "title": "夏季新款纯棉T恤...",
    "description": "<p>100%纯棉...</p>",
    "images": ["https://img.1688.com/..."],
    "skus": [
      {"spec": "红色;XL", "price": 25.00, "stock": 200, "image": null}
    ],
    "offer_id": "123456789"
  }
}

Response 201:
{
  "id": "uuid",
  "status": "pending",
  "progress": 0,
  "created_at": "2026-06-09T10:00:00Z"
}
```

#### 6.2.2 查询任务进度

```
GET /api/v1/imports/{id}
Authorization: Bearer <access_token>

Response 200:
{
  "id": "uuid",
  "status": "processing_images",
  "progress": 45,
  "steps": {
    "download": "completed",
    "translate": "completed",
    "images": {"done": 3, "total": 8},
    "pricing": "pending",
    "sync": "pending"
  },
  "result": null,  // 完成后填充 shopify_product_url
  "error": null
}
```

#### 6.2.3 配置下发

```
GET /api/v1/config/scraper
Authorization: Bearer <access_token>

Response 200:
{
  "version": "2026-06-09.1",
  "platform": "1688",
  "selectors": {
    "title": {"primary": "h1.offer-title", "type": "text", "fallback": ".title-text"},
    "price": {"primary": ".price-range", "type": "text"},
    "images": {"primary": ".main-image img", "type": "list", "attribute": "src"},
    "skus": {
      "container": {"primary": ".sku-item", "type": "list"},
      "spec": {"primary": ".spec-name", "type": "text"},
      "price": {"primary": ".spec-price", "type": "text"},
      "stock": {"primary": ".spec-stock", "type": "text"}
    }
  }
}
```

### 6.3 API 限流

| 用户类型 | 限制 | 窗口 |
|---------|------|------|
| Free | 30 requests | 1 分钟 |
| Pro | 120 requests | 1 分钟 |
| Business | 600 requests | 1 分钟 |
| 全局 (所有用户) | 3000 requests | 1 分钟 |

---

## 7. 数据流与交互时序

### 7.1 完整导入时序图

```
User        Extension     FastAPI      Celery      ComfyUI    LLM API   Shopify API
 │              │            │            │           │          │           │
 │  visit 1688  │            │            │           │          │           │
 │─────────────▶│            │            │           │          │           │
 │              │ scrape DOM │            │           │          │           │
 │              │─────────── │            │           │          │           │
 │              │            │            │           │          │           │
 │ click import │            │            │           │          │           │
 │─────────────▶│            │            │           │          │           │
 │              │ POST /imports           │           │          │           │
 │              │───────────▶│            │           │          │           │
 │              │            │ enqueue    │           │          │           │
 │              │            │───────────▶│           │          │           │
 │              │  201       │            │           │          │           │
 │              │◀───────────│            │           │          │           │
 │    done!     │            │            │           │          │           │
 │◀─────────────│            │            │           │          │           │
 │              │            │            │           │          │           │
 │              │            │            │ download  │          │           │
 │              │            │            │─── images │          │           │
 │              │            │            │           │          │           │
 │              │            │            │ translate │          │           │
 │              │            │            │────────────────────▶│           │
 │              │            │            │◀────────────────────│           │
 │              │            │            │           │          │           │
 │              │            │            │ process   │          │           │
 │              │            │            │──────────▶│          │           │
 │              │            │            │  (WS wait)│          │           │
 │              │            │            │◀──────────│          │           │
 │              │            │            │           │          │           │
 │              │            │            │ pricing   │          │           │
 │              │            │            │           │          │           │
 │              │            │            │ sync to Shopify       │           │
 │              │            │            │─────────────────────────────────▶│
 │              │            │            │◀─────────────────────────────────│
 │              │            │            │           │          │           │
 │  (poll GET /imports/{id}) │            │           │          │           │
 │              │───────────▶│            │           │          │           │
 │              │◀───────────│            │           │          │           │
 │  status: completed        │            │           │          │           │
 │              │            │            │           │          │           │
 │  open Shopify → see draft │            │           │          │           │
```

### 7.2 实时进度推送 (WebSocket)

```
Extension ──WS──▶ FastAPI ──subscribe──▶ Redis Pub/Sub

每个 import_task 一个 channel:
  channel: "import:{task_id}"

消息格式:
  {
    "task_id": "uuid",
    "status": "processing_images",
    "progress": 45,
    "step_detail": "Processing image 4/8",
    "timestamp": "2026-06-09T10:02:30Z"
  }
```

---

## 8. 安全设计

### 8.1 安全架构

```
┌─────────────────────────────────────────────────────┐
│                    安全层                             │
│                                                       │
│  传输层:  HTTPS/TLS 1.3 (全链路加密)                  │
│  认证层:  JWT + Refresh Token + 多设备管理            │
│  授权层:  RBAC (free/pro/business) + 资源归属校验     │
│  数据层:  AES-256-GCM (敏感字段加密)                  │
│  应用层:  Input Validation + Rate Limiting + CSP      │
│  运维层:  Secrets Manager + 审计日志                  │
│                                                       │
└─────────────────────────────────────────────────────┘
```

### 8.2 关键安全措施

| 层级 | 措施 | 实现 |
|------|------|------|
| Shopify Token | 数据库加密存储 | AES-256-GCM，密钥来自环境变量 |
| 用户密码 | 哈希 | bcrypt (cost=12) |
| API 认证 | JWT | RS256 签名，15 分钟过期 |
| 文件访问 | 签名 URL | 私有图片 24 小时过期 |
| 输入验证 | Pydantic | 所有 API 输入强类型校验 |
| SQL 注入 | ORM | SQLAlchemy 参数化查询 |
| XSS | CSP Header | `Content-Security-Policy` 限制 |
| CORS | 白名单 | 仅允许 extension:// 和 admin 域名 |
| 限流 | Token Bucket | Redis 实现的按用户/按 IP 限流 |
| 审计 | 操作日志 | 所有关键操作记录到 audit_log 表 |

### 8.3 密钥管理

```
环境变量 (绝不提交到代码仓库):
  DATABASE_URL
  REDIS_URL
  JWT_PRIVATE_KEY         (RS256)
  JWT_PUBLIC_KEY
  ENCRYPTION_KEY          (用于加密 Shopify Token)
  DEEPSEEK_API_KEY
  OPENAI_API_KEY
  SHOPIFY_CLIENT_ID
  SHOPIFY_CLIENT_SECRET
  CLOUDFLARE_R2_ACCESS_KEY
  CLOUDFLARE_R2_SECRET_KEY
  EXCHANGE_RATE_API_KEY
```

---

## 9. 部署架构

### 9.1 生产环境拓扑

```
                          Internet
                             │
                     ┌───────▼────────┐
                     │   Cloudflare   │ (DNS + CDN + DDoS)
                     └───────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        cdn.dropshipflow  admin.dropshipflow  api.dropshipflow
        .com               .com               .com
        (R2 + CDN)         (Next.js SSR)      (FastAPI)
              │              │              │
              └──────────────┼──────────────┘
                             │
                     ┌───────▼────────┐
                     │    Nginx       │ (反向代理 + SSL)
                     │    (VPS)       │
                     └───────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
       ┌──────▼──────┐ ┌────▼─────┐ ┌─────▼──────┐
       │  FastAPI    │ │  Celery  │ │  Celery    │
       │  (2x gunicorn)│ │  Worker  │ │  Beat      │
       └──────┬──────┘ └────┬─────┘ └─────┬──────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
       ┌──────▼──────┐ ┌────▼─────┐ ┌─────▼──────┐
       │ PostgreSQL  │ │  Redis   │ │  HD/GPU    │
       │   (Primary)  │ │          │ │  (ComfyUI) │
       └─────────────┘ └──────────┘ └────────────┘
```

### 9.2 Docker Compose (开发/小规模部署)

```yaml
# docker-compose.yml
version: '3.8'

services:
  api:
    build: ./backend
    ports:
      - "8000:8000"
    env_file: .env
    depends_on:
      - postgres
      - redis
    volumes:
      - ./backend:/app

  worker-translate:
    build: ./backend
    command: celery -A app.tasks.celery_app worker -Q default,high_priority -c 4
    env_file: .env
    depends_on:
      - postgres
      - redis

  worker-image:
    build: ./backend
    command: celery -A app.tasks.celery_app worker -Q image_processing -c 2
    env_file: .env
    depends_on:
      - postgres
      - redis

  worker-sync:
    build: ./backend
    command: celery -A app.tasks.celery_app worker -Q default -c 4
    env_file: .env
    depends_on:
      - postgres
      - redis

  celery-beat:
    build: ./backend
    command: celery -A app.tasks.celery_app beat
    env_file: .env
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: dropshipflow
      POSTGRES_USER: app
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  admin:
    build: ./frontend
    ports:
      - "3000:3000"
    env_file: .env

  # ComfyUI 部署在独立的 GPU 服务器上
  # 通过 COMFYUI_URL 环境变量连接

volumes:
  pgdata:
```

### 9.3 ComfyUI GPU 服务器

```yaml
# docker-compose.gpu.yml (独立 GPU 服务器)
services:
  comfyui:
    image: comfyui/comfyui:latest
    runtime: nvidia
    environment:
      NVIDIA_VISIBLE_DEVICES: all
    ports:
      - "8188:8188"
    volumes:
      - ./comfyui/models:/ComfyUI/models
      - ./comfyui/workflows:/ComfyUI/user/default/workflows
      - ./comfyui/output:/ComfyUI/output
      - ./comfyui/input:/ComfyUI/input
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

---

## 10. 监控与运维

### 10.1 监控指标

| 类别 | 指标 | 工具 |
|------|------|------|
| 应用 | API 请求量、响应时间、错误率 | Prometheus + Grafana |
| 任务 | Celery 队列长度、任务耗时分布、失败率 | Flower + Prometheus |
| 数据库 | 连接数、查询延迟、慢查询 | PostgreSQL Exporter |
| 外部依赖 | DeepSeek API 延迟、Shopify API 调用成功率、ComfyUI GPU 利用率 | Custom Exporter |
| 业务 | 每日导入数、成功率、端到端耗时 P50/P95 | Custom Metrics |

### 10.2 告警规则

| 告警 | 条件 | 通知渠道 |
|------|------|---------|
| API 5xx 率过高 | > 1% 持续 5 分钟 | PagerDuty / 钉钉 / 飞书 |
| Celery 队列积压 | > 100 个任务 | Slack / 企业微信 |
| ComfyUI 不可用 | 连续 3 次健康检查失败 | PagerDuty |
| 数据库连接池耗尽 | > 80% | 告警 |
| 磁盘使用率 | > 85% | 告警 + 自动清理 |

### 10.3 日志

```
格式: JSON (结构化日志)
字段: timestamp, level, service, trace_id, user_id, message, extra

示例:
{
  "timestamp": "2026-06-09T10:02:30.123Z",
  "level": "INFO",
  "service": "worker-image",
  "trace_id": "abc-123",
  "user_id": "user-uuid",
  "import_task_id": "task-uuid",
  "message": "Image processing completed",
  "extra": {
    "image_index": 4,
    "total_images": 8,
    "duration_ms": 15230
  }
}

收集: Filebeat → Elasticsearch / Loki
查看: Kibana / Grafana
```

---

## 11. 扩展性设计

### 11.1 水平扩展

| 组件 | 扩展方式 |
|------|---------|
| FastAPI | 无状态，直接加实例 + 负载均衡 |
| Celery Worker | 加 Worker 进程/机器，Redis 做 Broker |
| PostgreSQL | 读副本 + 连接池 (PgBouncer) |
| Redis | Sentinel / Cluster 模式 |
| ComfyUI | 多 GPU 节点 + 任务调度器分配 |

### 11.2 多平台扩展预留

```python
# 货源平台抽象
class SourcePlatform(ABC):
    @abstractmethod
    async def fetch_product(self, url: str) -> ProductData:
        pass

class Alibaba1688(SourcePlatform): ...
class Taobao(SourcePlatform): ...       # 预留
class Pinduoduo(SourcePlatform): ...    # 预留

# 电商平台抽象
class EcommercePlatform(ABC):
    @abstractmethod
    async def create_product(self, data: ProductData) -> str:
        pass

class Shopify(EcommercePlatform): ...
class WooCommerce(EcommercePlatform): ...  # 预留
class Amazon(EcommercePlatform): ...       # 预留
```

### 11.3 插件化定价规则

```python
# 定价规则支持自定义 Python 表达式
# 在规则的 formula 中允许使用 safe_eval：

rule = {
    "formula": {
        "expression": "((cost / rate) * (price * 0.8 if price > 100 else 3.5)).quantize(2)",
        "round_to": ".99"
    }
}
```

---

> **下一步：** 详见 [产品原型文档 (PROTOTYPE.md)](./PROTOTYPE.md)
>
> **架构图：** 查看 [architecture-diagram.html](./architecture-diagram.html)
