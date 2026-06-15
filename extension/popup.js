// DropShipFlow Side Panel Logic — V2 选品池
const API = "http://localhost:8000/api/v1"
const ADMIN = "http://localhost:3000"
let userData = null
let token = null


// ── 状态标签映射 ──
const STATUS_MAP = {
  captured:          { label: "已抓取",   bg: "#fef9c3", fg: "#854d0e" },
  translating:       { label: "翻译中",   bg: "#dbeafe", fg: "#1e40af" },
  translated:        { label: "已翻译",   bg: "#dbeafe", fg: "#1e40af" },
  pricing:           { label: "定价中",   bg: "#e0e7ff", fg: "#3730a3" },
  priced:            { label: "已定价",   bg: "#e0e7ff", fg: "#3730a3" },
  images_processing: { label: "修图中",   bg: "#fce7f3", fg: "#9d174d" },
  images_ready:      { label: "图片就绪", bg: "#dcfce7", fg: "#166534" },
  imported:          { label: "已上架",   bg: "#dcfce7", fg: "#166534" },
}
function statusTag(status) {
  const s = STATUS_MAP[status] || { label: status || "—", bg: "#f1f5f9", fg: "#475569" }
  return `<span class="tag" style="background:${s.bg};color:${s.fg}">${escapeHtml(s.label)}</span>`
}

// ── Init ──
document.addEventListener("DOMContentLoaded", async () => {
  await checkAuth()
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local" && (changes.access_token || changes.user)) checkAuth()
  })
})

async function checkAuth() {
  let data = await chrome.storage.local.get(["access_token", "user"])
  if (!data.access_token) data = await extractTokenFromAdminTab()

  if (data.access_token) {
    const valid = await verifyToken(data.access_token)
    if (!valid) {
      await chrome.storage.local.remove(["access_token", "refresh_token", "user"])
      data = {}
    }
  }

  if (data.access_token) {
    token = data.access_token
    userData = data.user
    // 从 /admin/me 拉真实账号（JWT 的 sub 是用户ID，不是邮箱）
    try {
      const me = await apiCall("GET", "/admin/me")
      if (me?.user) {
        userData = { ...userData, ...me.user, team_id: me.user.team_id }
        await chrome.storage.local.set({ user: userData })
      }
    } catch {}
    document.getElementById("userEmail").textContent = userData?.email || userData?.name || "未知账号"
    document.getElementById("headerStatus").textContent = "已连接"
    document.getElementById("footer").classList.remove("hidden")
    document.getElementById("view-logout").classList.add("hidden")
    document.getElementById("main").classList.remove("hidden")
    await updateScrapeHint()
    loadRecent()
  } else {
    document.getElementById("main").classList.add("hidden")
    document.getElementById("footer").classList.add("hidden")
    document.getElementById("headerStatus").textContent = ""
    document.getElementById("view-logout").classList.remove("hidden")
  }
}

async function verifyToken(tok) {
  try {
    const resp = await fetch(API + "/admin/me", { headers: { Authorization: "Bearer " + tok } })
    return resp.ok
  } catch { return false }
}

async function extractTokenFromAdminTab() {
  try {
    const tabs = await chrome.tabs.query({ url: ["http://localhost:3000/*", "http://127.0.0.1:3000/*"] })
    for (const tab of tabs) {
      if (!tab.id) continue
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const token = localStorage.getItem("token")
            const refresh = localStorage.getItem("refresh_token")
            if (!token) return null
            try {
              const payload = JSON.parse(atob(token.split(".")[1]))
              return {
                access_token: token,
                refresh_token: refresh || "",
                user: { email: payload.sub, role: payload.role, team_id: payload.team_id },
              }
            } catch { return null }
          },
        })
        const extracted = results?.[0]?.result
        if (extracted?.access_token) {
          await chrome.storage.local.set(extracted)
          return extracted
        }
      } catch { /* tab not accessible */ }
    }
  } catch {}
  return {}
}

// ── Auth ──
function openLogin() {
  chrome.tabs.create({ url: ADMIN + "/login?source=extension" })
}
async function doLogout() {
  await chrome.storage.local.remove(["access_token", "refresh_token", "user"])
  token = null; userData = null
  checkAuth()
}

// ── 抓取提示：根据当前 tab 是否在 1688 详情页 ──
async function updateScrapeHint() {
  const hint = document.getElementById("idleHint")
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const on1688 = tab?.url && /:\/\/detail\.1688\.com\/offer\/.*\.html/.test(tab.url)
    if (hint) hint.textContent = on1688
      ? "已识别 1688 商品页，点击抓取加入选品池"
      : "请先打开 1688 商品详情页，再点击抓取"
  } catch {}
}

// ── Scrape ──
// 向标签页发消息；若内容脚本未注入（扩展刚重载/页面早于扩展打开），先按需注入再重试
async function sendScrape(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "SCRAPE" })
  } catch (e) {
    // 接收端不存在 → 注入 content.js 后重试
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] })
    return await chrome.tabs.sendMessage(tabId, { type: "SCRAPE" })
  }
}

// ── 后台抓取任务（不阻塞 UI，可同时跑多个）──
let activeJobs = 0
let statusTimer = null

const TOAST_STYLE = {
  success: "background:#dcfce7;color:#166534;border:1px solid #86efac;",
  error: "background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;",
}
// 成功/失败提示条（独立元素，不会被计数刷新覆盖）
function showToast(text, type) {
  const el = document.getElementById("scrapeStatus")
  if (!el) return
  el.textContent = text || ""
  el.setAttribute("style", `font-size:12.5px;text-align:center;margin-top:8px;border-radius:6px;padding:${text ? "9px 10px" : "0"};font-weight:700;line-height:1.4;${text ? (TOAST_STYLE[type] || TOAST_STYLE.success) : "min-height:0;"}`)
  if (statusTimer) clearTimeout(statusTimer)
  if (text) statusTimer = setTimeout(() => showToast(""), type === "error" ? 7000 : 5000)
}
// 后台进行中计数（独立元素）
function renderCounter() {
  const el = document.getElementById("scrapeCounter")
  if (el) el.textContent = activeJobs > 0 ? `⏳ 后台抓取中 ${activeJobs} 个…（可继续浏览/抓取下一个）` : ""
}

// 点击抓取：校验当前 tab 后启动后台任务，立即放开 UI
async function scrapeProduct() {
  const el = document.getElementById("errIdle")
  el.classList.add("hidden")
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !/:\/\/detail\.1688\.com\/offer\/.*\.html/.test(tab.url || "")) {
    el.textContent = "请先打开 1688 商品详情页（detail.1688.com/offer/…）"
    el.classList.remove("hidden")
    return
  }
  runScrapeJob(tab.id) // 不 await：后台进行，用户可继续操作
}

// 单个后台任务：抓取 → 入池 →（可选）关页 → 刷新列表
async function runScrapeJob(tabId) {
  activeJobs++
  renderCounter()
  let title = ""
  try {
    const resp = await sendScrape(tabId)
    if (!resp?.ok) throw new Error(resp?.error || "抓取失败")
    const data = resp.data
    title = (data.title || "商品").slice(0, 16)
    await submitData(data)

    const { closeTabAfterScrape } = await chrome.storage.local.get("closeTabAfterScrape")
    if (closeTabAfterScrape) { try { await chrome.tabs.remove(tabId) } catch {} }

    loadRecent()
    showToast(`✅ 已成功加入选品池：${title}`, "success")
  } catch (e) {
    const msg = /Receiving end does not exist|Could not establish connection|No tab with id|Frame.*removed|tab.*closed/i.test(e.message || "")
      ? "页面已切走/关闭，未抓完"
      : (e.message || "抓取失败").slice(0, 40)
    showToast(`❌ ${title ? title + "：" : ""}${msg}`, "error")
  } finally {
    activeJobs--
    renderCounter()
  }
}

// ── 提交到选品池（接收快照数据，支持并发）──
async function submitData(data) {
  let teamId = userData?.team_id
  if (!teamId) {
    try {
      const shops = await apiCall("GET", "/shops")
      teamId = (Array.isArray(shops) ? shops[0] : null)?.team_id
    } catch {}
  }
  if (!teamId) throw new Error("未检测到团队信息，请先登录管理后台并加入团队")

  let minPrice = 0
  const skus = (data.skus || []).map(s => {
    const p = parseFloat(String(s.price ?? "").replace(/[^0-9.]/g, "")) || 0
    if (p && (!minPrice || p < minPrice)) minPrice = p
    return { spec: s.spec || "默认", price: p, stock: parseInt(String(s.stock ?? "")) || 100, image: s.image || "" }
  })

  await apiCall("POST", "/product-pool", {
    team_id: teamId,
    offer_id: data.offerId || "",
    source_url: data.offerId ? `https://detail.1688.com/offer/${data.offerId}.html` : "",
    title_cn: data.title || "",
    main_image_url: data.images?.[0] || "",
    cost_price: minPrice || parseFloat((data.priceRange || "").replace(/[^0-9.]/g, "")) || 0,
    sku_count: data.skus?.length || 0,
    image_count: data.images?.length || 0,
    desc_cn: data.description || "",
    images: (data.images || []).map(url => ({ url, status: "url_only" })),
    skus: skus.length > 0 ? skus : [{ spec: "默认", price: 0, stock: 100 }],
    attrs: Array.isArray(data.attrs) ? data.attrs : [],
  })
}

// ── 最近选品列表 ──
async function loadRecent() {
  const wrap = document.getElementById("recentList")
  if (!wrap) return
  wrap.innerHTML = `<div class="empty">加载中…</div>`
  try {
    const data = await apiCall("GET", "/product-pool?page=1&page_size=20")
    const items = data?.items || []
    if (items.length === 0) {
      wrap.innerHTML = `<div class="empty">暂无选品，去 1688 抓取第一个商品吧</div>`
      return
    }
    wrap.innerHTML = items.map(it => {
      const cost = (it.cost_price != null && it.cost_price > 0) ? `¥${Number(it.cost_price).toFixed(2)}` : "—"
      const thumb = it.main_image_url
        ? `<img class="recent-thumb" src="${escapeAttr(it.main_image_url)}" onerror="this.style.visibility='hidden'"/>`
        : `<div class="recent-thumb" style="display:flex;align-items:center;justify-content:center;font-size:20px;">📦</div>`
      return `
        <div class="recent-item" data-id="${escapeAttr(it.id)}" data-url="${escapeAttr(it.source_url || "")}" title="${escapeAttr(it.title_cn || "")}">
          ${thumb}
          <div class="recent-info">
            <div class="recent-title">${escapeHtml(it.title_cn || "未命名商品")}</div>
            <div class="recent-sub">
              <span class="recent-cost">${cost}</span>
              <span>· ${it.sku_count || 0} SKU</span>
              ${statusTag(it.status)}
              <span class="recent-time">🕒 ${escapeHtml(fmtTime(it.created_at))}</span>
            </div>
          </div>
        </div>`
    }).join("")

    wrap.querySelectorAll(".recent-item").forEach(el => {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-id")
        chrome.tabs.create({ url: `${ADMIN}/product-pool?highlight=${encodeURIComponent(id)}` })
      })
    })
  } catch (e) {
    wrap.innerHTML = `<div class="empty">加载失败：${escapeHtml(e.message || "未知错误")}</div>`
  }
}

// ── API Helper ──
async function apiCall(method, path, body) {
  const headers = { "Content-Type": "application/json" }
  const stored = await chrome.storage.local.get("access_token")
  if (stored.access_token) headers["Authorization"] = `Bearer ${stored.access_token}`
  const resp = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(data.detail || resp.statusText)
  return data
}

// 抓取时间：今天显示相对时间，否则显示 月-日 时:分
function fmtTime(iso) {
  if (!iso) return "—"
  const d = new Date(iso)
  if (isNaN(d)) return "—"
  const now = new Date()
  const diff = (now - d) / 1000
  if (diff < 60) return "刚刚"
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400 && d.toDateString() === now.toDateString()) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function pad(n) { return String(n).padStart(2, "0") }

function escapeHtml(s) {
  const div = document.createElement("div")
  div.textContent = s == null ? "" : String(s)
  return div.innerHTML
}
function escapeAttr(s) {
  return String(s == null ? "" : s).replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

// ── Event bindings ──
document.addEventListener("DOMContentLoaded", () => {
  const bind = (id, event, fn) => {
    const el = document.getElementById(id)
    if (el) el.addEventListener(event, fn)
  }
  bind("btn-login", "click", openLogin)
  bind("btn-scrape", "click", scrapeProduct)
  bind("btn-logout", "click", doLogout)
  bind("btn-refresh", "click", loadRecent)
  bind("brand", "click", () => chrome.tabs.create({ url: ADMIN }))

  // 抓取按钮点击动效：按压 pop + 水波纹
  const scrapeBtn = document.getElementById("btn-scrape")
  if (scrapeBtn) scrapeBtn.addEventListener("click", e => {
    scrapeBtn.classList.remove("pop"); void scrapeBtn.offsetWidth; scrapeBtn.classList.add("pop")
    const r = document.createElement("span")
    r.className = "ripple"
    const rect = scrapeBtn.getBoundingClientRect()
    const size = Math.max(rect.width, rect.height)
    r.style.width = r.style.height = size + "px"
    r.style.left = (e.clientX - rect.left - size / 2) + "px"
    r.style.top = (e.clientY - rect.top - size / 2) + "px"
    scrapeBtn.appendChild(r)
    setTimeout(() => r.remove(), 560)
  })

  // 「抓取后关闭页面」开关：加载并持久化
  const chk = document.getElementById("closeTabChk")
  if (chk) {
    chrome.storage.local.get("closeTabAfterScrape").then(({ closeTabAfterScrape }) => {
      chk.checked = !!closeTabAfterScrape
    })
    chk.addEventListener("change", () => {
      chrome.storage.local.set({ closeTabAfterScrape: chk.checked })
    })
  }
})
