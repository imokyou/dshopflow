# Shopify OAuth 接入 + 上下架打通 — 设计稿

> 日期：2026-06-17
> 状态：§1 已确认；§2-5 待续（因转去处理素材库 AI 卡住问题而暂停）
> 来源：brainstorming 会话（对照现有 `shops.py` / `shopify_product_service.py` / `models.Shop` / `config.py`）

## 已确认的范围决策

- **接入方式**：Shopify **OAuth 授权应用**（用户点授权，而非手填 token）。OAuth 优先。
- **联调环境**：开发期用**内网穿透**（cloudflared/ngrok）把 `localhost:8000` 暴露成临时 https；故 `redirect_uri` / 后端 base 做成**环境变量可配**。
- **本轮范围**：OAuth 店铺授权接入 **+ 上下架打通**（用真实店铺验证 active/draft 端到端）；顺手修「无凭证造假 shopify_id 误导」+ 加「店铺连接测试」。
- **暂不做（后续）**：变体价格/库存/图片的**增量更新同步** + `shopify_variant_id` 回填。

## 关键前提（需用户准备，代码无法代办）

1. Shopify Partner 后台建 App → 拿 **API key + API secret**，配置 scopes（`write_products,read_products`）与 redirect_uri。
2. 后端公网 https 地址（开发用穿透域名）。

## §1 OAuth 授权流程与配置（已确认）

**模式**：平台侧一个 Partner App（一套 key/secret 放后端 env），各团队对自己店铺授权。

**新增配置**（`config.py` Settings，env 可配）：
- `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET`
- `SHOPIFY_SCOPES`（默认 `write_products,read_products`）
- `SHOPIFY_APP_BASE_URL`（后端公网 https base，拼 `redirect_uri`）
- `ADMIN_BASE_URL`（授权完成跳回管理后台）

**流程**：
1. 后台「店铺管理」→「连接 Shopify」→ 输入 `xxx.myshopify.com`。
2. `GET /shops/oauth/install?shop=xxx` → 校验域名 → 生成 **state**（SECRET_KEY 签名的短期 JWT，含 team_id/user_id/nonce/exp，做 CSRF + 携带归属，无需服务端存）→ 拼 authorize URL 返回。
3. 用户授权 → Shopify 重定向 `…/oauth/callback?code&shop&state&hmac&timestamp`。
4. 回调：**验 hmac**（HMAC-SHA256 + API secret）→ **验 state**（CSRF + 解出 team/user）→ 校验 shop 域名正则 → code 换 token（POST `https://{shop}/admin/oauth/access_token`）→ 拿 access_token+scope。
5. **Upsert** Shop（team_id+shop_domain 唯一，token 加密存，记 scope）→ 302 跳回 `ADMIN_BASE_URL/shops?connected=1`。

## 变更：配置改为 DB 管理（超管「平台设置」页）— 已实现

> 用户决策：Shopify App 配置（key/secret/scopes/回调域名/后台地址）**存数据库、超管后台可视化管理**，比改 `.env` + 重启友好。env 保留为兜底默认（DB 无值时回退）。

- 新表 `platform_settings`(key PK / value / updated_at)，secret 类（`shopify_api_secret`）**加密存储、对外掩码不回明文**；`db_migrate` 幂等建表。
- `services/platform_settings_service.py`：`get_shopify_config`（DB 优先 env 兜底，解密）、`get_public_settings`（掩码 + 计算 `callback_url`）、`set_values`（secret 空串不覆盖原值）。
- `integrations/shopify/oauth.py` 重构为接收显式参数（api_key/secret/scopes/base），不再直接读 settings。
- `api/v1/admin.py`：`GET/PUT /admin/platform-settings`（`MANAGE_SUBSCRIPTIONS` 权限）。
- `api/v1/shops.py`：install/callback 改从 `get_shopify_config(db)` 取配置；callback 自开会话先读配置（含 admin_base_url 用于跳转）。
- 前端：新增 `/platform-settings` 页（超管菜单「⚙️ 平台设置」），填配置 + 显示要粘到 Partner app 的回调地址；店铺页 `/shops` 加「连接 Shopify（授权）」+ 回调结果横幅 + 每行「测试连接」。
- 验证：服务/oauth 联动单测全过（加密/掩码/空不覆盖/callback_url/install_url）；后端启动建表正常、路由注册（401）；前端 tsc 通过。**改配置无需重启**（每请求读 DB）。

## §3 上下架打通 — 已实现

- `shopify_product_service.sync_to_shopify`：**去掉「无凭证造假 shopify_id」**——无可用店铺 token 时 `raise RuntimeError("未连接可用的 Shopify 店铺…")`，不再伪成功；有 token 才调真实 API（创建走全量 payload，更新走主字段+status）。
- `products.py` 的 `publish`(active)/`unpublish`(draft)/`sync` 端点：捕获 `RuntimeError` → `HTTPException(400, detail)`，前端商品页 `act()` 已 `alert(e.message)` 展示。
- `_pick_shop`：商品 `shop_id` 优先，否则取团队首个 active 店铺（OAuth 连接后即有）。
- **未做（后续）**：变体价格/库存/图片增量更新 + `shopify_variant_id` 回填（更新路径目前只推主字段+status）。
- 验证：后端编译通过、重启干净；前端无需改（不再依赖 `mocked`）。**端到端需真实连接店铺后验证**：发布 → Shopify 后台可见 active 商品 → 下架 → 变 draft。

## §2-5 待续提纲（未细化）

- **§2 后端改动**：`config.py` 新字段；`shops.py` 加 `/oauth/install`、`/oauth/callback`、`/{id}/test`（连接测试调 `shop.json`）、保留手填创建作兼容；`Shop` 模型可加 `scope` 列（db_migrate 幂等补列）。hmac/state 校验放 `core/`。
- **§3 上下架 + 同步修正**：`shopify_product_service.sync_to_shopify` 去掉「无凭证造假 id」（无 token 应明确报「未连接店铺」而非伪成功）；publish=active / unpublish=draft 用真实店铺验证；`_pick_shop` 选店逻辑确认。
- **§4 前端**：`shops/page.tsx` 加「连接 Shopify」（输入域名→跳 install）、连接状态/测试/断开；`products` 上架/下架按钮对接真实结果，去除「模拟」误导标识。
- **§5 测试与验证**：state/hmac 校验单测；用真实穿透域名 + 真实店铺跑通授权→上架(active)→Shopify 后台可见→下架(draft) 端到端。

## 验证教训（来自本会话）

没有真实目标（真实 1688 页 / 真实 Shopify 店铺）就只能盲做、无法验证。OAuth 与上下架必须对真实店铺联调确认，不接受「对 mock 通过即完成」。
