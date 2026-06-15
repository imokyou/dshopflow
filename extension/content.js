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

// 抓取整页所有商品图（主图廊 + 详情描述图），过滤图标/小图/底部推荐图，去重
function collectImages() {
  const seen = new Set()
  const result = []
  const boundaryY = recommendBoundaryY()  // 此线以下的图片排除
  // el: 对应的 <img>，用于读真实渲染尺寸过滤图标 + 位置过滤
  const consider = (raw, el) => {
    if (!raw) return
    let u = raw.trim()
    if (!u || u.startsWith("data:")) return
    if (u.startsWith("//")) u = "https:" + u
    if (!/alicdn\.com/i.test(u)) return                    // 只要阿里 CDN 图
    if (isIconUrl(u)) return                               // 平台/分享/UI 图标
    const sz = u.match(/_(\d+)x(\d+)/)                     // URL 里的尺寸提示
    if (sz && Math.max(+sz[1], +sz[2]) < 100) return
    if (el) {
      const w = el.naturalWidth || 0, h = el.naturalHeight || 0
      if (w > 0 && (w < 100 || h < 100)) return            // 真实小图 → 图标
      if (boundaryY < Infinity) {                          // 位于底部推荐/声明区 → 排除
        const y = el.getBoundingClientRect().top + window.scrollY
        if (y >= boundaryY) return
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

// 抓取「商品详情/图文详情」内容（文字 + 图片）
function extractDescription() {
  const cands = document.querySelectorAll(
    "[class*='desc' i],[class*='detail' i],[id*='desc' i],[id*='detail' i],[class*='offerDetail' i],[class*='content' i]"
  )
  // 排除评价/推荐/问答等非商品详情容器
  const EXCLUDE = /comment|review|rate|feedback|评价|热门推荐|recommend|guess|猜你喜欢|相关推荐|问大家|qa|footer|header|nav/i
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
  if (best && bestScore > 100) return cleanDescHtml(best)
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

async function scrape() {
  await waitPageReady()
  await autoScroll()
  await waitImagesSettled()

  const offerId = (location.href.match(/offer\/(\d+)\.html/) || [])[1] || ""

  const priceRange = extractPrice()
  const price = priceNum(priceRange)
  const stock = extractStock()

  // 先尝试老式 SKU 表格（批发阶梯表）
  const skus = []
  document.querySelectorAll(".sku-item, table[class*='sku' i] tr, [class*='sku' i] tr").forEach(row => {
    const cells = row.querySelectorAll("td, .spec-name, .spec-price, .spec-stock")
    if (cells.length >= 2) {
      const sp = cells[0]?.textContent?.trim() || ""
      const pr = parseFloat((cells[1]?.textContent || "").replace(/[^0-9.]/g, "")) || 0
      if (sp && pr) skus.push({ spec: sp, price: pr, stock: parseInt((cells[2]?.textContent || "").replace(/[^0-9]/g, "")) || stock, image: cells[0]?.querySelector("img")?.src || "" })
    }
  })

  // 表格没抓到 → 用规格标签生成 SKU
  if (skus.length === 0) {
    const groups = extractSpecs()
    const firstGroup = groups[0]
    if (firstGroup && firstGroup.options.length) {
      firstGroup.options.forEach(v => skus.push({ spec: v, price, stock, image: "" }))
    }
  }

  // 仍无 → 单个默认 SKU（至少带上价格和库存）
  if (skus.length === 0) {
    skus.push({ spec: "默认", price, stock, image: "" })
  }

  const videoEl = document.querySelector("video source")

  return {
    title: extractTitle(),
    priceRange,
    images: collectImages(),
    skus,
    attrs: extractAttrs(),
    description: extractDescription(),
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
