// DropShipFlow Content Script — 1688 Product Page Scraper

const CONFIG = {
  selectors: {
    title: ["h1[data-testid='title']", ".offer-title", "h1"],
    price: [".price-range", "[class*='price'] span"],
    images: [".main-image img", "[class*='main-image'] img", "img[src*='cbu01.alicdn.com']"],
    desc: [".desc-content", "[class*='description']"],
    skuContainer: [".sku-item", "table[class*='sku'] tr", "[class*='sku'] tr"],
    video: ["video source"],
  }
}

function extractText(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel)
    if (el && el.textContent.trim()) return el.textContent.trim()
  }
  return ""
}

// 规整图片 URL：取到原图基址后统一加 _800x800.jpg 缩放后缀
// 例: ..._cib.jpg_250x250.jpg → ..._cib.jpg_800x800.jpg
function normalizeImg(url) {
  if (!url) return ""
  let u = url.trim()
  if (u.startsWith("//")) u = "https:" + u
  if (u.startsWith("http://")) u = "https://" + u.slice(7)
  u = u.split("?")[0].split("#")[0]
  // 取到第一个图片扩展名为止的「原图基址」（去掉 _250x250.jpg 之类的缩放后缀）
  const m = u.match(/^(https?:\/\/.*?\.(?:jpg|jpeg|png|webp|gif))/i)
  const base = m ? m[1] : u
  // 阿里 CDN 支持追加尺寸后缀 → 统一取 800x800
  if (/alicdn\.com/i.test(base)) return base + "_800x800.jpg"
  return base
}

// 判断是否平台/分享/UI 图标（非商品图）
function isIconUrl(u) {
  return /gw\.alicdn\.com/i.test(u)                        // 全局 UI 资源 CDN
    || /\/(tfs|tps|sns|ut|tb-|common)\//i.test(u)          // UI/分享/平台资源目录
    || /-(tps|tbs)-\d+-\d+\.(png|jpg|webp)/i.test(u)       // -tps-/-tbs- 平台图标(如 ...-tps-160-160.png)
    || /(logo|icon|sprite|share|qrcode|avatar|placeholder|blank|loading|spacer|pixel|watermark)/i.test(u)
}

// 底部「搭配组货/热门推荐/内容声明…」等非商品详情区块的起始纵坐标
// 这些区块里的图片是别的商品，应排除。返回该边界 Y（绝对文档坐标）。
const RECO_RE = /^(搭配组货|热门推荐|相关推荐|相关商品|猜你喜欢|为你推荐|店铺推荐|店铺热销|本店|看了又看|同款推荐|买家还(看了|买了)|更多商品|内容声明|举报|免责声明|常见问题)/

function recommendBoundaryY() {
  let minY = Infinity
  for (const el of document.querySelectorAll("h1,h2,h3,h4,strong,div,span,p,a")) {
    const t = ownText(el)
    if (t && RECO_RE.test(t)) {
      const y = el.getBoundingClientRect().top + window.scrollY
      if (y > 200 && y < minY) minY = y   // y>200 避开顶部误判
    }
  }
  return minY
}

// 判断是否评价图 / SKU 色块缩略图 / 推荐位等「非商品主图」
// 依据真实页面证据：评价图 URL 含 -rate.jpg 且在 evaluation-content 容器内；
// SKU 色块是 _sum.jpg 小图；推荐/店铺/规格选择等模块容器类名有明显特征。
function isReviewOrThumb(url, el) {
  const u = url || ""
  if (/-rate\.jpg/i.test(u)) return true        // 买家评价图
  if (/_sum\.jpg/i.test(u)) return true         // SKU 选择 swatch 缩略图
  if (/!!0-\d+-cib\.jpg/i.test(u)) return true  // 会员id=0 → 平台/插件推广图(铺货分销/免费福利等横幅)，非商品图
  if (/\/ibank\/\d{4}\/\d+\/\d+\/\d+_\d+\.(?:jpg|jpeg|png|webp)/i.test(u)) return true // 评价头像/用户图(年份/目录/id_id)，非商品 cib 图
  let p = el && el.parentElement
  for (let d = 0; d < 6 && p; d++, p = p.parentElement) {
    const c = (p.className || "").toString().toLowerCase()
    // 注意 review 用边界匹配，否则会误命中 od-gallery-preview（含 "review" 子串）
    if (/evaluat|(?:^|[^a-z])(review|comment|feedback)|sku-filter|sku-sele|recommend|consign|shop-product|shop-nav|sell-point/.test(c)) return true
  }
  return false
}

// od-pc 新版主图廊：商品主图在 [class*=gallery] 容器内（od-gallery-preview，渲染宽 ~580）
function collectGalleryImages() {
  const out = []
  const seen = new Set()
  document.querySelectorAll("[class*='gallery' i] img").forEach(el => {
    let u = el.currentSrc || el.getAttribute("src") || el.getAttribute("data-src") || ""
    u = (u || "").trim()
    if (!u || u.startsWith("data:")) return
    if (u.startsWith("//")) u = "https:" + u
    if (!/alicdn\.com/i.test(u)) return
    if (isIconUrl(u) || isReviewOrThumb(u, el)) return
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0 }
    if (r.width && r.width < 120) return          // 渲染太小 → swatch/缩略，非主图
    const n = normalizeImg(u)
    const k = n.toLowerCase()
    if (n && !seen.has(k)) { seen.add(k); out.push(n) }
  })
  return out
}

// 递归收集所有 open shadow root 里的商品图。
// od-pc 新版「图文详情」长图渲染在 v-detail-b.html-description 的 shadow DOM 内
// （div#detail → <img src=...cib.jpg loading=lazy>），普通 querySelectorAll 进不去。
function collectShadowImages() {
  const out = []
  const seen = new Set()
  const consider = (el) => {
    let u = el.currentSrc || el.getAttribute("src") || el.getAttribute("data-src") ||
      el.getAttribute("data-lazy-src") || el.getAttribute("data-ks-lazyload") || ""
    u = (u || "").trim()
    if (!u || u.startsWith("data:")) return
    if (u.startsWith("//")) u = "https:" + u
    if (!/alicdn\.com/i.test(u)) return
    if (isIconUrl(u) || isReviewOrThumb(u, el)) return
    const sz = u.match(/_(\d+)x(\d+)/)
    if (sz && Math.max(+sz[1], +sz[2]) < 100) return
    const n = normalizeImg(u)
    const k = n.toLowerCase()
    if (n && !seen.has(k)) { seen.add(k); out.push(n) }
  }
  const walk = (root, depth) => {
    if (!root || depth > 8) return
    try { root.querySelectorAll("img").forEach(consider) } catch {}
    try { root.querySelectorAll("*").forEach(e => { if (e.shadowRoot) walk(e.shadowRoot, depth + 1) }) } catch {}
  }
  try { document.querySelectorAll("*").forEach(e => { if (e.shadowRoot) walk(e.shadowRoot, 0) }) } catch {}
  return out
}

// 收集商品图（S3-6）：内嵌 offer 主图 + od-pc 主图廊 + 详情容器子树图；
// 全程剔除评价图/SKU 缩略图/推荐位，皆空时退回全页启发式。
// 注意：od-pc 新版「图文详情」长图非 top-frame <img>（由 Vue 模块渲染），走 API 拦截补全（Step 2）。
function collectImages(embeddedGallery, detailRoot) {
  const seen = new Set()
  const result = []
  const push = norm => {
    if (!norm) return
    const key = norm.toLowerCase()
    if (seen.has(key)) return
    seen.add(key); result.push(norm)
  }
  // 1) 内嵌主图：来自页面 offer JSON，无推荐污染
  for (const u of (embeddedGallery || [])) push(u)

  // 2) od-pc 新版主图廊容器
  for (const u of collectGalleryImages()) push(u)

  // 2.5) Shadow DOM 里的图文详情长图（od-pc：v-detail-b.html-description 的 shadow root）
  for (const u of collectShadowImages()) push(u)

  // 3) 详情容器（旧版图文详情）子树内的图：容器外的推荐/相关商品图天然被排除
  if (detailRoot) {
    detailRoot.querySelectorAll("img").forEach(el => {
      const raw = el.getAttribute("src") || el.getAttribute("data-src") ||
        el.getAttribute("data-lazy-src") || el.getAttribute("data-ks-lazyload") || ""
      let u = (raw || "").trim()
      if (!u || u.startsWith("data:")) return
      if (u.startsWith("//")) u = "https:" + u
      if (!/alicdn\.com/i.test(u)) return
      if (isIconUrl(u) || isReviewOrThumb(u, el)) return
      const sz = u.match(/_(\d+)x(\d+)/)
      if (sz && Math.max(+sz[1], +sz[2]) < 100) return
      const w = el.naturalWidth || 0, h = el.naturalHeight || 0
      if (w > 0 && (w < 100 || h < 100)) return            // 真实小图（容器内允许未加载图，已取 data-src）
      push(normalizeImg(u))
    })
  }

  if (result.length) return result
  return collectImagesFallback()   // 结构化失败 → 全页兜底
}

// 兜底：扫整页 <img>/背景图，靠图标特征 + 底部推荐区边界 + 未加载占位过滤
function collectImagesFallback() {
  const seen = new Set()
  const result = []
  const boundaryY = recommendBoundaryY()  // 此线以下的图片排除（关键词法，可能失效）
  const consider = (raw, el) => {
    if (!raw) return
    let u = raw.trim()
    if (!u || u.startsWith("data:")) return
    if (u.startsWith("//")) u = "https:" + u
    if (!/alicdn\.com/i.test(u)) return                    // 只要阿里 CDN 图
    if (isIconUrl(u) || isReviewOrThumb(u, el)) return     // 平台图标 / 评价图 / SKU 缩略图
    const sz = u.match(/_(\d+)x(\d+)/)                     // URL 里的尺寸提示
    if (sz && Math.max(+sz[1], +sz[2]) < 100) return
    if (el) {
      const w = el.naturalWidth || 0, h = el.naturalHeight || 0
      if (w > 0 && (w < 100 || h < 100)) return            // 真实小图 → 图标
      if (boundaryY < Infinity) {                          // 有边界：位于底部推荐/声明区 → 排除
        const y = el.getBoundingClientRect().top + window.scrollY
        if (y >= boundaryY) return
      } else if (w === 0) {
        return                                             // 无边界可依据 + 图未加载 → 无法确认是商品图，保守剔除推荐占位
      }
    }
    const norm = normalizeImg(u)
    const key = norm.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    result.push(norm)
  }
  document.querySelectorAll("img").forEach(img => {
    consider(img.getAttribute("src"), img)
    consider(img.getAttribute("data-src"), img)
    consider(img.getAttribute("data-lazy-src"), img)
    consider(img.getAttribute("data-ks-lazyload"), img)
    const ss = img.getAttribute("srcset")
    if (ss) ss.split(",").forEach(p => consider(p.trim().split(/\s+/)[0], img))
  })
  // 部分图廊用 background-image
  document.querySelectorAll("[style*='background']").forEach(el => {
    const m = (el.getAttribute("style") || "").match(/url\(["']?([^"')]+)["']?\)/i)
    if (m) consider(m[1], el)
  })
  return result
}

// 判断是否像店铺名而非商品名
function looksLikeShop(t) {
  return /(商行|经营部|商贸|贸易|有限公司|个体|工作室|旗舰店|专营店|专卖店|批发部|服饰厂|制衣厂|店铺|网店|的小店|供应链)/.test(t)
    && t.length < 20
}

// 清洗页面 <title>：去掉站点后缀/【】前缀
function cleanTitle(t) {
  return (t || "")
    .replace(/[\-_|—–]+\s*(阿里巴巴|1688\.com|1688|alibaba).*$/i, "")
    .replace(/^[【\[][^】\]]*[】\]]\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
}

// 提取商品标题：优先页面 title，过滤店铺名，页面候选兜底
function extractTitle() {
  const dt = cleanTitle(document.title)
  if (dt && dt.length >= 6 && !looksLikeShop(dt)) return dt

  const cands = []
  document.querySelectorAll("h1, [class*='title' i], [class*='subject' i]").forEach(el => {
    const t = (el.textContent || "").replace(/\s+/g, " ").trim()
    if (t && t.length >= 6 && t.length <= 120 && !looksLikeShop(t) && !/^[¥￥]|^价格|^\d+(\.\d+)?$/.test(t)) cands.push(t)
  })
  cands.sort((a, b) => b.length - a.length) // 商品标题通常较长、关键词多
  if (cands[0]) return cands[0]

  return dt || extractText(CONFIG.selectors.title)
}

// 元素自身的文本（不含子元素）
function ownText(el) {
  let t = ""
  el.childNodes.forEach(n => { if (n.nodeType === 3) t += n.textContent })
  return t.trim()
}

// 提取主价格（支持区间），返回如 "¥6.80" 或 "¥6.80-¥9.90"
function extractPrice() {
  const parse = txt => {
    const s = (txt || "").replace(/\s+/g, "")
    const m = s.match(/¥?([\d]+(?:\.\d+)?)(?:[-~–至]¥?([\d]+(?:\.\d+)?))?/)
    if (!m) return ""
    return "¥" + m[1] + (m[2] ? "-¥" + m[2] : "")
  }
  // 1) 价格类元素
  for (const el of document.querySelectorAll("[class*='price' i],[class*='Price']")) {
    const t = (el.textContent || "").trim()
    if (/¥|\d/.test(t) && /\d/.test(t)) {
      const p = parse(t)
      if (p) return p
    }
  }
  // 2) 正文中第一个 ¥ 金额
  const bm = (document.body.innerText || "").match(/¥\s*[\d]+(?:\.\d+)?/)
  return bm ? parse(bm[0]) : ""
}

function priceNum(priceRange) {
  const m = (priceRange || "").match(/[\d]+(?:\.\d+)?/)
  return m ? parseFloat(m[0]) : 0
}

// 提取库存数字
function extractStock() {
  const m = (document.body.innerText || "").match(/库存\s*([\d,]+)/)
  return m ? parseInt(m[1].replace(/,/g, "")) || 100 : 100
}

// 从规格标签（颜色/规格/尺码…）附近收集选项，生成规格名列表
function extractSpecs() {
  const labelRe = /^(颜色|颜色分类|规格|尺码|尺寸|款式|型号|材质|套餐|版本|口味|包装)$/
  const bad = /[¥$]|^\d+$|下单|采购|铺货|代发|收藏|包邮|起批|库存|立即|加入|分销|登录|客服|对比|举报|预计|运费|送至/
  const groups = []
  const seen = new Set()
  for (const el of document.querySelectorAll("body *")) {
    const label = ownText(el).replace(/[:：]\s*$/, "")
    if (!label || label.length > 6 || !labelRe.test(label)) continue
    let container = el.parentElement
    for (let up = 0; up < 2 && container; up++, container = container.parentElement) {
      const opts = new Set()
      const add = v => {
        v = (v || "").trim()
        if (!v || v === label || v.length > 24 || bad.test(v)) return
        opts.add(v)
      }
      container.querySelectorAll("[title]").forEach(o => add(o.getAttribute("title")))
      container.querySelectorAll("img[alt]").forEach(o => add(o.getAttribute("alt")))
      if (opts.size > 0 && opts.size <= 60) {
        const arr = [...opts]
        const key = label + ":" + arr.join(",")
        if (!seen.has(key)) { seen.add(key); groups.push({ label, options: arr }) }
        break
      }
    }
  }
  return groups
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// 等待页面整体加载完成（readyState=complete）
async function waitPageReady(maxMs = 10000) {
  const start = Date.now()
  while (document.readyState !== "complete" && Date.now() - start < maxMs) await sleep(150)
  await sleep(400) // 给框架渲染一点缓冲
}

// 逐段滚到底再回顶，触发整页懒加载图片
async function autoScroll(steps = 12) {
  for (let i = 1; i <= steps; i++) {
    window.scrollTo({ top: (document.body.scrollHeight * i) / steps })
    await sleep(350)
  }
  window.scrollTo({ top: 0 })
  await sleep(300)
}

// 等待图片真正加载完（数量稳定或全部 complete，带超时）
async function waitImagesSettled(maxMs = 8000) {
  const start = Date.now()
  let prev = -1
  while (Date.now() - start < maxMs) {
    const imgs = [...document.querySelectorAll("img")]
    const loaded = imgs.filter(im => im.complete && im.naturalWidth > 0).length
    if (imgs.length > 0 && loaded === imgs.length) break // 全部加载完
    if (loaded === prev) break                            // 数量不再增长
    prev = loaded
    await sleep(500)
  }
}

// 等拦截的 offerdetail 数据到齐并稳定（桥接 JSON 长度连续两次不变 → 各 API 响应已到齐）
// 条件等待优于固定延时：数据早到就早走，晚到也能等（最多 maxMs 兜底）
async function waitInterceptStable(maxMs = 8000) {
  const start = Date.now()
  let prevLen = -1, stable = 0
  while (Date.now() - start < maxMs) {
    const el = document.getElementById("__dsf_offer_data")
    const len = el && el.textContent ? el.textContent.length : 0
    if (len > 0 && len === prevLen) { if (++stable >= 2) break } // 连续 2 次不变 → 稳定
    else stable = 0
    prevLen = len
    await sleep(400)
  }
}

// 清洗商品详情 HTML：去脚本/样式，把懒加载图写回 src 并限宽
function cleanDescHtml(node) {
  const clone = node.cloneNode(true)
  clone.querySelectorAll("script,style,noscript,iframe,ins").forEach(e => e.remove())
  clone.querySelectorAll("img").forEach(img => {
    const raw = img.getAttribute("src") || img.getAttribute("data-src") ||
      img.getAttribute("data-lazy-src") || img.getAttribute("data-ks-lazyload") || ""
    const u = normalizeImg(raw)
    if (u) img.setAttribute("src", u)
    ;["data-src", "data-lazy-src", "data-ks-lazyload", "srcset", "loading", "onerror", "onclick"].forEach(a => img.removeAttribute(a))
    img.setAttribute("style", "max-width:100%;height:auto;")
  })
  // 清除内联事件
  clone.querySelectorAll("[onclick],[onmouseover]").forEach(e => { e.removeAttribute("onclick"); e.removeAttribute("onmouseover") })
  return clone.innerHTML.trim()
}

// 选出「图文详情」容器元素（评分最高）。description 抓取与图片收集共用，
// 用它做结构化圈定即可天然排除容器外的推荐/相关商品图。
function findDetailRoot() {
  const cands = document.querySelectorAll(
    "[class*='desc' i],[class*='detail' i],[id*='desc' i],[id*='detail' i],[class*='offerDetail' i],[class*='content' i]"
  )
  // 排除评价/推荐/问答等非商品详情容器（evaluat 命中 od-pc 的 evaluation-content）
  const EXCLUDE = /comment|review|rate|feedback|evaluat|评价|热门推荐|recommend|guess|猜你喜欢|相关推荐|问大家|qa|footer|header|nav|consign|sku-/i
  let best = null, bestScore = 0
  cands.forEach(el => {
    const idcls = `${el.className || ""} ${el.id || ""}`
    if (EXCLUDE.test(idcls)) return
    const txt = (el.textContent || "").trim()
    if (/^(商品评价|用户评价|累计评价|热门推荐|猜你喜欢)/.test(txt)) return
    const len = txt.length
    const imgs = el.querySelectorAll("img").length
    if (len > 30000) return                 // 过大 → 多半是整页容器
    if (len < 20 && imgs === 0) return
    const score = len + imgs * 60
    if (score > bestScore) { bestScore = score; best = el }
  })
  return bestScore > 100 ? best : null
}

// 抓取「商品详情/图文详情」内容（文字 + 图片）
function extractDescription(root) {
  const best = root !== undefined ? root : findDetailRoot()
  if (best) return cleanDescHtml(best)
  // 兜底：旧选择器
  const fb = document.querySelector(".desc-content, [class*='description']")
  return fb ? cleanDescHtml(fb) : ""
}

// 属性表关键词，用于识别"商品属性"表，避开 SKU/价格表
const ATTR_HINT = /(面料|材质|成分|品牌|货号|尺码|尺寸|风格|款式|领型|袖|版型|腰型|裙长|工艺|适用|季节|年份|颜色|流行元素|图案|厚度|弹力|组合形式|货源|领标|吊牌|产地)/

// 抓取商品属性 [{name, value}]
function extractAttrs() {
  const attrs = []
  const seen = new Set()
  const addPair = (k, v) => {
    k = (k || "").replace(/\s+/g, " ").trim().replace(/[:：]\s*$/, "")
    v = (v || "").replace(/\s+/g, " ").trim()
    if (!k || !v || k.length > 24 || v.length > 200 || k === v) return
    if (seen.has(k)) return
    seen.add(k); attrs.push({ name: k, value: v })
  }
  // 1) 表格式属性表（每行可能含多组 label/value）
  for (const table of document.querySelectorAll("table")) {
    const hints = ((table.textContent || "").match(ATTR_HINT) || []).length
    if (hints < 2) continue // 不像属性表
    table.querySelectorAll("tr").forEach(tr => {
      const cells = [...tr.children].map(c => c.textContent)
      for (let i = 0; i + 1 < cells.length; i += 2) addPair(cells[i], cells[i + 1])
    })
  }
  if (attrs.length) return attrs

  // 2) div/列表兜底：找"商品属性"标题后的 label:value
  let head = null
  for (const el of document.querySelectorAll("h1,h2,h3,h4,strong,div,span,p")) {
    if (/^(商品属性|产品属性|产品参数|基本属性|规格参数)$/.test(ownText(el))) { head = el; break }
  }
  if (head) {
    let p = head.parentElement
    for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
      const items = p.querySelectorAll("[class*='item' i], li, dl")
      if (items.length >= 3) {
        items.forEach(it => {
          const m = (it.textContent || "").replace(/\s+/g, " ").trim().match(/^(.{1,20}?)[:：]\s*(.+)$/)
          if (m) addPair(m[1], m[2])
        })
        if (attrs.length) break
      }
    }
  }
  return attrs
}

// ───────────────────────── 内嵌 offer 数据解析（S3-5）─────────────────────────
// 1688 把 SKU 矩阵 / 主图 内嵌在页面 JS 全局或 <script> JSON 里。优先解析它，
// 得到「颜色×尺码」完整笛卡尔 SKU（各含价/库存/图）与干净主图；DOM 启发式仅兜底。

// 收集候选数据对象：已知全局变量 + inline <script> 里的 JSON
function collectDataCandidates() {
  const out = []
  const GLOBALS = ["__INIT_DATA__", "__GLOBAL_DATA", "__AILABS_DATA__", "runParams",
    "detailData", "pageData", "__NEXT_DATA__", "iDetailData", "__detail__"]
  for (const g of GLOBALS) {
    try { const v = window[g]; if (v && typeof v === "object") out.push(v) } catch {}
  }
  for (const s of document.querySelectorAll("script:not([src])")) {
    const txt = s.textContent || ""
    if (txt.length < 40 || txt.length > 3000000) continue
    if (!/skuProp|skuInfoMap|skuModel|skuMap/.test(txt)) continue
    for (const obj of extractJsonObjects(txt)) out.push(obj)
  }
  return out
}

// 从脚本文本提取可能含 sku 数据的 JSON 对象
function extractJsonObjects(txt) {
  const objs = []
  const whole = txt.trim()
  if ((whole[0] === "{" && whole.endsWith("}")) || (whole[0] === "[" && whole.endsWith("]"))) {
    try { objs.push(JSON.parse(whole)); return objs } catch {}
  }
  const KEY = /"(?:skuModel|skuProps|skuInfoMap|skuMap)"\s*:/g
  let m
  while ((m = KEY.exec(txt))) {
    const start = txt.lastIndexOf("{", m.index)
    if (start < 0) continue
    const sub = balancedSlice(txt, start)
    if (sub) { try { objs.push(JSON.parse(sub)) } catch {} }
    if (objs.length > 5) break
  }
  return objs
}

// 从 txt[start]（一个 '{'）起返回平衡到对应 '}' 的子串（正确跳过字符串内的括号/转义）
function balancedSlice(txt, start) {
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < txt.length; i++) {
    const ch = txt[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === "\\") esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === "{") depth++
    else if (ch === "}") { depth--; if (depth === 0) return txt.slice(start, i + 1) }
    if (i - start > 2000000) break
  }
  return null
}

// 深搜：找含 skuProps + sku 信息映射的节点（即 skuModel）
function findSkuModel(roots) {
  const seen = new Set()
  const stack = [...roots]
  let visited = 0
  while (stack.length && visited < 20000) {
    const node = stack.pop()
    if (!node || typeof node !== "object" || seen.has(node)) continue
    seen.add(node); visited++
    const hasProps = Array.isArray(node.skuProps) || Array.isArray(node.skuProp) || Array.isArray(node.props)
    const infoMap = node.skuInfoMap || node.skuInfoList || node.skuMap || node.skus || node.skuList
    if (hasProps && infoMap) return node
    for (const k in node) {
      try { const v = node[k]; if (v && typeof v === "object") stack.push(v) } catch {}
    }
  }
  return null
}

// 规整规格属性 → [{name, values:[{label,image}]}]
function normalizeProps(rawProps) {
  const props = []
  for (const p of (rawProps || [])) {
    if (!p || typeof p !== "object") continue
    const name = String(p.prop || p.propName || p.name || p.text || "").trim()
    const rawVals = p.value || p.propValues || p.values || p.list || []
    const values = []
    for (const v of (Array.isArray(rawVals) ? rawVals : [])) {
      if (v == null) continue
      if (typeof v === "string") { const lb = v.trim(); if (lb) values.push({ label: lb, image: "" }); continue }
      const label = String(v.name || v.value || v.text || v.title || "").trim()
      const image = normalizeImg(v.imageUrl || v.image || v.imageURI || v.picUrl || v.skuImageUrl || "")
      if (label) values.push({ label, image })
    }
    if (name && values.length) props.push({ name, values })
  }
  return props
}

// 把 sku key（"颜色:红色&gt;尺码:M" / "红色>M" / "红色;M"）解析为值标签数组
function parseSpecKey(key) {
  if (!key) return []
  return String(key)
    .replace(/&gt;/gi, ">")
    .split(/[>;&|·]/)
    .map(seg => seg.split(/[:：]/).pop().trim())
    .filter(Boolean)
}

function parsePriceNum(x) {
  if (x == null) return 0
  if (typeof x === "number") return x > 0 ? x : 0
  const m = String(x).match(/\d+(?:\.\d+)?/g)
  if (!m) return 0
  const nums = m.map(parseFloat).filter(n => n > 0)
  return nums.length ? Math.min(...nums) : 0
}

function firstNum(...vals) {
  for (const v of vals) {
    if (v == null) continue
    const n = typeof v === "number" ? v : parseInt(String(v).replace(/[^0-9]/g, ""))
    if (!isNaN(n)) return n
  }
  return null
}

// 笛卡尔积：[[红,蓝],[M,L]] → [[红,M],[红,L],[蓝,M],[蓝,L]]，上限 200 防爆炸
function cartesian(arrays) {
  let res = [[]]
  for (const arr of arrays) {
    const next = []
    for (const combo of res) {
      for (const item of arr) {
        next.push([...combo, item])
        if (next.length >= 200) break
      }
      if (next.length >= 200) break
    }
    res = next
    if (res.length >= 200) break
  }
  return res
}

// 由 skuModel 构建完整 SKU 矩阵 {props, skus}
function buildSkusFromModel(model, fallbackPrice, fallbackStock) {
  const props = normalizeProps(model.skuProps || model.skuProp || model.props)
  const imgByLabel = {}
  for (const p of props) for (const v of p.values) if (v.image && !imgByLabel[v.label]) imgByLabel[v.label] = v.image

  const rawMap = model.skuInfoMap || model.skuMap
  const rawList = model.skuInfoList || model.skus || model.skuList
  const entries = []
  if (rawMap && typeof rawMap === "object" && !Array.isArray(rawMap)) {
    for (const k in rawMap) entries.push({ key: k, info: rawMap[k] })
  } else if (Array.isArray(rawList)) {
    for (const it of rawList) {
      if (!it || typeof it !== "object") continue
      entries.push({ key: String(it.specAttrs || it.specAttr || it.skuAttr || it.attributes || ""), info: it })
    }
  } else if (Array.isArray(rawMap)) {
    for (const it of rawMap) entries.push({ key: String(it?.specAttrs || ""), info: it })
  }

  const skus = []
  const seen = new Set()
  for (const { key, info } of entries) {
    if (!info || typeof info !== "object") continue
    const labels = parseSpecKey(key)
    const spec = labels.length ? labels.join(" / ") : (String(key).trim() || "默认")
    if (seen.has(spec)) continue
    seen.add(spec)
    const price = parsePriceNum(info.price ?? info.discountPrice ?? info.skuPrice ?? info.priceText) || fallbackPrice
    const stock = firstNum(info.canBookCount, info.saleableQuantity, info.quantity, info.amountOnSale, info.stock, info.canSellQuantity)
    let image = normalizeImg(info.imageUrl || info.image || "")
    if (!image) for (const lb of labels) if (imgByLabel[lb]) { image = imgByLabel[lb]; break }
    skus.push({ spec, price, stock: stock == null ? fallbackStock : stock, image })
  }

  // 有规格但无可用 info → 笛卡尔兜底（统一价/库存）
  if (!skus.length && props.length) {
    for (const combo of cartesian(props.map(p => p.values.map(v => v.label)))) {
      const spec = combo.join(" / ")
      let image = ""
      for (const lb of combo) if (imgByLabel[lb]) { image = imgByLabel[lb]; break }
      skus.push({ spec, price: fallbackPrice, stock: fallbackStock, image })
    }
  }
  return { props, skus: skus.slice(0, 200) }
}

function extractImgUrl(v) {
  if (!v) return ""
  if (typeof v === "string") return /alicdn\.com|\.(jpg|jpeg|png|webp)/i.test(v) ? v : ""
  if (typeof v === "object") return v.fullPathImageURI || v.imageURI || v.imageUrl || v.url || v.fullUrl || v.pic || ""
  return ""
}

// 深搜 offer 主图数组（多个候选取最长）
function findOfferImages(roots) {
  const seen = new Set()
  const stack = [...roots]
  let visited = 0
  const IMG_KEY = /^(images|imageList|offerImgList|mainImageList|tfsImages|detailImages|skuImages|pcDetailImages|imgList)$/i
  let best = []
  while (stack.length && visited < 20000) {
    const node = stack.pop()
    if (!node || typeof node !== "object" || seen.has(node)) continue
    seen.add(node); visited++
    if (Array.isArray(node)) { for (const v of node) if (v && typeof v === "object") stack.push(v); continue }
    for (const k in node) {
      let v
      try { v = node[k] } catch { continue }
      if (IMG_KEY.test(k) && Array.isArray(v)) {
        const urls = v.map(extractImgUrl).filter(Boolean)
        if (urls.length > best.length) best = urls
      }
      if (v && typeof v === "object") stack.push(v)
    }
  }
  const out = []
  const dedup = new Set()
  for (const u of best) {
    if (isIconUrl(u)) continue
    const n = normalizeImg(u)
    const key = n.toLowerCase()
    if (n && !dedup.has(key)) { dedup.add(key); out.push(n) }
  }
  return out
}

// 读取主世界注入脚本(inject.js)截获并写入桥接元素的 offerdetail.service 响应
function readInterceptedOffer() {
  try {
    const el = document.getElementById("__dsf_offer_data")
    if (el && el.textContent) return JSON.parse(el.textContent)
  } catch {}
  return null
}

// 深扫数据里所有字符串中的阿里 CDN 图片 URL（捕获详情 HTML 内嵌的长图）
function deepCollectImageUrls(roots) {
  const found = new Set()
  const seen = new Set()
  const stack = [...roots]
  let n = 0
  const RE = /https?:\/\/[^"'\s)\\]*alicdn\.com[^"'\s)\\]*\.(?:jpg|jpeg|png|webp)/gi
  while (stack.length && n < 40000) {
    const node = stack.pop()
    if (node == null) continue
    if (typeof node === "string") {
      const m = node.match(RE)
      if (m) for (const u of m) found.add(u)
      continue
    }
    if (typeof node !== "object" || seen.has(node)) continue
    seen.add(node); n++
    if (Array.isArray(node)) { for (const v of node) stack.push(v); continue }
    for (const k in node) { try { stack.push(node[k]) } catch {} }
  }
  const out = []
  const dd = new Set()
  for (const u of found) {
    if (isIconUrl(u) || isReviewOrThumb(u, null)) continue
    const nm = normalizeImg(u)
    const key = nm.toLowerCase()
    if (nm && !dd.has(key)) { dd.add(key); out.push(nm) }
  }
  return out
}

// 深搜最像「图文详情 HTML」的长字符串（含 <img>/大量 HTML）
function findDescriptionHtml(roots) {
  let best = ""
  const seen = new Set()
  const stack = [...roots]
  let n = 0
  while (stack.length && n < 40000) {
    const node = stack.pop()
    if (node == null) continue
    if (typeof node === "string") {
      if (node.length > best.length && node.length > 200 && node.length < 2000000 && /<img|<div|<p[\s>]/i.test(node)) best = node
      continue
    }
    if (typeof node !== "object" || seen.has(node)) continue
    seen.add(node); n++
    if (Array.isArray(node)) { for (const v of node) stack.push(v); continue }
    for (const k in node) { try { stack.push(node[k]) } catch {} }
  }
  return best
}

// 把详情 HTML 字符串清洗为安全 HTML（复用 cleanDescHtml 的 DOM 清洗）
function cleanDescHtmlString(html) {
  if (!html) return ""
  try {
    const d = document.createElement("div")
    d.innerHTML = html
    return cleanDescHtml(d)
  } catch { return "" }
}

// 汇总内嵌数据解析结果：拦截到的 API 响应优先，DOM 内嵌全局兜底
function extractEmbedded() {
  const candidates = []
  const intercepted = readInterceptedOffer()
  if (intercepted) candidates.push(intercepted)
  try { candidates.push(...collectDataCandidates()) } catch {}

  let model = null, galleryImages = [], descImages = [], descHtml = ""
  try { model = findSkuModel(candidates) } catch {}
  try { galleryImages = findOfferImages(candidates) } catch {}
  try { descImages = intercepted ? deepCollectImageUrls([intercepted]) : [] } catch {}
  try { descHtml = intercepted ? findDescriptionHtml([intercepted]) : "" } catch {}
  return { model, galleryImages, descImages, descHtml, intercepted: !!intercepted }
}

async function scrape() {
  await waitPageReady()
  await autoScroll()
  await waitImagesSettled()
  await waitInterceptStable()   // 等拦截的 offerdetail API 数据到齐（详情长图来源）

  const offerId = (location.href.match(/offer\/(\d+)\.html/) || [])[1] || ""

  const priceRange = extractPrice()
  const price = priceNum(priceRange)
  const stock = extractStock()

  const embedded = extractEmbedded()
  let skus = []
  let options = []

  // 1) 内嵌 offer 数据 → 精确多规格 SKU 矩阵（颜色×尺码 笛卡尔，各含价/库存/图）
  if (embedded.model) {
    try {
      const built = buildSkusFromModel(embedded.model, price, stock)
      skus = built.skus
      options = built.props
    } catch {}
  }

  // 2) 老式 SKU 表格（批发阶梯表）
  if (skus.length === 0) {
    document.querySelectorAll(".sku-item, table[class*='sku' i] tr, [class*='sku' i] tr").forEach(row => {
      const cells = row.querySelectorAll("td, .spec-name, .spec-price, .spec-stock")
      if (cells.length >= 2) {
        const sp = cells[0]?.textContent?.trim() || ""
        const pr = parseFloat((cells[1]?.textContent || "").replace(/[^0-9.]/g, "")) || 0
        if (sp && pr) skus.push({ spec: sp, price: pr, stock: parseInt((cells[2]?.textContent || "").replace(/[^0-9]/g, "")) || stock, image: cells[0]?.querySelector("img")?.src || "" })
      }
    })
  }

  // 3) DOM 规格标签 → 全部规格组笛卡尔积（不再只取第一组）
  if (skus.length === 0) {
    const groups = extractSpecs()
    if (groups.length) {
      for (const combo of cartesian(groups.map(g => g.options))) {
        skus.push({ spec: combo.join(" / "), price, stock, image: "" })
      }
    }
  }

  // 4) 仍无 → 单个默认 SKU（至少带上价格和库存）
  if (skus.length === 0) {
    skus.push({ spec: "默认", price, stock, image: "" })
  }

  // 图片：内嵌主图 + 详情容器图，结构化排除推荐区；皆空才退回全页兜底
  const detailRoot = findDetailRoot()
  const images = collectImages(embedded.galleryImages, detailRoot)
  // 详情长图：od-pc 新版「图文详情」长图不在 DOM 里 → 来自拦截的 offerdetail API（descImages）
  if (embedded.descImages && embedded.descImages.length) {
    const seen = new Set(images.map(u => u.toLowerCase()))
    for (const u of embedded.descImages) {
      const k = u.toLowerCase()
      if (!seen.has(k)) { seen.add(k); images.push(u) }
    }
  }

  // 描述：拦截到的图文详情 HTML 优先（更完整），否则用 DOM 抓取
  let description = extractDescription(detailRoot)
  if (embedded.descHtml) {
    const apiDesc = cleanDescHtmlString(embedded.descHtml)
    if (apiDesc && apiDesc.length > description.length) description = apiDesc
  }

  const videoEl = document.querySelector("video source")

  return {
    title: extractTitle(),
    priceRange,
    images,
    skus,
    options,
    attrs: extractAttrs(),
    description,
    offerId,
    videoUrl: videoEl?.src || null
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SCRAPE") {
    scrape().then(data => sendResponse({ ok: true, data }))
      .catch(e => sendResponse({ ok: false, error: e.message }))
    return true
  }
})
