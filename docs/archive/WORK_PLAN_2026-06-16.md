# DropShipFlow — Bug 修复及功能优化工作计划

> 生成日期：2026-06-15
> 基于：对 `backend` / `admin` / `extension` 三模块的全量代码审计 + 现有 docs（DEV_PROGRESS / V2_PLAN / PRD / TECHNICAL_ARCHITECTURE）
> 性质：均衡侧重（Bug 修复 + 功能补全/优化），按优先级分批排期

---

## 0. 摘要与排期总览

本次审计共定位 **47 项**问题，其中需要优先处理的安全/数据一致性缺陷集中在三处链路：**配额校验失效**、**XSS + Token 存储**组合可被利用的账户接管链、**插件发布不可用**（写死 localhost + 两套实现并存）。

排期建议分四个批次（Sprint），每批次约 1 周，按"先止血、再稳态、后补功能、最后优化"推进：

| 批次 | 主题 | 核心目标 | 问题数 |
|:--:|------|---------|:--:|
| **S1** | 🔴 安全与数据正确性止血 | 修复可被利用的安全漏洞 + 配额/权限失效 | 9 |
| **S2** | 🟠 稳定性与一致性 | 后台任务、并发竞态、错误处理统一 | 13 |
| **S3** | 🟡 功能闭环补全 | 修图链路、Shopify 真实同步、插件收敛 | 11 |
| **S4** | 🟢 性能与体验优化 | 分页、抓取精度、UX、技术债清理 | 14 |

> 标注说明：严重度 **Critical / High / Medium / Low**；类型分 Bug / 安全 / 数据一致性 / 性能 / UX / 技术债 / 未完成功能。每项给出【现象】【影响】【方案】【涉及文件】。

---

## Sprint 1 — 安全与数据正确性止血（P0）

> 目标：消除可被实际利用的安全漏洞，恢复付费墙与权限隔离的有效性。**这批必须最先做，且建议上线前完成。**

### S1-1 ｜配额校验完全失效（用错主键）

- **严重度**：Critical ｜ **类型**：Bug / 数据一致性
- **现象**：`QuotaChecker._load` 用 `db.get(QuotaRule, team.plan_id)` 加载配额，但 `team.plan_id` 是 `subscription_plans.id`，与 `QuotaRule` 主键是两套 ID，永不匹配，`_quota` 恒为 `None`，于是月导入上限 / 店铺数 / 成员数全部 `return True`。
- **影响**：**所有套餐配额形同虚设，付费墙完全失效**。
- **方案**：改为 `plan = await db.get(SubscriptionPlan, team.plan_id); self._quota = plan.quota_rule if plan else None`。
- **文件**：`backend/app/core/permissions.py:80-84`

### S1-2 ｜月度配额查询用了 SQLite 不支持的 `date_trunc`

- **严重度**：Critical ｜ **类型**：Bug
- **现象**：`ImportTask.created_at >= func.date_trunc("month", func.now())` 是 PostgreSQL 专用函数，SQLite 下抛 `OperationalError`。目前被 S1-1 掩盖，修复 S1-1 后立刻暴雷。
- **影响**：配额一旦生效即 500。
- **方案**：Python 端算本月首日 `datetime(now.year, now.month, 1)` 作绑定参数比较。
- **文件**：`backend/app/core/permissions.py:93`

### S1-3 ｜`/media/{filename}` 路径遍历 + 任意文件读取（无鉴权）

- **严重度**：Critical ｜ **类型**：安全
- **现象**：`filename` 未清洗直接拼 `Path(LOCAL_STORAGE_DIR)/filename`，`../../etc/passwd` 可逃逸；兜底 `rglob` 还会全树查找；端点完全无鉴权。
- **影响**：任意人可读服务器任意文件。
- **方案**：校验 `filename` 仅含安全字符（禁 `/`、`..`），`resolve()` 后确认仍在存储目录内再返回。
- **文件**：`backend/app/api/v1/router.py:28-40`

### S1-4 ｜AI Provider `fetch-models` 缺权限校验 → SSRF + 平台密钥外泄

- **严重度**：Critical ｜ **类型**：安全
- **现象**：`fetch_models` 无 `require(MANAGE_SUBSCRIPTIONS)`，任意登录用户可调；向用户提供的任意 `api_base_url` 发服务端请求（SSRF，可探内网 169.254.169.254）；传已知 `provider_id` + 空 key 时会取出 DB 中**明文存储的 API Key** 拼到 Authorization 发往攻击者 URL。
- **影响**：内网探测 + 平台 AI 密钥被外泄。
- **方案**：加权限依赖；对 `api_base_url` 做出站白名单/禁内网；禁止"空 key 回填 DB key 再发往任意 URL"。
- **文件**：`backend/app/api/v1/admin.py:274-310`

### S1-5 ｜选品池入库 IDOR（team_id 取自请求体）

- **严重度**：Critical ｜ **类型**：安全 / 团队隔离
- **现象**：`capture_product` 直接信任 `req.team_id`，不校验等于 `current_user.team_id`。member 改 `team_id` 即可写入他人团队、借唯一约束探测/覆盖他人记录。`imports.py` 已用 `get_current_team_or_raise` 做了校验，本处遗漏。
- **影响**：跨团队数据写入/覆盖。
- **方案**：忽略 `req.team_id`，统一用 `current_user.team_id`（仅 super_admin 可显式指定）。
- **文件**：`backend/app/api/v1/product_pool.py:70-131`

### S1-6 ｜存储型 XSS + Token 存 localStorage（组合即账户接管）

- **严重度**：Critical ｜ **类型**：安全
- **现象**：① 选品池详情把 1688 抓取的 `desc_cn`、AI 翻译 `description` 未净化直接 `dangerouslySetInnerHTML`（`product-pool/page.tsx:337,401`）；商品编辑器富文本同路径回流。② `access_token`/`refresh_token` 存 `localStorage`（`lib/api.ts:10-13`），多页直接 `atob` 解析 JWT。
- **影响**：任意 `<img onerror>` 注入即可在管理员浏览器读取长期有效 refresh token → **账户完全失陷**。这是最该优先排期的可利用链路。
- **方案**：渲染前用 DOMPurify 白名单净化（或后端入库统一 sanitize）；Token 迁移到 HttpOnly + Secure + SameSite Cookie，前端不可读。
- **文件**：`admin/src/app/product-pool/page.tsx:337,401`、`admin/src/components/ProductEditor.tsx:23-45`、`admin/src/lib/api.ts:10-13,27-29`

### S1-7 ｜JWT 黑名单 / 强制登出形同虚设

- **严重度**：High ｜ **类型**：安全
- **现象**：`audit.py` 实现了 `force_logout_user` / `is_token_blacklisted`，但 `decode_token` / `get_current_user` **从不调用** 黑名单校验。"踢人下线"后用户凭 7 天有效期 token 继续访问。
- **影响**：会话无法真正吊销。
- **方案**：`get_current_user` 中校验 `payload["jti"]` 是否在黑名单；并缩短 access token 有效期。
- **文件**：`backend/app/core/security.py:46`、`backend/app/dependencies.py:17-27`、`backend/app/core/audit.py:68-87`

### S1-8 ｜越权提权：manager 可任意设置 role，且 role 值无白名单

- **严重度**：High ｜ **类型**：安全 / 权限
- **现象**：`add_member` / `update_member` 接受任意 `role` 字符串写入，无白名单。manager 可批量造 manager，或写入无效 role 致该用户命中空权限集被"软锁"。
- **影响**：权限越权 / 账号被锁。
- **方案**：校验 `role in {"member","manager"}`，非 super_admin 不得授予高于自身的角色。
- **文件**：`backend/app/api/v1/admin.py:363-390,424-469`

### S1-9 ｜凭据明文存储 + 默认弱 SECRET_KEY + DEBUG=True

- **严重度**：High ｜ **类型**：安全
- **现象**：① Shopify token、AI API Key 存进 `*_encrypted` 列却**从未加密**（`shops.py:45`、`admin.py:231,250,283`、`provider_router.py:37` 直接 `Bearer {api_key_encrypted}`）。② `SECRET_KEY` 默认 `dev-secret-change-in-production`，上线未覆盖则可伪造任意 JWT。③ `DEBUG=True` 默认开，SQL 全打日志；CORS `chrome-extension://*` 通配实际不生效（功能 bug）。
- **影响**：库泄露即所有店铺/AI 凭据暴露；JWT 可伪造。
- **方案**：引入 Fernet 对称加密（密钥来自环境变量）写时加密读时解密；`SECRET_KEY` 强制从环境注入（缺失则启动失败）；生产 `DEBUG=False`；CORS 改 `allow_origin_regex` 正确匹配。
- **文件**：`backend/app/api/v1/shops.py:45`、`backend/app/api/v1/admin.py`、`backend/app/config.py:11-20`、`backend/app/main.py:13-19`

---

## Sprint 2 — 稳定性与一致性（P1）

> 目标：消除后台任务丢失/竞态、统一错误处理、补齐隔离校验，让现有功能稳固可用。

### S2-1 ｜后台任务用"线程 + asyncio.run"，竞态/丢任务/连接耗尽

- **严重度**：High ｜ **类型**：性能 / 数据一致性 / 技术债
- **现象**：翻译/定价/转入大量用 `threading.Thread(target=lambda: asyncio.run(...))`。每次新建事件循环 + 新连接，批量时瞬起 N 线程 N 连接，SQLite 写锁下易 `database is locked`；进程重启丢失内存任务（仅 transfer_jobs 能恢复，翻译/定价无持久队列直接丢）；daemon 线程异常被裸 `except` 吞掉。
- **影响**：批量操作偶发失败且无感知、重启丢任务。
- **方案**：统一走 Celery（已有依赖）或一个持久化单 worker + asyncio 队列；翻译/定价也落 `TaskLog`/job 表以便恢复。
- **文件**：`backend/app/api/v1/product_pool.py:301-622`、`backend/app/api/v1/products.py:551-614`、`backend/app/api/v1/imports.py:144-149`

### S2-2 ｜offerId 去重并发竞态（check-then-insert）

- **严重度**：High ｜ **类型**：数据一致性 / 并发
- **现象**：先 select 再 insert/update，两并发请求可同时判"不存在"双双 insert，命中唯一约束抛 `IntegrityError` 且未回滚 → 500。插件常并发抓取易触发。
- **方案**：用 SQLite upsert（`INSERT ... ON CONFLICT DO UPDATE`），或捕获 `IntegrityError` 回滚后转更新分支。
- **文件**：`backend/app/api/v1/product_pool.py:79-131`

### S2-3 ｜转入 worker 单例锁多进程不安全 + 事务边界混乱

- **严重度**：High ｜ **类型**：并发 / 数据一致性
- **现象**：`_worker_running` 仅进程内布尔锁，多进程部署时各进程抢同一批 pending job、非原子认领 → 重复建 Product；`_drain` 一个 session 内既读 pool 又调 LLM 又写 Product，失败时部分修改可能已 flush。
- **方案**：DB 级原子认领（`UPDATE ... WHERE status='pending' ... RETURNING`）或迁 Postgres 用 `FOR UPDATE SKIP LOCKED`；明确单 job 事务边界。
- **文件**：`backend/app/api/v1/products.py:551-614`

### S2-4 ｜图片下载/转入链路裸 except 静默失败，坏数据当成功

- **严重度**：High ｜ **类型**：Bug / 数据一致性
- **现象**：`_download_single` 失败时把**原始 1688 防盗链 URL** 当 `public_url` 返回，下游 Shopify 拉不到图；ComfyUI 处理是 placeholder 却返回"成功"；`main.py` 启动 `resume_pending_jobs` 外层 `except: pass` 无日志。
- **方案**：失败时 `public_url` 置 `None` 并显式标错；裸 except 至少记日志。
- **文件**：`backend/app/services/image_service.py:86-88`、`backend/app/services/pipeline_service.py:142-152`、`backend/app/main.py:34-35`

### S2-5 ｜任务状态轮询端点缺团队隔离（信息泄露）

- **严重度**：Medium ｜ **类型**：安全 / 团队隔离
- **现象**：`GET /imports/{task_id}/status` 不校验 `team_id`，枚举 task_id 即可获知他团队任务状态/进度/错误。同文件 `get_import` 有校验，本处遗漏。
- **方案**：补与 `get_import` 一致的团队归属校验。
- **文件**：`backend/app/api/v1/imports.py:160-175`

### S2-6 ｜invitation 过期时间从不校验

- **严重度**：Medium ｜ **类型**：Bug / 安全
- **现象**：注册只查 `accepted_at`，从不比较 `expires_at`，过期邀请链接永久可用。
- **方案**：增加 `if invitation.expires_at < utcnow(): raise`。
- **文件**：`backend/app/services/auth_service.py:27-35`

### S2-7 ｜前端列表请求异步竞态（后发先至覆盖新数据）

- **严重度**：High ｜ **类型**：Bug
- **现象**：`load` 无请求取消/序号校验，快速改筛选/翻页时慢请求晚返回覆盖新结果；`product-pool` 翻页用 `setPage(p=>p+1); setTimeout(load,50)` 靠 50ms 赌 state 已更新，脆弱竞态。
- **方案**：用 `AbortController` 或请求序号丢弃过期响应；翻页改 `useEffect` 监听 `page`，去掉 setTimeout。
- **文件**：`admin/src/app/products/page.tsx:27-39`、`admin/src/app/product-pool/page.tsx:74-90,295-300`

### S2-8 ｜401 自动刷新存在缺口，首个 401 可能误登出

- **严重度**：High ｜ **类型**：Bug
- **现象**：401 重试判断 `if (status===401 && refreshToken)`，但模块级 `refreshToken` 仅在 `getToken()` 内回填，某些时序下首个 401 时为 null，不触发刷新直接抛错，用户被异常登出。
- **方案**：刷新前显式 `getToken()` 确保 refreshToken 已加载；集中初始化 token 状态。
- **文件**：`admin/src/lib/api.ts:71,25-32`

### S2-9 ｜`login/page.tsx` 用 useSearchParams 未包 Suspense

- **严重度**：High ｜ **类型**：Bug / 技术债
- **现象**：Next 14 App Router 中 `useSearchParams()` 须置于 `<Suspense>` 内，否则 `next build` 报错或整页退化 CSR；该页又无 `dynamic`。
- **方案**：把用 useSearchParams 的部分拆子组件并 `<Suspense>` 包裹。
- **文件**：`admin/src/app/login/page.tsx:3,14`

### S2-10 ｜错误大面积静默吞掉（空 catch），用户无反馈

- **严重度**：Medium ｜ **类型**：UX / 技术债
- **现象**：几乎所有数据加载失败 `.catch(()=>{})`，用户无法区分"真为空"与"接口报错/未授权"；错误处理风格全项目不统一（alert / setErr / 全吞混用）。
- **方案**：统一封装错误提示（toast/错误条），加载失败展示可重试错误态。
- **文件**：`admin/src/app/product-pool/page.tsx:86,97,149` 等十余处

### S2-11 ｜异步操作按钮未禁用，可重复提交

- **严重度**：Medium ｜ **类型**：Bug / UX
- **现象**：翻译/定价/调价/重试/保存等内联 `onClick={async}` 无 loading/disabled，连点发多次请求。
- **方案**：统一加 loading state，请求期间 `disabled`。
- **文件**：`admin/src/app/product-pool/page.tsx:391,415,468,513-516,534-537`、`admin/src/app/spu-rules/page.tsx:33`

### S2-12 ｜插件并发抓取无 tab 级锁，多任务踩踏

- **严重度**：Medium ｜ **类型**：Bug
- **现象**：`runScrapeJob` 不 await，多任务并行；每个 `scrape()` 都 `autoScroll` 操纵所在 tab，同一 tab 并发 SCRAPE 会互相干扰抓到半截快照；`activeJobs` 仅计数无按 tabId 去重。
- **方案**：按 tabId 加抓取锁，禁止同一 tab 并发 SCRAPE，或串行排队。
- **文件**：`extension/popup.js:177`、`extension/content.js:216-224`

### S2-13 ｜插件 token 过期无刷新/重登引导

- **严重度**：Medium ｜ **类型**：Bug / 未完成功能
- **现象**：`apiCall` 遇 401 仅 throw 显示"加载失败"，不清 token 不引导重登；token 仅 popup 打开时校验一次；`refresh_token` 被存却从未使用。
- **方案**：401 时清本地 token 触发 `checkAuth()` 回登录态；实现 refresh 或到期提示。
- **文件**：`extension/popup.js:286-294,32-68`

---

## Sprint 3 — 功能闭环补全（P1/P2）

> 目标：打通 V2 规划中尚未完成的分段管道（修图、真实上架），并收敛插件为单一可发布实现。对应 DEV_PROGRESS 中"待完成"的步骤 5/6/7/10/12。

### S3-1 ｜修图链路（分段2）完整落地 — V2 待办#5/#10

- **严重度**：High ｜ **类型**：未完成功能
- **现象**：当前 `pipeline_service` 中 ComfyUI 处理是 placeholder（`processed_urls.append(img["public_url"])  # placeholder`），`comfyui/client.py` 的 `wait_for_completion` 只判断 history 存在即返回、不辨成功失败；前端 `ImageCompare` 组件**完全不存在**，选品池详情图片区只是 `processed_url || s3_url || url` 取其一展示。
- **影响**：PRD 核心卖点之一（去水印/白底主图）实为空壳。
- **方案**：① 后端落地真实 workflow 调用（下载→S3→ComfyUI→回写 processed_url），每张图独立状态 `url_only|downloaded|processing|done|failed`；② `wait_for_completion` 检查节点 status/错误；③ 新建前端 `ImageCompare.tsx`（原图 vs 处理后左右/滑动对比，逐张确认/重试/舍弃）。
- **文件**：`backend/app/services/image_service.py`、`backend/app/services/pipeline_service.py:146-152`、`backend/app/integrations/comfyui/client.py:20-45`、`admin/src/components/ImageCompare.tsx`（新建）

### S3-2 ｜真实 Shopify 同步补齐 — V2 待办#7

- **严重度**：High ｜ **类型**：未完成功能 / 数据一致性
- **现象**：更新分支只同步 title/body_html/vendor/status/product_type/tags，**变体价格/库存/图片改动不推送**；无凭证时 `_fake_id()` 造假 shopify_id 标记成功，前端误以为已上架；变体不回填 `shopify_variant_id` 致后续无法精准更新。
- **方案**：补齐变体/图片增量同步与 id 回填；mock 路径在 UI 明确区分"未真正上架"。
- **文件**：`backend/app/services/shopify_product_service.py:83-119`、`backend/app/integrations/shopify/client.py`

### S3-3 ｜ImportTask 简化 + 关联 product_pool_id — V2 待办#6/#12

- **严重度**：Medium ｜ **类型**：未完成功能 / 技术债
- **现象**：V2 规划 ImportTask 职责缩小为只管 Shopify 同步、新增 `product_pool_id`，前端导入任务页"从选品池创建"流程尚未对齐。
- **方案**：按 V2_PLAN §2.3 收敛 ImportTask 字段，前端 imports 页接入"从选品池创建上架"。
- **文件**：`backend/app/models/__init__.py`、`backend/app/api/v1/imports.py`、`admin/src/app/imports/page.tsx`

### S3-4 ｜插件收敛为单一可发布实现 — 阻塞所有抓取优化

- **严重度**：Critical ｜ **类型**：技术债 / 未完成功能
- **现象**：① 同时存在两套实现：manifest 指向的根目录手写版 vs `src/` 下 Plasmo+React 版（`popup.tsx` 还是脚手架样板），`package.json` 的 `plasmo build` 却编译死代码的 `src/`。② API/ADMIN 写死 `localhost:8000/3000`，host_permissions 只列 localhost，真实用户安装后全部连不上。③ `login-bridge.js` 从未在 manifest 注册（死代码），token key 约定不一致（`window.__DROPSHIPFLOW_TOKEN__` vs `localStorage["token"]`）。
- **影响**：当前插件**根本无法发布给真实用户**，且一切抓取优化无从验证。
- **方案**：保留手写版、删除 `src/` 与 `popup.tsx`、修正 `package.json` 构建脚本与 README；抽出 dev/prod base URL 环境配置接通生产域名并在 host_permissions 声明；删除或正确注册 login-bridge 并统一 token key。
- **文件**：`extension/manifest.json`、`extension/src/`（删）、`extension/popup.tsx`（删）、`extension/login-bridge.js`、`extension/package.json`、`extension/popup.js:2-3`、`extension/background.js:2`

### S3-5 ｜抓取核心重构：解析页面内嵌 offer JSON 还原精确 SKU

- **严重度**：High ｜ **类型**：抓取准确性
- **现象**：无老式 SKU 表时只取 `groups[0]`（丢弃尺码维度），不做颜色×尺码笛卡尔积，每个 SKU 价格统一用区间最低价；价格取页面第一个 price 类元素（易抓到划线价/运费），库存抓不到静默回落 100。
- **影响**：SKU 数量/库存/价格/图片系统性错误，污染下游定价与上架。
- **方案**：解析 1688 页面内嵌 offer/SKU JSON（`window.__INIT_DATA__` 等）还原完整 SKU 矩阵（各自价格/库存/图），DOM 启发式降级为兜底。
- **文件**：`extension/content.js:178-205,351-358,146-175`

### S3-6 ｜底部推荐区图片过滤失效

- **严重度**：High ｜ **类型**：抓取准确性 / Bug
- **现象**：`recommendBoundaryY` 依赖关键词文案 + 文档坐标，但 `autoScroll` 末尾已回顶部，推荐区图此刻多为未加载占位（`naturalWidth===0` 不被小图过滤拦截），别家商品图混入污染主图与图片数；关键词正则脆弱，1688 改文案即失效。
- **方案**：改为基于 DOM 结构（详情容器子树内的图）圈定图片来源，对 `naturalWidth===0` 的图延后判定/排除。
- **文件**：`extension/content.js:50-60,80-83,222`

### S3-7 ｜图片 URL 规范化破坏非标准 CDN 链接

- **严重度**：Medium ｜ **类型**：抓取准确性 / Bug
- **现象**：`normalizeImg` 对任何含 `alicdn.com` 的 URL 一律追加 `_800x800.jpg`，`.png`/`.webp` 或不支持尺寸后缀的路径会得到 404 死链；`.webp` 强转 `.jpg` 也可能不支持。
- **方案**：仅对已知支持尺寸后缀的 CDN 路径追加且保留原扩展名；缩略图 `onerror` 回退原图（当前仅隐藏）。
- **文件**：`extension/content.js:24-36`、`extension/popup.js:257`

### S3-8 ｜插件 content.js 注入重试会重复注册监听器

- **严重度**：Medium ｜ **类型**：Bug / 错误处理
- **现象**：`sendScrape` 注入失败仅重试一次无退避；`scripting.executeScript` 注入的 content.js 顶层会重复 `addListener`，多次注入注册多个监听器致 `sendResponse` 竞争。
- **方案**：content 端设全局标志位避免重复注册监听；注入失败给明确文案。
- **文件**：`extension/popup.js:134-142`

### S3-9 ｜ComfyUI 完成判定不辨成功失败

- **严重度**：Medium ｜ **类型**：Bug / 未完成功能
- **现象**：`wait_for_completion` 只要 `prompt_id in data` 即返回，不检查节点是否真成功；失败的 prompt 也进 history。
- **方案**：检查 history 中 status/错误字段（与 S3-1 合并实施）。
- **文件**：`backend/app/integrations/comfyui/client.py:20-32`

### S3-10 ｜真实 Shopify 同步未完成项的 UI 标识

- **严重度**：Medium ｜ **类型**：未完成功能 / UX
- **现象**：mock 上架成功与真实上架在前端无区分，用户误判。
- **方案**：商品状态/Shopify ID 列对 mock 数据加"模拟"标识（配合 S3-2）。
- **文件**：`admin/src/app/products/page.tsx`

### S3-11 ｜Dashboard 统计卡占位未接数据

- **严重度**：Low ｜ **类型**：未完成功能
- **现象**："今日活跃""本月导入"硬编码 `—`。
- **方案**：接入统计接口或暂移除。
- **文件**：`admin/src/app/dashboard/page.tsx:26-27`

---

## Sprint 4 — 性能与体验优化（P2）

> 目标：分页/查询优化、富文本与受控组件修复、可访问性、技术债清理。

### S4-1 ｜商品/选品池列表无分页 + 搜索无防抖

- **严重度**：High ｜ **类型**：性能
- **现象**：`products/page.tsx` 的 `load` 把 search/statusFilter 放进依赖，每输入一字符即发请求（无防抖）且产生竞态；该页无分页控件，上千条一次性拉取渲染卡顿。
- **方案**：搜索加 300ms 防抖；商品列表接入分页（接口已支持 `?page`）。
- **文件**：`admin/src/app/products/page.tsx:27-39`

### S4-2 ｜转入商品前端串行循环，大批量卡死无进度

- **严重度**：High ｜ **类型**：性能 / UX
- **现象**：非后台模式 `for(id of confirmIds) await createProductFromPool`，选 50 项即 50 顺序往返，弹框卡"处理中…"无进度，易被误关致部分完成。
- **方案**：改走后端批量接口（已有 `queueFromPool`），或前端并发限流 + 实时进度条。
- **文件**：`admin/src/app/product-pool/page.tsx:183-192`

### S4-3 ｜后端多个列表端点缺分页/上限

- **严重度**：Medium ｜ **类型**：性能
- **现象**：collections/spu-rules/shops/pricing-rules 列表无分页，super_admin 调用拉全表；audit-logs 仅 limit 无上限保护。
- **方案**：统一加 `page/page_size`（带 `le` 上限）。
- **文件**：`backend/app/api/v1/collections.py:34-40`、`spu_rules.py:24-30`、`shops.py:57-72`、`pricing.py:49-69`

### S4-4 ｜团队列表 N+1 查询

- **严重度**：Medium ｜ **类型**：性能
- **现象**：`list_teams` 先查 Team 再对每团队各发一条 count(User)，1+N 查询。
- **方案**：一次 `GROUP BY team_id` 聚合或子查询 join。
- **文件**：`backend/app/api/v1/teams.py:63-79`

### S4-5 ｜图片下载无大小上限 + S3/本地 IO 阻塞事件循环

- **严重度**：Medium ｜ **类型**：性能 / 安全(DoS)
- **现象**：`_download_single` 整图 `resp.read()` 进内存无上限；同步 boto3 `put_object` 与 `shutil.copy` 在 async 函数里阻塞事件循环。
- **方案**：流式下载 + 最大字节限制；文件 IO 用 `run_in_executor`/aioboto3。
- **文件**：`backend/app/services/image_service.py:64-120`

### S4-6 ｜富文本依赖已废弃 execCommand + 链接无协议校验

- **严重度**：Medium ｜ **类型**：技术债 / 安全
- **现象**：RichEditor 全靠 `document.execCommand`（deprecated，生成脏 HTML）；`createLink` 用 `prompt` 取链接无校验，可注入 `javascript:` 协议。
- **方案**：迁移 Tiptap/Slate；链接做协议白名单。
- **文件**：`admin/src/components/ProductEditor.tsx:26,40`

### S4-7 ｜ProductEditor contentEditable 受控陷阱 + index 作 key

- **严重度**：Medium ｜ **类型**：Bug
- **现象**：① `useEffect(..., [])` 仅挂载时同步 innerHTML，value 后续外部变化（AI 回填/重置）编辑区不更新；② images/options/variants 用 `key={i}`，删除/重排后含输入框的行 DOM 错位。
- **方案**：依赖加 value 同步（避免光标跳动）；用稳定唯一 id 作 key。
- **文件**：`admin/src/components/ProductEditor.tsx:25,175,193,211`

### S4-8 ｜triggerTranslate/Pricing 用裸 setTimeout 假定固定耗时

- **严重度**：Medium ｜ **类型**：Bug / 性能
- **现象**：触发后 `setTimeout(load,2000)`+`setTimeout(openDetail,3000)` 假定任务固定时间完成（AI 时长不定，3 秒常仍旧状态），timeout 未保存句柄、卸载后仍 setState。
- **方案**：改带清理的真实状态轮询（参考 transfer-jobs），或后端推送。
- **文件**：`admin/src/app/product-pool/page.tsx:119-128`

### S4-9 ｜多处整页 `window.location` 刷新破坏 SPA/多标签页

- **严重度**：Medium ｜ **类型**：UX
- **现象**：转入结果/队列"前往商品管理""查看队列"用 `window.location.href`，强制下线 `reload()`，重置内存态、清空已开 tab，与项目 `router.push` 不一致。
- **方案**：统一用 `next/navigation` 的 `router.push`，下线后局部刷新。
- **文件**：`admin/src/app/product-pool/page.tsx:642,644,657,673`、`admin/src/app/sessions/page.tsx:20`

### S4-10 ｜根路由 `/` 无角色判断直接渲染超管 Dashboard

- **严重度**：Medium ｜ **类型**：Bug / UX
- **现象**：`/` 直接导出 DashboardPage，普通成员访问根路径落到对其无意义且接口 403 的页面。
- **方案**：`/` 改按 role 重定向（super_admin→/dashboard，其他→/product-pool）。
- **文件**：`admin/src/app/page.tsx:1-2`

### S4-11 ｜后台队列轮询空闲时仍全量拉取

- **严重度**：Low ｜ **类型**：性能
- **现象**：transfer-jobs 页 auto-refresh 队列空闲时仍每 2.5s 拉 200 条；选品池首屏无条件 `loadJobs()` 一次即便用户从不打开队列。（定时器本身已正确清理）
- **方案**：队列空闲（pending+running=0）时降频/暂停；徽标计数按需加载。
- **文件**：`admin/src/app/product-pool/page.tsx:151-156`、`admin/src/app/transfer-jobs/page.tsx:33-37`

### S4-12 ｜后端数据/技术债清理（合并项）

- **严重度**：Medium~Low ｜ **类型**：数据一致性 / 技术债
- **现象（合并）**：
  - 选品池删除未清理 `Product.source_pool_id`（裸字符串无 FK）→ 悬挂引用；db_migrate 与 Alembic 职责重叠、无版本号。
  - JSON 列用可变字面量默认值（`default=[]`/`default={}`）多处，应改 `default=list`/`default=dict`。
  - 翻译/SEO 内容 f-string 拼 HTML 无转义（内部预览页存储型 XSS 风险）。
  - 定价 `cost_usd=price_cny/rate` 未校验 rate>0（除零）、未校验价格非负。
  - LLM 失败原文（含 base_url/模型名）经异常 detail 回传前端，泄露内部配置。
  - bcrypt 72 字节静默截断；审计日志依附主事务且多数写操作未记审计。
- **方案**：逐项按描述修复；迁移收敛到单一机制（Alembic）。
- **文件**：`backend/app/api/v1/product_pool.py:242-257`、`backend/app/db_migrate.py`、`backend/app/models/__init__.py`（JSON 默认值）、`backend/app/services/pricing_service.py:74-75`、`backend/app/integrations/llm/provider_router.py:33`、`backend/app/core/security.py:11-16`、`backend/app/core/audit.py`

### S4-13 ｜前端技术债清理（合并项）

- **严重度**：Low ｜ **类型**：技术债
- **现象（合并）**：两个冲突的 next 配置文件（`next.config.js` 与 `.ts`）；API baseURL 硬编码无 `.env.example`；核心数据模型全 `any`（PoolItem/Product/Translation）。
- **方案**：删多余 next 配置；提供 `.env.example`，生产缺失环境变量时显式报错；为核心模型定义 TS 接口逐步替换 any。
- **文件**：`admin/next.config.ts`（删）、`admin/src/lib/api.ts:1`、`.env.example`（新建）

### S4-14 ｜可访问性与一致性

- **严重度**：Low ｜ **类型**：UX
- **现象**：可点击元素普遍用无 href 的 `<a>`/`<span>` 承载点击，无键盘可达/aria 标签；Modal 无焦点管理与 ESC（仅点遮罩关）；图片 alt 普遍空。插件 `permissions` 含全量 `tabs`（可收窄为 activeTab）；popup.html `onerror` 内联事件与项目 CSP 规范冲突。
- **方案**：可点击元素改 `<button>` 补 aria；Modal 加焦点管理/ESC；评估收窄插件权限；onerror 改 addEventListener。
- **文件**：`admin/src/app/product-pool/page.tsx`（多处）、`admin/src/components/ProductEditor.tsx`、`extension/manifest.json:6`、`extension/popup.html`

---

## 附录 A — 验证与回归清单（每批次完成后执行）

每个 Sprint 收尾前应完成以下验证，避免改动引入回归：

1. **后端**：`py_compile` 全量通过；针对 S1/S2 修复编写单元测试（配额生效、权限隔离、upsert 并发、JWT 黑名单）；迁移在 db 副本上验证（保留行、放宽 NOT NULL、不动选品池）。
2. **前端**：`tsc` 全量通过；`next build` 通过（验证 S2-9 Suspense 修复）；关键页手测列表竞态/分页/防抖。
3. **插件**：在 `chrome://extensions` 重载；在真实 1688 商品页验证抓取（标题/价格/SKU/图片/属性/描述）；验证 token 桥接与 401 重登。
4. **安全回归**：S1 修复后用 XSS payload、路径遍历 payload、越权 team_id/role 做渗透式验证。
5. **高风险项建议用独立 reviewer/子代理做二次审查**（S1-4 SSRF、S1-6 XSS 链、S3-4 插件收敛）。

## 附录 B — 优先级速查（Top 10 必修）

| # | 问题 | 严重度 | 批次 |
|:--:|------|:--:|:--:|
| 1 | 配额校验完全失效（付费墙失效） | Critical | S1-1 |
| 2 | XSS + localStorage Token（账户接管链） | Critical | S1-6 |
| 3 | `/media` 路径遍历任意文件读取 | Critical | S1-3 |
| 4 | AI fetch-models 缺权限（SSRF+密钥外泄） | Critical | S1-4 |
| 5 | 选品池入库 IDOR（跨团队写入） | Critical | S1-5 |
| 6 | 插件写死 localhost + 两套实现（不可发布） | Critical | S3-4 |
| 7 | JWT 黑名单失效（无法吊销会话） | High | S1-7 |
| 8 | 凭据明文 + 弱 SECRET_KEY | High | S1-9 |
| 9 | 后台任务线程+asyncio.run（丢任务/竞态） | High | S2-1 |
| 10 | 修图链路为空壳（核心卖点未实现） | High | S3-1 |

---

> 备注：本计划基于 2026-06-15 的代码快照。所有文件:行号已经代码审计核实；实施前建议对照最新代码二次确认行号。安全类（S1）改动建议优先合入并尽快上线。
