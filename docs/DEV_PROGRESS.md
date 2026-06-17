# DropShipFlow 开发进度

> 最后更新: 2026-06-16（安全加固 + 后台任务重构 + SPU/SKU + 素材库 + 图片过滤）
>
> 本次会话（2026-06-15/16）的完整记录见文末「## 2026-06-15/16 大版本」一节；
> 配套文档：`docs/WORK_PLAN.md`（审计与计划）、`docs/EXECUTION_LOG.md`（S1/S2 执行明细）。

## 项目结构

```
/Users/lupt/projects/1688-shopify-importer/
├── backend/          FastAPI + SQLAlchemy + SQLite, :8000
├── admin/            Next.js 14 管理后台, :3000
├── extension/        Chrome MV3 浏览器插件
└── docs/             设计文档
```

**启动命令：**
```bash
# 一键启动（后端:8000 + 管理后台:3000，Ctrl+C 一并关闭）
./start.sh            # 或在 Finder 双击 start.command
./stop.sh             # 按端口停止两个服务
./restart.sh          # 停止后重新启动
./status.sh           # 查看两个服务运行状态(进程+探活)

# 或分别手动启动：
cd backend && PYTHONPATH=. /opt/homebrew/Caskroom/miniconda/base/bin/python3 -m uvicorn app.main:app --port 8000
cd admin && npx next dev --port 3000
```

> `start.sh`：自动选 python 解释器、并行拉起前后端、实时打印日志（存 `logs/`）、退出时一起清理。`start.command` 为 Finder 双击版。

---

## V2 选品池 + 分段管道 (2026-06-11)

### 架构变更

```
插件抓取 → ProductPool（选品池）
              ├── [分段1] 翻译 + 定价（快速，可批量）
              ├── [分段2] 修图（慢速，逐张预览确认）— 待实现
              └── [分段3] 创建 ImportTask → Shopify 上架 — 待实现
```

### 已完成 ✅

| 步骤 | 内容 | 涉及文件 |
|:--:|------|---------|
| 1 | 四表模型 (product_pools, product_details, product_translations, task_logs) | `models/__init__.py` |
| 2 | 选品池 CRUD API (offerId去重, 列表/详情/删除) | `api/v1/product_pool.py` |
| 3 | 翻译服务 (LLM→product_translations, 多语言, 可手动修正) | 同上 |
| 4 | 定价服务 (PricingEngine→主表, 汇率×倍率, 可手动调价) | 同上 |
| 8 | 批量翻译/定价端点 (batch-translate, batch-price) | 同上 |
| 9 | 选品池前端页面 (列表/搜索/筛选/详情弹框/抓取表单/翻译编辑/手动调价) | `admin/.../product-pool/page.tsx` |
| 11 | 插件改造 (对接 /product-pool, 简化为「加入选品池」) | `extension/popup.js`, `popup.html` |
| — | 登录页改进 (source=extension 专用视图, 已登录自动跳转) | `admin/.../login/page.tsx` |
| — | 扩展登录桥接 (popup 主动从管理后台 tab 读 token) | `extension/popup.js`, `manifest.json` |
| — | **插件改为侧边栏 (Side Panel) + 最近选品列表** | `extension/manifest.json`, `background.js`, `popup.html`, `popup.js` |

### 插件侧边栏改造 (2026-06-11)

从 popup 弹窗改为 Chrome Side Panel，固定在页面右侧，常驻显示「最近选品」列表。

- `manifest.json`：新增 `sidePanel`/`tabs` 权限 + `side_panel.default_path`，移除 `action.default_popup`
- `background.js`：`sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`，点工具栏图标打开右侧栏
- `popup.html/js`：全宽可滚动布局；新增「📋 最近选品」区块，拉 `GET /product-pool?page_size=20`（按 updated_at 倒序），显示缩略图/标题/成本价/SKU 数/状态标签；加入选品池成功后自动刷新，支持手动刷新；点列表项跳转管理后台 `/product-pool`
- 状态标签颜色映射：captured/translated/priced/images_ready/imported 等
- **一键入池**：点「抓取并加入选品池」直接 scrape→submit，无需二次确认；按钮带「抓取中…/加入中…」loading 态。移除预览卡片与成功页，入池后直接刷新「最近选品」，新品显示在列表顶部
- **后台选品池刷新按钮**：`admin/.../product-pool/page.tsx` 筛选行加「🔄 刷新」，复用 `load()`/`loading`，刷新中禁用
- **后台列表加列**：新增 SKU 数量、抓取时间(MM-DD HH:mm)两列；标题去截断完整换行显示
- **访问原页面入口**：列表操作列 +「原页面」、详情弹框 offer_id 旁 +「🔗 访问原页面」，`source_url` 新标签打开
- **操作列去 emoji+紧凑**：翻译/定价/原页面/删除改纯文字链接(去按钮内边距)，gap 8、列宽 180、flex-nowrap 单行
- **抓全页商品图**：`content.js` `collectImages()` 扫整页 `<img>`（含 data-src/data-lazy-src/srcset 懒加载 + background-image），只取 alicdn CDN 图，过滤 <80px 图标，缩略图 URL 还原原图（去 `_310x310.jpg` 后缀）；抓取前逐段滚到底触发懒加载。后台详情页 `原始数据` 新增「商品图片」缩略图廊（点击看原图）。注意：修复前抓的商品需重新抓取才有图
- **价格/SKU 抓取**：原 `.sku-item`/固定 price 选择器匹配不到真实 1688 页（动态渲染+混淆类名）→ 改启发式：`extractPrice()` 扫 `[class*=price]`+正文 ¥ 金额（支持区间）、`extractStock()` 匹配「库存N」、`extractSpecs()` 从规格标签(颜色/规格/尺码…)旁收选项生成 SKU，兜底生成带价/库存的「默认」SKU。popup SKU 映射改为兼容数字 price。**局限**：多规格(颜色×尺码)仅取第一组，精确多 SKU 需解析页面内嵌 offer JSON
- **抓取前等整页加载**：`content.js` `waitPageReady()`(readyState=complete) → `autoScroll()` 逐段滚动触发懒加载 → `waitImagesSettled()` 等图片全部 complete/数量稳定(≤8s)，避免漏图
- **抓取后关闭商品页(可配置)**：面板加「抓取完成后关闭该商品页」复选框，存 `chrome.storage.local.closeTabAfterScrape`(默认关)，入池成功后 `chrome.tabs.remove` 关闭对应 tab；侧边栏窗口级不受影响
- **详情弹框加大+固定标题**：`Modal` 改 flex 纵向，宽 `min(1040px,94vw)`/高 90vh，标题栏固定、内容区独立滚动；详情 tabs 导航 sticky 吸顶
- **标题抓取修正**：原 `h1` 兜底抓到店铺名 → `extractTitle()` 优先页面 `<title>`(去站点后缀/【】前缀)，`looksLikeShop()` 过滤商行/经营部/有限公司/旗舰店等，页面 h1/title 候选按长度兜底
- **商品属性抓取**：`content.js` `extractAttrs()` 识别属性表(关键词≥2 命中避开 SKU 表)成对解析为 `[{name,value}]`，div/列表兜底；popup 传 `attrs`(原硬编码 [])；后台详情 `原始数据` 新增「商品属性」表格
- **后台并发抓取(不阻塞)**：点抓取改为 `runScrapeJob(tabId)` 不 await，UI 立即放开，可切标签/再抓；`submitData(快照)` 替代依赖全局 `currentProduct`，支持并发；面板底显示「后台抓取中 N 个」+ 成功/失败提示。限制：抓取依赖该商品页 DOM，勿导航走/关闭同一 tab（新标签开下一个最稳）
- **详情描述去滚动条**：移除描述块 `maxHeight:100/overflow:auto`，整段平铺随弹框滚动
- **商品详情(图文)抓取**：`content.js` `extractDescription()` 评分挑文字+图片最富的 desc/detail 容器(排除>30k 整页)，`cleanDescHtml()` 去 script/style/iframe、懒加载图 data-src→src 并限宽、清内联事件；替代原 `.desc-content` 选择器。排除评价/推荐/问答容器(class/id 含 comment/review/评价/推荐/猜你喜欢 或文本以「商品评价」等开头)，不抓评价
- **面板列表显示抓取时间**：`fmtTime()` 渲染 `created_at`(刚刚/N分钟前/今天 HH:mm/MM-DD HH:mm)，放在状态行最右(`margin-left:auto`)不另占行
- **面板底部显示真实账号**：JWT `sub` 是用户ID非邮箱 → 登录后调 `/admin/me` 取 `user.email` 显示并回写缓存(无邮箱退到 name)
- **图标过滤**：`collectImages()` 加 `isIconUrl()`(排除 gw.alicdn、`/tfs//tps//sns/` 目录、`-tps-/-tbs-数字-数字.png` 平台图标、logo/icon/share/qrcode/avatar 等) + 真实渲染尺寸 `naturalWidth/Height<100` 剔除图标 + URL 尺寸阈值提到 100，滤掉淘宝/拼多多/小红书/抖音分享图标与 UI 轮廓图标。注意：`/imgextra/iN/` 路径商品图也在用，不能按 `/iN/` 一刀切，故按 `-tps-` 图标特征精准过滤
- **待办**：旧记录需重抓才有正确标题/图片/属性/详情

### 完整链路

```
1688商品页 → 插件[抓取] → 预览 → [加入选品池]
                ↓
    管理后台 /product-pool
      ├─ 🌐 翻译 → AI 翻译 zh→en
      ├─ 💲 定价 → 汇率×倍率=售价
      ├─ 📋 任务日志 → 可追溯可重试
      └─ ✏️ 手动修正 → 翻译/价格可微调
```

### 待完成 ⚠️

| 步骤 | 内容 |
|:--:|------|
| 5 | 修图服务 (下载→S3→ComfyUI, 图片状态跟踪) |
| 6 | ImportTask 简化 + 关联 product_pool_id |
| 7 | Shopify 同步服务 (从主表+detail+translation 组装) |
| 10 | 修图预览组件 (原图 vs 处理后左右对比) |
| 12 | 导入任务前端改造 (从选品池创建上架) |

---

## 商品管理模块改造 (Shopify 式 CRUD + 发布, 2026-06-11)

> 独立于选品池(product_pools)，未改动选品池任何代码/数据。

### 后端
- `models/__init__.py`：`Product` 扩展富字段(title/body_html/vendor/product_type/tags/price/options/variants/images/collection_ids/seo_*/handle/shopify_synced_at)，外键(import_task_id/user_id/shop_id/shopify_product_id)改为可空(支持从零新建)；新增 `Collection` 模型。变体/图片以 JSON 存储，避免重表。
- `db_migrate.py` + `main.py` startup：幂等迁移，建 `collections` 表 + 重建 `products` 表(补列 + 放宽 NOT NULL)，保留旧数据；只动这两表。
- `api/v1/products.py`：全量 CRUD(list 分页/搜索/状态、detail、create、update、delete) + `publish`/`unpublish`/`sync`。
- `api/v1/collections.py`：合集 CRUD。`router.py` 注册。
- `integrations/shopify/client.py`：加 `create_product_raw`/`update_product`/`delete_product`/`update_variant`/`delete_variant`。
- `services/shopify_product_service.py`：`sync_to_shopify()` 组装 payload，有店铺 token 调真实 Shopify API，无则模拟成功(假 shopify_id)。

### 前端
- `lib/api.ts`：加 createProduct/publish/unpublish/sync + collections CRUD。
- `app/products/page.tsx`：Shopify 式列表(主图/标题/价格/库存/状态/Shopify ID/更新时间 + 发布/编辑/删除)；全功能编辑器(标题、富文本描述 execCommand、媒体增删排序、选项→变体笛卡尔积表格、组织 vendor/类型/标签/合集、SEO、状态、保存/保存并发布)。
- 批量删除：列表勾选列(表头全选)+红色批量操作条「批量删除」；单行/批量删除统一走确认弹框(非原生 confirm)，逐个删除后刷新。

### 范围确认
完整 Shopify 版(多变体+SEO+合集) / 发布真实 API 无凭证则模拟 / 后台从零新建为主。验证：后端 py_compile + 前端 tsc 均通过；迁移在 db 副本上验证(保留行、放宽 NOT NULL、product_pools 未动)。

### 从选品池一键转入商品管理 (只读选品池)
- 后端 `POST /products/from-pool`(products.py)：读 pool+detail+translations 组装 Product 草稿(标题/描述取英文翻译回退中文、图片取 detail 回退主图、变体按 SKU 规格生成售价用 final_price、status=draft)，只 SELECT 选品池不改动。
- 前端 `lib/api.ts` createProductFromPool；选品池列表操作列「转入商品」+ 详情弹框「📦 转入商品管理」按钮，成功后可跳转 /products。
- 转入交互升级：列表加勾选列(表头全选)+批量操作条「批量转入商品管理」；点转入先弹**二次确认**弹框(说明草稿/不发布)，完成后弹**结果弹框**(成功/失败数+错误，按钮 留在选品池/前往商品管理)，替换原生 alert/confirm。
- 转入选项(后端 from-pool 加参数)：① **定价规则** pricing_rule_id → `PricingEngine` 逐 SKU 算售价+划线价写入变体(空则沿用选品池售价)；② **AI 翻译** translate+language(en/de/fr) → 新增 `services/translate_service.py`(复用 ProviderRouter，独立于选品池)译标题/描述/卖点(失败明确报错不再静默回退)；③ **自动 SEO** generate_seo → `_gen_seo()` 从最终标题/描述生成 seo_title(≤70)/seo_description(≤160)。前端转入弹框加定价规则下拉+翻译勾选&语言+SEO 勾选，单个/批量均生效。
- **SPU 规则 + SKU 自动生成**：新增 `SpuRule`(name/code/remark) 模型+`spu_rules` 表+`api/v1/spu_rules.py` CRUD+前端 `/spu-rules` 页+菜单。转入**必须绑定 SPU 规则**(前端按钮禁用+后端校验)；`_make_sku()` 生成 `编码-规格`(大写、`-`连接，如 MK-XL / MK-XL-RED)。`create_from_pool` 重构为 `_transfer_build_and_save()` 复用。
- **后台转入队列**：新增 `TransferJob` 模型+`transfer_jobs` 表。端点 `POST /products/from-pool/queue` 入队、`GET /products/transfer-jobs` 查状态、`DELETE /products/transfer-jobs/cleared` 清理；单例 worker 线程 `_ensure_worker/_drain`(asyncio.run+async_session，每个 sleep 0.3s)逐个处理。前端转入弹框加「🕒 后台处理」勾选→走 queue；选品池头部「🕒 后台队列」按钮(待处理徽标)打开任务面板(2.5s 轮询，含状态/错误/清除已完成)。
- 注意：本批改动需重启后端(新表迁移在 startup 自动跑)。

## 修复 (2026-06-12)
- **转入报 Failed to fetch**：`products.py` 用了 `SpuRule` 但漏 import → 重启后转入 NameError 失败。已补 `from app.models import ... SpuRule`。(Failed to fetch 本质是前端没拿到响应 = 后端没起/崩；改动后必须 `./restart.sh`)
- **插件成功提示看不到**：成功提示与「后台抓取中 N 个」共用一个元素，任务结束 `finally` 的计数刷新会立刻覆盖成功文案。拆成两个独立元素：`#scrapeStatus` 专做成功(绿)/失败(红)提示条(`showToast`，停留 5/7s)，`#scrapeCounter` 专显计数(`renderCounter`)，互不覆盖。需在 chrome://extensions 刷新扩展。

## 体验增强 (2026-06-12)
- **插件按钮动效+标题跳转**：抓取按钮按压 pop + 水波纹(`#btn-scrape` overflow hidden + ripple span)；标题 `.brand#brand` 点击 `chrome.tabs.create(ADMIN)` 打开管理后台。
- **选品池「是否转入」状态+筛选**：`Product` 加 `source_pool_id`(迁移 ALTER 补列)，转入时写入；`product_pool` 列表 `EXISTS(Product.source_pool_id==pool.id)` 算 `transferred` 字段 + `?transferred=true/false` 筛选(只读不改选品池)。前端加「转入」列(✅已转入/未转入)+筛选下拉。
- **编辑器素材画册灯箱**：缩略图点击开灯箱看原图，`←/→` 切换(循环)、`Esc`/点空白关闭，显示 N/总数 + 新标签打开原图。
- **团队管理仅超管**：`Layout` userNav 去掉「团队成员」；`/teams` 页守卫 `allowed`，非超管 `router.replace("/product-pool")` 并显示跳转占位。登录跳转本就 super_admin→/dashboard、其他→/product-pool。
- **排除底部推荐图**：`content.js` `recommendBoundaryY()` 找「搭配组货/热门推荐/相关推荐/猜你喜欢/内容声明/举报…」标题最靠上的纵坐标作分界(y>200)，`collectImages` 排除该线以下图片(用 getBoundingClientRect 真实位置，不依赖混淆 class)。
- **智能多变体 SKU(服装类)**：转入时 `_attr_values()` 从商品属性识别「颜色」+「尺码/适合身高/鞋码…」→ 两个 Options(Color/Size) 笛卡尔积(上限 100)。`_sku_value_part()`：颜色取「编码+英文色」(PM04-黄色帽熊→PM04-YELLOW，去括号说明，`COLOR_MAP` 中文映射)，尺码大写(80cm→80CM)。SKU 例 `MO-PM04-YELLOW-80CM`。无颜色/尺码属性时退回 SKU 规格→单一 Default。需重启后端 + 属性已抓到。
- **变体值统一英文**：Option 值用 `_sku_value_part` 转英文(浅绿色→GREEN、66cm→66CM)去重，变体标题显示英文(GREEN / 80CM)，SKU 由英文值直接拼接(MO-GREEN-80CM)，不再中英混排。
- **修复：中文款式名颜色→SKU 丢段+重复**：1688「颜色」常是中文款式名(短袖翻领长颈鹿…)，COLOR_MAP 译不了→旧版 SKU 丢颜色段且重复(MO-59CM×N)。新增 `translate_terms()`(AI 批量译术语)，转入勾 AI 翻译时颜色款式名 AI 译英文(GIRAFFE/PUPPY)；`_finalize_parts()` 统一处理：AI 英文→COLOR_MAP→序号兜底(V1/V2)，并保证唯一非空。SKU 例 MO-GIRAFFE-59CM。需重启后端+重新转入(勾 AI)。
- **独立转入队列页**：新增 `/transfer-jobs` 页 + 菜单；状态计数卡(可筛选)+任务表+自动刷新(2.5s)+清除已完成。选品池头部按钮/结果弹框「查看队列」改为跳转该页(原 modal 弃用)。
- **变体表列宽**：editor 变体表 `table-fixed`：变体 28%、SKU 占剩余最宽(input 100%)、价格/划线价 72、库存 64，长 SKU 不再截断。
- **选品池操作列精简**：去掉列表里的「翻译/定价」(仍保留在详情弹框)，只留 转入商品/原页面/删除。
- **转入可覆盖**：`_transfer_build_and_save` 按 `source_pool_id` 查已转入商品→覆盖更新内容(标题/描述/变体/SKU/图片/SEO/价格/状态=draft)，保留 vendor/类型/标签/合集；否则新建。列表已转入行按钮显示「重新转入」并提示覆盖。

## 后台 UI 改造 — Vben 风格 (2026-06-12)
- **可收缩侧边栏**：`Layout` 顶栏 `«/»` 折叠，折叠态只剩图标(title 提示)；用 CSS 变量 `--sidebar-w`(220/62) 同时驱动 sidebar 宽和 main-content 边距；状态存 localStorage。
- **顶部多标签页**：`lib/tabs.ts`(localStorage + `tabs-change` 事件) + Layout 内 TabsBar；按路由 openTab，可切换/关闭/高亮。**商品详情改独立路由** `/products/[id]`(+`/products/new`)，支持同时开多个商品 tab；编辑器抽成 `components/ProductEditor.tsx`(自加载 collections，`onLoaded` 回填 tab 标题)。
- **右上角用户区**：顶栏右侧头像+邮箱下拉(个人中心/退出)，原侧边栏退出入口移走；新增 `/profile` 个人中心页(邮箱/昵称/角色/团队/套餐)。
- **tab 拖拽排序**：HTML5 DnD(draggable+onDragStart/Over/Drop)重排 tabs，目标位蓝色高亮，`setTabs` 持久化到 localStorage。
- **tab 右键菜单**：关闭其他/左侧/右侧/全部(边界禁用)，`applyTabs` 关后自动导航到保留 tab(全部关→/product-pool)。
- 商品列表改为路由跳转(点行/编辑/添加商品 → `/products/[id]`/`/products/new`)，去掉内联编辑态。验证：tsc 全量通过(沙箱 next dev 运行时测试受限未跑)。纯前端，next dev 热更新/重启即可。

## 修复 (2026-06-12 下午)
- **转入队列页全 0 / 看不到任务**：路由顺序 bug——`GET /products/transfer-jobs` 被 `GET /products/{product_id}` 动态路由抢占(transfer-jobs 被当成 product_id→404)。修复：把 `list_transfer_jobs` 移到 `/{product_id}` 之前注册。
- **中断任务恢复**：重启会中断 worker 留下 running/pending 卡住。`resume_pending_jobs()`(main startup 调用)把 running→pending 并 `_ensure_worker()` 继续处理。

## 图片增强 (2026-06-12)
- **抓图统一 800x800**：`content.js` `normalizeImg` 取原图基址后追加 `_800x800.jpg`(阿里 CDN 按比例缩放)，替代原「去后缀取原图」。例 `_250x250.jpg`→`_800x800.jpg`。需刷新扩展+重抓。
- **编辑器图片多选批量删除**：媒体区每图勾选框+全选+「批量删除/清除选择」，选中蓝色高亮。

## V1 已完成模块 (保留记录)

### 后端 API

| 模块 | 状态 |
|------|:--:|
| 认证 (JWT 7天 + bcrypt) | ✅ |
| RBAC 3级 (super_admin/manager/member) | ✅ |
| 团队 CRUD + 成员管理 | ✅ |
| 店铺绑定 | ✅ |
| 导入任务 (管道编排) | ✅ |
| 定价规则 (阶梯+尾数) | ✅ |
| 订阅套餐 + 配额规则 | ✅ |
| AI 提供商 (多厂商, 模型拉取) | ✅ |
| 审计日志 + 在线监控 | ✅ |

### 前端管理后台

| 页面 | 状态 |
|------|:--:|
| 登录/注册 (含扩展token回传) | ✅ |
| 选品池 (V2新增) | ✅ |
| 团队总览 / 用户管理 / 在线监控 | ✅ |
| 订阅套餐 / 配额规则 / AI 提供商 | ✅ |
| 审计日志 / 商品管理 / 导入任务 | ✅ |
| 店铺管理 / 定价规则 / 团队成员 | ✅ |

## 技术备忘

- SQLite BigInt autoincrement 不兼容 → 用 Integer
- bcrypt + passlib 冲突 → 直接用 bcrypt
- FastAPI 权限检查用 Depends(PermissionChecker) 不用装饰器
- SQLAlchemy 双向 FK 需显式 foreign_keys
- Next.js 数据页需 export const dynamic = "force-dynamic"
- SQLite 存的时间无时区 → 返回时加 +00:00 后缀
- GLM 没有 /models API → 硬编码模型列表
- 管理后台 UI 极紧凑风格 (padding ≤8px)
- Chrome MV3: host_permissions 不支持 *://localhost → 用显式协议
- Chrome MV3: CSP 禁止 onclick → 用 addEventListener
- 扩展跨上下文传消息不可靠 → popup 用 scripting.executeScript 直接读 tab 的 localStorage
- threading.Thread + asyncio.run() 时函数不能是 async def → 返回 coroutine 不执行
- Chrome MV3 侧边栏：设 `side_panel.default_path` 且**移除** `action.default_popup`，否则点图标仍弹 popup；点图标打开需 `sidePanel.setPanelBehavior({openPanelOnActionClick:true})`
- 抓取报 `Receiving end does not exist`：内容脚本靠 `content_scripts` 声明注入，扩展重载后/页面早于扩展打开的旧标签页里没有该脚本 → `sendMessage` 失败时用 `scripting.executeScript({files:["content.js"]})` 按需注入再重试 (`popup.js` `sendScrape()`)

---

## 2026-06-15/16 大版本（安全加固 + 后台重构 + SPU/SKU + 素材库）

> 本次会话基于一轮三模块（backend/admin/extension）全量代码审计（结论见 `docs/WORK_PLAN.md`，定位 47 项问题），按优先级修复并新增多项功能。所有改动均通过后端 `python -m compileall app` + 前端 `tsc --noEmit` 验证；关键逻辑用隔离单测核验。

### A. 安全与数据正确性（Sprint 1，9 项，详见 EXECUTION_LOG.md）
- **配额校验失效**：`core/permissions.py` 用错主键（`team.plan_id` 当成 QuotaRule 主键）→ 改 `SubscriptionPlan.quota_rule`；`date_trunc`（SQLite 不支持）改为 Python 端算本月首日。
- **`/media` 路径遍历**：`api/v1/router.py` 文件名白名单正则 + `resolve()` 越界校验。
- **fetch-models SSRF + 密钥外泄**：`api/v1/admin.py` 加权限校验 + 内网/保留地址拦截 + 空 key 仅在同源时回填。
- **选品池入库 IDOR**：`product_pool.py` 忽略请求体 `team_id`，统一用当前用户团队。
- **存储型 XSS**：新增 `admin/src/lib/sanitize.ts`（无依赖净化器），净化选品池详情里抓取描述/翻译描述的 `dangerouslySetInnerHTML`。
- **JWT 黑名单未接入**：`dependencies.py` 在 `get_current_user` 校验 `jti` 黑名单（踢人下线生效）。
- **role 越权**：`admin.py` add/update member 校验 `role ∈ {member,manager}`。
- **凭据明文 + 弱密钥 + CORS**：新增 `core/crypto.py`（Fernet 对称加密，向后兼容历史明文），店铺 token / AI key 写时加密读时解密；`config.py` `DEBUG` 默认 False + 启动守卫（非 DEBUG 用默认 SECRET_KEY 拒启动）；CORS 改 `allow_origin_regex` 正确匹配 `chrome-extension://`。
- **本地配置**：新增 `backend/.env`（DEBUG=true + 强 SECRET_KEY + CREDENTIAL_ENCRYPTION_KEY，保证本地启动）与 `backend/.env.example`。
  - ⚠️ 注意：新增 env 变量必须在 `Settings` 里声明字段（否则 pydantic `extra=forbid` 启动崩溃）；已加 `CREDENTIAL_ENCRYPTION_KEY` 字段 + `extra="ignore"` 兜底。

### B. 稳定性（Sprint 2，13 项）
- offerId 去重并发竞态（捕获 IntegrityError 转更新）、图片下载静默失败（失败 `public_url=None` 不再把防盗链 URL 当成功）、import status 团队隔离、邀请过期校验、前端列表后发先至竞态（请求序号 + 防抖，去掉 `setTimeout(load,50)` 黑客）、401 刷新缺口、login `useSearchParams` 包 Suspense、错误 toast（新增 `lib/toast.ts`）、异步按钮防重复、插件 tab 级抓取锁、插件 401 重登。

### C. 后台任务重构（S2-1 / S2-3）—— 关键架构变更
- **问题**：原「每任务一线程 + `asyncio.run` 新事件循环 + 新连接」→ SQLite 写锁争用、进程重启丢任务、转入 worker 布尔锁多进程不安全。
- **方案**：新增 `app/core/worker.py` —— 单个常驻 in-loop async worker，运行在主事件循环，**串行**处理任务；任务持久化在 DB（`TransferJob` 转入、`TaskLog` 翻译/定价、`Material` 素材描述）；**原子认领**（`UPDATE ... WHERE status='pending'` + rowcount 检查）保证多进程不重复处理。`notify()` 唤醒 + 空闲轮询兜底；启动时 `resume_interrupted()` 重置中断任务。
- **改造点**：`product_pool.py` 翻译/定价改为 `process_translation_log(db,log)`/`process_pricing_log(db,log)`，端点只入队 pending TaskLog + notify；`products.py` 删除线程 worker、`resume_pending_jobs` 委托 worker；`imports.py` 直跑模式改 `asyncio.create_task`。
- **验证**：stdlib sqlite3 并发实测——8 worker 抢 100 任务，各认领恰好一次、零重复。
- **多进程注意**：`resume_interrupted` 的 running→pending 重置在单进程/开发安全；多进程需改心跳/租约（已在注释标注）。

### D. SPU 款号功能
- `Product` 新增 `spu` / `spu_code` 列（`db_migrate.py` 幂等补列）。
- **生成规则**：规则代码 + 5 位自增序号，**按代码分别续号**（取该 team 同 code 已有 SPU 末尾数字 max+1），如 `MK00001`、`MK00002`。
- **生成时机**：转入时按 SPU 规则生成（重复转入沿用已有、稳定不变）；商品编辑页右侧「SPU 款号」卡片可选规则 + 「生成」按钮（从零新建也能用）+ 可手动覆盖。端点 `POST /products/generate-spu`（预览不落库）。
- **回显**：选品池列表/详情查出已转入商品的 SPU 并显示「SPU」列；商品列表加「SPU」列。

### E. SKU 规则 = SPU + 规格
- 转入时 SKU 前缀由「规则代码」改为「完整 SPU」，如 `MO00001-PINKBUBBLEFISH-66CM`（先在建变体前确定 product_spu）。
- 编辑页：生成/更换 SPU、或增删改规格时自动重算变体 SKU；变体区加「🔄 生成 SKU 款号」按钮手动刷新（`skuFor` 与后端拼接规则一致，已对拍验证）。

### F. 素材库（新模块）
- **数据**：新增 `Material` 表（team/product/source_pool、spu 必填、sku 可空、image_url、description、status pending|running|done|failed、error、position）；`db_migrate.py` 建表。
- **生成**：转入时按商品图生成素材行（覆盖该商品旧素材）。**每张图必绑 SPU**；选品池 SKU 自带的图 → 按规格匹配绑定变体 SKU，其余图廊图仅绑 SPU；按图片基址（去 `_NxN` 尺寸后缀/查询串）去重。
- **AI 描述**：后台 worker 异步认领 pending 素材，调 **GLM-4.7-FlashX 识图**生成中文描述（`services/material_service.py`，vision 优先回退 text，模型名 `glm-4.7-flashx`）。失败标 failed + 错误，可重试。
- **API**：`api/v1/materials.py` —— `GET /materials`（筛选/分页/状态计数）、`PUT /materials/{id}`（手改描述）、`POST /materials/{id}/regenerate`。
- **前端**：新增 `/materials` 页（缩略图灯箱 / SPU / SKU / 描述 / 状态 / 重新生成 / 编辑；搜索 + 状态筛选 + 分页；待生成时每 3s 轮询刷新）；Layout 菜单加「🖼️ 素材库」。
- **前提**：依赖已配置可用的 GLM 提供商（`/ai-providers`）；模型名 `glm-4.7-flashx` 写死（可后续做成可配置）。

### G. 转入图片过滤 <600×600
- 新增 `services/image_size.py`：**无依赖**图片尺寸探测——流式抓取每图前若干 KB，从字节头解析宽高（JPEG/PNG/WebP/GIF），用 1688 防盗链请求头；并发 8 + 8s 超时。
- 转入时（`_transfer_build_and_save`）对商品图 + SKU 图统一过滤：**宽或高 < 600 的丢弃**；探测失败/异常默认保留（不误删），整体包 try 不阻断转入。
- 商品图廊与素材库都只保留达标图。
- **验证**：四格式构造样本解析正确；过滤规则（600×600 留、599×800/800×400 删）通过。

### H. 交互优化（UX）
- **选品池 + 商品列表复选框**：整格大点击区（`<label>` 撑满 + minHeight 44）+ 16px 复选框 + 选中行淡紫底；批量操作条改**固定浮动条**（`position:fixed` 底部居中 + 滑入动画），不再挤动表格。
- **多标签页关闭「×」**：改 18px 圆形按钮 + 悬停高亮 + `onMouseDown` 阻止拖拽，易点不误触。
- **列表排序/时间**：选品池与商品列表均 `updated_at` 倒序，选品池时间列改显「更新时间」。
- **商品详情页**：加「🔗 原 1688 页面」按钮（`get_product` 顺 source_pool_id 查出 `source_url`）。

### 验证 / 部署备忘
- 工具链：后端 `python -m compileall app`；前端 `admin/node_modules/.bin/tsc --noEmit`；插件 `node --check`。
- 冒烟脚本：`backend/scripts/smoke_test.py`（无依赖，跑安全检查 + worker 存活；可带 `SMOKE_EMAIL/SMOKE_PASSWORD`）。
- **本批需重启后端**（新表迁移 + 新路由 + 转入/worker 逻辑）：`./restart.sh` 后看 `logs/backend.log` 有 `Application startup complete` + `background worker started`、无 Traceback。
- 旧数据：SPU/SKU/素材只在「转入/重新转入」时生成；已存在商品需重新转入或在编辑页手动生成。

### 技术备忘（本次新增）
- pydantic-settings：`.env` 里出现未声明字段会因 `extra=forbid` 启动崩溃 → 要么声明字段，要么 `class Config: extra="ignore"`。
- 沙箱无 Pillow/网络 → 图片尺寸用纯字节头解析（JPEG 扫 SOF 标记、PNG IHDR、GIF 头、WebP VP8/VP8L/VP8X）。
- 阿里 CDN `_800x800` 是按比例缩放且不放大 → 抓该版图测实际像素即代表最终用图尺寸。
- DB 原子认领：`UPDATE ... WHERE id=:id AND status='pending'` 检查 `rowcount==1` 即单赢家，跨进程安全（替代进程内布尔锁）。
- 调用指定 AI 模型：`ProviderRouter.call(db, prompt, images=[...], model="glm-4.7-flashx")`，model 覆盖 provider 默认；vision 传 images。

---

## 2026-06-16（下午）插件收敛 + 抓取重构（S3-4 / S3-5 / S3-6）

> 对应 `docs/WORK_PLAN.md` 的 S3-4、S3-5、S3-6。

### S3-4 插件收敛为单一可发布实现 + 可配置域名
- **删除两套实现并存的死代码**：`extension/src/`（Plasmo+React 脚手架）、`popup.tsx`、`login-bridge.js`（从未在 manifest 注册）、`tsconfig.json`、`assets/`、`.github/workflows/submit.yml`（PlasmoHQ bpp 部署）、`.prettierrc.mjs`。`package.json` 去掉 plasmo 构建脚本/依赖（保留 `npm run check` = node --check）。现在是**纯手写、免构建**扩展（加载未打包目录即用）。
- **可配置后端域名（默认 localhost）**：新增 `extension/config.js`（SW 用 `importScripts`、侧边栏用 `<script>` 共用），`getConfig()/getApiUrl()/getAdminUrl()` 从 `chrome.storage.local` 读 `apiBase`/`adminBase`，缺省回退 `http://localhost:8000` / `http://localhost:3000`。
- **侧边栏设置面板**：popup 头部加「⚙」按钮 → 输入后端/后台地址保存。`background.js`/`popup.js` 去掉写死的 `const API/ADMIN`，改运行时从 config 读取；`extractTokenFromAdminTab` 改用配置的后台地址匹配标签页。
- **运行时主机权限**：manifest 加 `optional_host_permissions: ["http://*/*","https://*/*"]`，保存自定义域名时 `chrome.permissions.request({origins})` 按需申请（localhost 默认已在 host_permissions，免提示）。保留 localhost 默认便于前期测试。
- **token 桥接保持不变**：admin 登录后把 token 存 `localStorage["token"]`，侧边栏 `extractTokenFromAdminTab()`（scripting 读取）仍是活跃路径；删掉的 login-bridge 是冗余的 push 式轮询。

### S3-5 抓取重构：解析内嵌 offer JSON 还原精确 SKU 矩阵
- `content.js` 新增内嵌数据解析（DOM 启发式降级为兜底）：`collectDataCandidates()`（扫 `window.__INIT_DATA__/__GLOBAL_DATA/runParams…` 全局 + 含 `skuProps/skuInfoMap` 的 inline `<script>`）→ `findSkuModel()` 深搜含 `skuProps`+sku 信息映射的节点 → `buildSkusFromModel()` 构建**颜色×尺码完整笛卡尔** SKU，各 SKU 带**自身价格/库存/图片**。
- 兼容多种数据形态：`skuProps` 的 `prop/propName/name` + `value/propValues/values`；`skuInfoMap`（键如 `颜色:红&gt;尺码:M`）或 `skuInfoList`（`specAttrs`）；库存别名 `canBookCount/saleableQuantity/quantity/amountOnSale…`；价格区间取最低。
- **DOM 兜底也修了「只取第一组」**：`extractSpecs()` 的所有规格组改 `cartesian()` 笛卡尔积（上限 200），不再丢弃尺码维度。

### S3-6 推荐区图片过滤（结构化，不再依赖关键词/坐标）
- 主图优先取**内嵌 offer 主图数组**（`findOfferImages()` 深搜 `images/offerImgList/mainImageList…`，最干净、零推荐污染）。
- 详情图改**结构化圈定**：`findDetailRoot()`（从 description 评分逻辑抽出）选出图文详情容器，只收该子树内的 `<img>` → 容器外的推荐/相关商品图天然排除。
- `collectImages(embeddedGallery, detailRoot)` 优先用上述两源；二者皆空才退回全页启发式 `collectImagesFallback()`（保留旧关键词边界，并新增「无边界 + `naturalWidth===0` 未加载占位 → 保守剔除」防推荐占位混入）。

### 验证
- `node --check` 全部通过；`extension/test_scrape.js`（vm 沙箱加载 content.js + DOM 桩）**29 条断言全过**：parseSpecKey / parsePriceNum / cartesian / buildSkusFromModel（keyed map、list specAttrs、仅 props 笛卡尔兜底、库存别名、按色取图）/ findSkuModel 深层嵌套 / findOfferImages 取最长+滤图标 / extractJsonObjects 平衡括号提取。
- ⚠️ **未做浏览器实测**：设置面板交互、真实 1688 页 DOM 抓取与 token 桥接需在 `chrome://extensions` 重载后人工验证（解析逻辑已单测，DOM 依赖部分无法在此环境跑）。

### 技术备忘（本次新增）
- MV3 支持用户自定义域名：`optional_host_permissions` 声明宽匹配（`http(s)://*/*`），运行时 `chrome.permissions.request` 按需申请具体源；`request` 须在用户手势内调用（首个 await 即 request，保住手势）。
- SW 与侧边栏共享代码：侧边栏 `<script src="config.js">` 先于 popup.js 加载；**SW 不要用 `importScripts`**（曾报 `NetworkError: failed to load`，不稳定）→ background.js 自包含内联所需逻辑。
- 从内嵌 offer JSON 还原 SKU 远比 DOM 启发式可靠（混淆类名/动态渲染）；解析器对多形态字段做容错，DOM 仅兜底。

---

## 2026-06-17 抓取实战修复：1688「od-pc」新版页面（Shadow DOM + iframe + mtop API）

> 真实页面（`detail.1688.com/offer/*.html`）已是新版「od-pc」模块化 Vue 架构，原 DOM 抓取大面积失效：抓回评价图、丢了商品详情长图。经在真实页面逐步取证定位三大根因并修复。

### 根因（实测取证）
1. **图文详情长图在 Shadow DOM 里**：详情图渲染在 `v-detail-b.html-description` 的 **open shadow root** 内（`div#detail` → `<img ...cib.jpg loading=lazy>`），普通 `querySelectorAll("img")` 进不去 → 全漏。
2. **SKU/价格在跨域 iframe**：`air.1688.com/.../sku-panel.html?offerId=...`，content script 读不到。
3. **数据走 mtop API（jsonp）**：`mtop.1688.mmga.offerdetail.service`，且是**多路复用**接口——靠 `mmgaRequest.serviceName` 区分（证书/详情/SKU/描述各一个 serviceName，页面调 N 次）。
4. **抓回评价图**：旧 `findDetailRoot` 评分选中了 `evaluation-content`（"evaluation" 不在排除词里）。

### 修复
- **穿透 Shadow DOM 取详情图**（`content.js` `collectShadowImages()`）：递归遍历所有 open `shadowRoot` 收 `<img>`（src 即可读，无需可见）。**这是详情长图的主来源**（实测某商品取到 26 张）。
- **主图廊**：`collectGalleryImages()` 取 `[class*=gallery]` 容器内图（od-gallery-preview，渲染宽≥120）。
- **API 拦截**（`inject.js`，world:MAIN + document_start）：包裹 `window.mtop.request` + 钩 jsonp `<script>` 注入/回调 + fetch/XHR，**按 serviceName 累积**所有 `offerdetail` 响应写入桥接 `<script id=__dsf_offer_data>`；`content.js` 跨所有响应深扫补充图片/SKU。`waitInterceptStable()` 等桥接 JSON 稳定再抓（条件等待，非固定延时）。
- **图片过滤**（`isReviewOrThumb`）：评价图 `-rate.jpg`、SKU 色块 `_sum.jpg`、评价头像 `/ibank/年/目/目/id_id.jpg`、**平台推广图 `!!0-*-cib.jpg`（会员id=0=铺货分销等插件横幅）**；`review` 用边界匹配避免误杀 `od-gallery-preview`。
- 三源合并去重：主图廊 + Shadow 详情 + API；实测某商品 42→约30 张干净商品图（含详情长图，无评价/头像/色块/推广横幅）。

### 验证
- `node --check` 全过；`test_scrape.js` **42 断言全过**（新增 isReviewOrThumb 各过滤分支：-rate/_sum/头像/!!0-/真实图不误杀）。
- 真实页面逐项取证确认：shadow 取图 26 张、桥接累积 24 payloads、平台图 `!!0-0-cib` 识别正确。

### 技术备忘
- od-pc 详情图在 **open Shadow DOM** → 取图必须递归 `el.shadowRoot`（closed 则只能靠 API）。
- 1688 图片 URL 会员 id 语义：`..._!!{memberId}-{n}-cib.jpg`，**memberId=0 = 平台/插件图（非商品）**；`-rate.jpg`=评价图、`_sum.jpg`=SKU色块、`/ibank/YYYY/n/n/id_id.jpg`=用户头像。
- `mtop.1688.mmga.offerdetail.service` 是多路复用：需 `data.mmgaRequest.serviceName`；主动构造调用易报 `UNKNOWN_FAIL_CODE`（缺业务字段），**被动拦截页面自身响应**更稳。
- 拦截 jsonp：包裹 `window.mtop.request` 或钩 `<script>` 注入并包裹其全局回调（fetch/XHR 钩不到 jsonp）。

---

## 2026-06-17 修复：素材库 AI 识图全部卡在「生成中」

> 现象：素材库 21 条全卡 `running`（生成中），已生成/待生成/失败均 0，AI 描述一直不出。

### 根因（系统排查：DB 状态 + 隔离复现 AI 调用 + 完整堆栈）
两个独立 bug 叠加：
1. **AI 调用全失败（400/401）**：`material_service.py` 写死 `model="glm-4.7-flashx"`，覆盖各 provider 自己的 `default_model`；该模型已下线 → GLM 返回 **400**（个别 provider key 失效是 401，但 router 本可降级）。
2. **失败没落库 → 永远卡 running（"卡住"真凶）**：`worker.py` 三个 `_process_*` 的 except 分支 `await db.get(X, obj.id)`——`db.rollback()` 后 ORM 对象属性已过期，访问 `obj.id` 触发**同步惰性重载**，在 async SQLAlchemy 下抛错 → except 没能写成 `failed` → 素材停在 `running`，而 worker 只认领 `pending` 故永不再碰它（也解释了串行 worker 为何能堆出 21 个 running：每次认领后 except 失败、状态留 running）。

### 修复
- `services/material_service.py`：去掉写死模型，`router.call(db, prompt, images=[url])` 用各 provider 的 `default_model`。
- `core/worker.py`：`_process_material` / `_process_transfer` / `_process_pool_task` 均在 try **之前**把主键存普通变量（`mat_id`/`job_id`/`log_id`），except 里用它 `db.get`，不再访问过期 ORM 属性。**附带修了转入/翻译/定价任务同样的卡死隐患。**

### 验证
- 隔离调用 `generate_material_description` → ✅ 正常出中文描述（vision `glm-5v-turbo`）。
- `./restart.sh` 后 `resume_interrupted` 把 21 个 running 重置为 pending，修好的 worker 逐个处理：`done` 稳步增长、**0 failed**、**始终仅 1 个 running**（串行正确）；每条约 10-13s。

### 技术备忘
- **SQLAlchemy async 陷阱**：`await db.rollback()` 会过期会话内所有 ORM 实例属性；之后再访问其属性（含 `.id`）会触发同步惰性重载并抛错。except 里要落库失败状态，须**提前缓存主键**，或用一开始就 detach 的纯值。
- 调 AI **不要写死模型名**：模型会下线/改名，写死会让所有 provider 一起 400。用 provider 配置的 `default_model`，让 router 跨 provider 降级。
- 后台任务「卡 running 不动」排查套路：先查 DB 各状态计数 → 把 1 个置回 pending 看 worker 是否处理 → 隔离复现处理函数拿真实错误 → 看完整堆栈的「During handling」二次异常。

---

## 2026-06-17 Shopify 店铺接入 + 上下架 + 店铺管理增强

> 设计稿：`docs/plans/2026-06-17-shopify-oauth-design.md`。链路打通：抓取 → 选品池 → 转入商品 → 授权店铺 → 上架/下架到真实 Shopify。

### A. OAuth 授权接入（配置存 DB、超管后台管理）
- 平台侧一个 Partner App，各团队对自己店铺授权。`integrations/shopify/oauth.py`：`normalize_shop`（handle/完整域名/`admin.shopify.com/store/<handle>` 后台地址都认）、`sign_state`/`verify_state`（SECRET_KEY 签短期 JWT 做 CSRF + 带 team/user，无需服务端存）、`verify_hmac`、`build_install_url`、`exchange_code`。
- **配置改 DB 管理**（用户决策，比改 .env + 重启友好；env 仅兜底）：新表 `platform_settings`（secret 加密存、对外掩码）+ `services/platform_settings_service.py`（DB 优先 env 兜底、空 secret 不覆盖）+ `admin.py` `GET/PUT /admin/platform-settings`（超管）+ 前端 `/platform-settings` 页（超管菜单「⚙️ 平台设置」，填 key/secret/scopes/公网地址，显示要粘进 Partner app 的回调地址）。
- `shops.py`：`GET /shops/oauth/install`（返回授权 URL）、`GET /shops/oauth/callback`（验 hmac+state→换 token→upsert 店铺→跳回后台，鉴权靠 state 不靠 JWT）。前端 `/shops` 加「🔗 连接 Shopify（授权）」+ 回调结果横幅。

### B. 上下架打通（§3）
- `shopify_product_service.sync_to_shopify`：**去掉无凭证造假 shopify_id**——无 token 明确 `raise`（前端弹「未连接店铺」），不再伪成功；有 token 才真实推送（创建走全量 payload，更新走主字段+status）。
- `products.py` publish(active)/unpublish(draft)/sync 捕获 `RuntimeError`→`HTTPException(400)`，前端商品页已 `alert` 展示。
- **未做（后续）**：变体价格/库存/图片增量更新 + `shopify_variant_id` 回填。

### C. 店铺管理增强
- **连接状态定时刷新**：`shops` 加 `conn_status/conn_checked_at/conn_error` 列（幂等迁移）；`POST /shops/refresh-status` 并发检测全团队店铺（调 `shop.json`）落库；`list_shops` 带状态。前端店铺页加「连接状态」列（✅在线/❌失效[悬停看错误]/⏳待检测 + 检测时间），**每 30s 自动刷新** + 手动「🔄 刷新状态」+ 每行「检测」。
- **编辑 / 删除**：`PUT /shops/{id}`（改别名/handle/名/正式域名/标签/Token/启用；域名查重；**改域名或 Token 自动重置连接状态待检测**）、`DELETE /shops/{id}`。前端操作列加 编辑（弹框预填、Token 留空不改、启用开关）/ 删除（二次确认）。
- **handle 自动补全**：连接/绑定/编辑三处只填 handle（如 `dshopflow`），代码补 `.myshopify.com`；后端 `create_shop`/`update_shop` 先 `normalize_shop` 再存。

### 验证 / 备忘
- 后端编译 + oauth/平台设置服务联动单测全过（加密/掩码/空不覆盖/callback_url/install_url/normalize_shop 各形态）；迁移建表与加列正常、路由注册（401）；前端 tsc 通过。
- **改「平台设置」配置无需重启**（每请求读 DB）；仅改 `backend/` 代码才 `./restart.sh`。
- OAuth 联调需后端公网回调（开发用 cloudflared/ngrok 把 :8000 暴露成 https，地址填进「平台设置」+ Partner app 的 Allowed redirection URL，需逐字一致）。
- 真实上架待验证项：商品图是 1688 alicdn 链接，Shopify 服务端拉图可能被防盗链拦 → 若中招需先把图转存自有图床再给 Shopify。
