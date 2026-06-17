# WORK_PLAN 执行日志

> 执行日期：2026-06-15
> 范围：Sprint 1 全部 + Sprint 2 可验证子集
> 验证：后端 `python -m compileall app` 通过；前端 `tsc --noEmit` 通过；关键安全/逻辑用隔离单测核验

---

## ✅ Sprint 1 — 安全与数据正确性（9/9 全部完成）

| 编号 | 修复 | 改动文件 | 验证 |
|:--:|------|---------|------|
| S1-1 | 配额校验用错主键 → 改 `SubscriptionPlan.quota_rule` | `core/permissions.py` | 逻辑核验 |
| S1-2 | `date_trunc` SQLite 不支持 → Python 端算本月首日 | `core/permissions.py` | 单测 month_start |
| S1-3 | `/media` 路径遍历 → 文件名白名单正则 + resolve 越界校验 | `api/v1/router.py` | 单测 5 例通过 |
| S1-4 | fetch-models SSRF/密钥外泄 → 加权限 + 内网拦截 + 同源回填 | `api/v1/admin.py` | 单测 IP 分类/同源 |
| S1-5 | 选品池入库 IDOR → 忽略请求体 team_id，用当前用户团队 | `api/v1/product_pool.py` | 代码核验 |
| S1-6 | 存储型 XSS → 新增无依赖 `sanitizeHtml`，净化两处渲染 | `lib/sanitize.ts`、`product-pool/page.tsx` | tsc + URL 规则单测 |
| S1-7 | JWT 黑名单未接入 → `get_current_user` 校验 jti | `dependencies.py` | 代码核验 |
| S1-8 | role 无白名单越权 → 校验 `member/manager` | `api/v1/admin.py` | 代码核验 |
| S1-9 | 凭据明文/弱密钥/CORS → Fernet 加密 + 启动守卫 + 正则 CORS | `core/crypto.py`、`config.py`、`main.py`、`shops.py`、`provider_router.py` 等 | Fernet 往返单测 |

**新增文件**：`backend/app/core/crypto.py`（向后兼容加解密）、`backend/.env`（本地强密钥）、`backend/.env.example`、`admin/src/lib/sanitize.ts`

**重要说明**：
- 凭据加密向后兼容——历史明文数据读取时原样返回，无需一次性迁移；写入即加密。
- `DEBUG` 默认改为 `False`；已生成 `backend/.env`（`DEBUG=true` + 强 `SECRET_KEY` + `CREDENTIAL_ENCRYPTION_KEY`）保证本地 `./start.sh` 正常。**生产部署须设置独立的 SECRET_KEY/加密密钥并 `DEBUG=false`。**
- S1-6 的 Token→HttpOnly Cookie 迁移**未做**：属跨端架构改动，会破坏插件「从管理后台 tab 读 localStorage token」的桥接；XSS sink 已净化，利用链已切断，Cookie 迁移单列为后续项。

---

## ✅ Sprint 2 — 稳定性（已完成 11 项）

| 编号 | 修复 | 改动文件 | 验证 |
|:--:|------|---------|------|
| S2-2 | offerId 去重并发竞态 → 捕获 IntegrityError 回滚转更新 | `api/v1/product_pool.py` | compile |
| S2-4 | 图片下载静默失败把防盗链 URL 当成功 → public_url 置 None + 标错 + 日志 | `services/image_service.py` | 下游消费已过滤核验 |
| S2-5 | import status 缺团队隔离 → 补 team_id 校验 | `api/v1/imports.py` | compile |
| S2-6 | 邀请过期从不校验 → 注册时校验 expires_at（含 naive/aware 处理） | `services/auth_service.py` | 单测 3 例 |
| S2-7 | 前端列表后发先至竞态 + 翻页 setTimeout 黑客 → 请求序号 + 防抖，移除 setTimeout | `products/page.tsx`、`product-pool/page.tsx` | tsc |
| S2-8 | 401 刷新缺口 → 刷新前确保 refreshToken 从 localStorage 加载 | `lib/api.ts` | tsc |
| S2-9 | login `useSearchParams` 未包 Suspense → 拆子组件 + Suspense | `login/page.tsx` | tsc |
| S2-10 | 错误静默吞掉 → 新增无依赖全局 `toast`，选品池加载/操作失败可见；AI Provider 已有错误显示 | `lib/toast.ts`、`product-pool/page.tsx` | tsc |
| S2-11 | 异步按钮可重复提交 → 选品池翻译/定价/删除加 busy 守卫防重复 | `product-pool/page.tsx` | tsc |
| S2-12 | 插件并发抓取踩踏 → 按 tabId 加 inFlight 锁，同 tab 禁止并发 | `extension/popup.js` | node --check |
| S2-13 | 插件 token 过期无重登 → apiCall 401 清 token 回登录引导视图 | `extension/popup.js` | node --check |

**新增文件**：`admin/src/lib/toast.ts`

---

## ✅ Sprint 2 后台任务重构（S2-1 / S2-3 完成）

统一后台任务模型，替换「每任务一线程 + asyncio.run 新事件循环 + 新连接」反模式。

| 编号 | 修复 | 改动文件 | 验证 |
|:--:|------|---------|------|
| S2-1 | 翻译/定价/转入/直跑管道去线程 → 单常驻 in-loop async worker，任务落库可恢复、串行处理避免 SQLite 写锁争用 | `core/worker.py`(新)、`api/v1/product_pool.py`、`api/v1/products.py`、`api/v1/imports.py`、`main.py` | compile |
| S2-3 | worker 布尔锁多进程不安全 → DB 原子认领 `UPDATE...WHERE status='pending'` + rowcount 检查，保证单赢家 | `core/worker.py` | **8 并发×100 任务单测：各认领恰好一次，零重复** |

设计要点：
- **持久化队列**：转入用 `TransferJob` 表、翻译/定价用 `TaskLog`（status=pending）。端点只入队 + `worker.notify()` 唤醒，立即返回 202。
- **原子认领**：worker 取候选后逐个 `UPDATE ... WHERE id=:id AND status='pending'`，仅 rowcount==1 者赢得任务 → 多进程/多 worker 不重复处理（已用 stdlib sqlite3 并发实测验证）。
- **恢复**：启动时 `resume_interrupted()` 把中断的 running 重置为 pending，`start_worker()` 拉起常驻 worker。
- **翻译/定价处理函数** 重构为 `process_translation_log(db, log)` / `process_pricing_log(db, log)`，复用 worker 的 db 会话，不再各自新建连接。
- **直跑管道**（imports direct 模式）改 `asyncio.create_task` 在主循环运行，保留协程引用防 GC。

**多进程恢复注意**：`resume_interrupted` 的 running→pending 重置在单进程/开发安全；多进程部署若需精确恢复应改为心跳/租约机制（已在代码注释标注）。

**新增文件**：`backend/app/core/worker.py`

---

## ✅ Sprint 3 增量（2026-06-16 下午）—— 插件收敛 + 抓取重构

| 编号 | 修复 | 改动文件 | 验证 |
|:--:|------|---------|------|
| S3-4 | 收敛为单一手写实现（删 Plasmo `src/`/`popup.tsx`/`login-bridge.js` 等）+ 可配置后端域名（默认 localhost，⚙ 设置面板，optional_host_permissions 运行时申请） | `config.js`(新)、`manifest.json`、`background.js`、`popup.js`、`popup.html`、`package.json`、`README.md`（删 `src/` 等） | node --check |
| S3-5 | 解析内嵌 offer JSON 还原精确 SKU 矩阵（颜色×尺码笛卡尔，各含价/库存/图）；DOM 兜底也改全规格组笛卡尔（修「只取第一组」） | `content.js` | **test_scrape.js 29 断言全过** |
| S3-6 | 推荐区图片过滤结构化：内嵌主图 + 详情容器子树圈定，弃用关键词/坐标为唯一手段（保留为兜底 + 未加载占位剔除） | `content.js` | 单测 findOfferImages/findDetailRoot 路径 |

**新增文件**：`extension/config.js`、`extension/test_scrape.js`
**注意**：未做浏览器实测——设置交互、真实 1688 抓取、token 桥接需 `chrome://extensions` 重载后人工验证。

## ⏳ 未完成项（建议后续按批推进）

### Sprint 3 — 功能闭环（需决策/外部服务，详见 WORK_PLAN.md）
- S3-1 修图链路（ComfyUI）、S3-2 真实 Shopify 同步。（S3-4 / S3-5 / S3-6 已完成）

### Sprint 4 — 性能与体验技术债（详见 WORK_PLAN.md）

### Sprint 3 — 功能闭环（需决策/外部服务）
- **S3-1 修图链路**（ComfyUI 真实调用 + ImageCompare 组件）：需可用的 ComfyUI 服务验证。
- **S3-2 真实 Shopify 同步**（变体/图片增量 + id 回填）：需 Shopify 店铺凭证验证。
- **S3-4 插件收敛单一实现 + 接通生产后端**：需确认保留手写版、删除 `src/` Plasmo 版，并确定生产域名。
- **S3-5/S3-6 抓取重构**（解析内嵌 offer JSON、推荐区过滤）：需在真实 1688 页面验证。

### Sprint 4 — 性能与体验
- 分页/N+1/富文本迁移/可访问性等技术债，风险低，建议最后批量处理。

---

## 备注
- 本次所有改动已写入磁盘对应文件。会话内 git 快照因沙箱锁文件权限限制未能提交，但不影响实际文件内容。
- 建议在本机执行 `./restart.sh` 后做一轮冒烟：登录、选品池抓取入池、翻译/定价、AI Provider 拉模型（验证 SSRF 拦截）、邀请注册。
