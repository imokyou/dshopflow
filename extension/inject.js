// DropShipFlow 主世界注入脚本（world: MAIN, run_at: document_start）
// od-pc 新版 1688 把商品详情/SKU/图片放在 mtop API（offerdetail.service），用 jsonp 传输。
// jsonp 通过 <script> 注入 + 全局回调返回，绕过 fetch/XHR，故这里覆盖多条路径：
//   1) 包裹 window.mtop / lib.mtop 的 request
//   2) 钩 <script> 插入：抓 jsonp 请求 URL（含 data=mmgaRequest）并包裹其回调拿响应
//   3) 兜底钩 fetch / XHR
// 截获的 offerdetail 响应写入桥接元素 <script id="__dsf_offer_data">，供 content.js 读取。
// 另设 window.__DSF_DIAG__ 自诊断，便于确认加载与捕获情况。
(() => {
  const BRIDGE_ID = "__dsf_offer_data"
  const isOfferApi = (s) => /offerdetail/i.test(String(s || ""))
  const DIAG = (window.__DSF_DIAG__ = window.__DSF_DIAG__ || { loaded: 0, apis: [], jsonp: 0, captured: 0, paths: [] })
  DIAG.loaded = Date.now()

  // offerdetail.service 是多路复用接口：靠 mmgaRequest.serviceName 区分返回的数据
  // （证书/详情/SKU/描述各一个 serviceName）。按 serviceName 累积，避免后到的覆盖前面的。
  const STORE = (window.__DSF_STORE__ = window.__DSF_STORE__ || {})

  // 从请求（mtop opt 对象 或 jsonp/xhr 的 URL）里取 serviceName，作为累积 key
  function svcName(src) {
    try {
      if (src && typeof src === "object") {
        const d = src.data || src
        let mr = d && d.mmgaRequest
        if (typeof mr === "string") mr = JSON.parse(mr)
        return (mr && mr.serviceName) || null
      }
      if (typeof src === "string" && /^https?:|\bdata=/.test(src)) {
        const u = new URL(src, location.href)
        let d = u.searchParams.get("data")
        if (d) { d = JSON.parse(d); let mr = d.mmgaRequest; if (typeof mr === "string") mr = JSON.parse(mr); return (mr && mr.serviceName) || null }
      }
    } catch (e) {}
    return null
  }

  function writeBridge() {
    try {
      let el = document.getElementById(BRIDGE_ID)
      if (!el) {
        el = document.createElement("script")
        el.type = "application/json"; el.id = BRIDGE_ID
        ;(document.documentElement || document.head || document.body).appendChild(el)
      }
      el.textContent = JSON.stringify(Object.values(STORE))
      window.__DSF_OFFER_DATA__ = Object.values(STORE)
    } catch (e) {}
  }
  let _seq = 0
  // reqSrc：用于取 serviceName 的请求来源（mtop 的 opt / jsonp/xhr 的 url）
  function stash(api, res, path, reqSrc) {
    try {
      if (!isOfferApi(api)) return
      if (!res || typeof res !== "object") return
      const payload = res.data != null ? res.data : res
      if (!payload || typeof payload !== "object") return
      const key = svcName(reqSrc) || ("seq" + (_seq++))
      STORE[key] = payload
      DIAG.paths.push(path || "?")
      DIAG.captured++
      writeBridge()
    } catch (e) {}
  }

  // ── 1) 包裹 mtop.request ──
  function wrapMtop(m) {
    if (!m || m.__dsfWrapped || typeof m.request !== "function") return m
    const orig = m.request.bind(m)
    m.request = function (opt) {
      try { if (opt && opt.api) DIAG.apis.push(String(opt.api)) } catch (e) {}
      const ret = orig(opt)
      try {
        const api = (opt && opt.api) || ""
        if (ret && typeof ret.then === "function") ret.then(res => stash(api, res, "mtop", opt), () => {})
      } catch (e) {}
      return ret
    }
    m.__dsfWrapped = true
    return m
  }
  function hookGlobal(host, prop) {
    try {
      let cur = host[prop]
      if (cur) wrapMtop(cur)
      Object.defineProperty(host, prop, {
        configurable: true, enumerable: true,
        get() { return cur }, set(v) { cur = wrapMtop(v) || v },
      })
    } catch (e) {}
  }
  hookGlobal(window, "mtop")
  try { if (!window.lib) window.lib = {}; hookGlobal(window.lib, "mtop") } catch (e) {}
  let polls = 0
  const timer = setInterval(() => {
    try { if (window.mtop) wrapMtop(window.mtop); if (window.lib && window.lib.mtop) wrapMtop(window.lib.mtop) } catch (e) {}
    if (++polls > 150) clearInterval(timer)
  }, 80)

  // ── 2) 钩 <script> 注入：拦 jsonp（请求 URL + 回调响应）──
  function handleScriptNode(node) {
    try {
      if (!node || node.tagName !== "SCRIPT") return
      const src = node.src || node.getAttribute && node.getAttribute("src") || ""
      if (!src || !isOfferApi(src)) return
      DIAG.jsonp++
      // 记录请求里的 data 参数（含正确的 mmgaRequest），调试/备用主动调用
      try {
        const u = new URL(src, location.href)
        const d = u.searchParams.get("data")
        if (d && !window.__DSF_REQ_DATA__) window.__DSF_REQ_DATA__ = d
      } catch (e) {}
      // 包裹 jsonp 回调拿响应
      const cb = (src.match(/[?&](?:callback|jsonpIncPrefix|jsonp)=([^&]+)/) || [])[1]
      if (cb && typeof window[cb] === "function" && !window[cb].__dsf) {
        const oc = window[cb]
        const wrapped = function (resp) { try { stash(src, resp, "jsonp", src) } catch (e) {} return oc.apply(this, arguments) }
        wrapped.__dsf = true
        try { window[cb] = wrapped } catch (e) {}
      }
    } catch (e) {}
  }
  for (const proto of [Node.prototype]) {
    const oAppend = proto.appendChild
    proto.appendChild = function (n) { handleScriptNode(n); return oAppend.apply(this, arguments) }
    const oInsert = proto.insertBefore
    proto.insertBefore = function (n, r) { handleScriptNode(n); return oInsert.apply(this, arguments) }
  }

  // ── 3) 兜底钩 fetch / XHR ──
  try {
    const of = window.fetch
    if (of) window.fetch = function (...a) {
      const url = (a[0] && a[0].url) || a[0] || ""
      const p = of.apply(this, a)
      if (isOfferApi(url)) p.then(r => { try { r.clone().json().then(j => stash(url, j, "fetch", url)).catch(() => {}) } catch (e) {} }, () => {})
      return p
    }
  } catch (e) {}
  try {
    const XO = XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.open = function (m, url) { this.__dsfUrl = url; return XO.apply(this, arguments) }
    const XS = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.send = function () {
      try {
        if (isOfferApi(this.__dsfUrl)) { const url = this.__dsfUrl; this.addEventListener("load", () => { try { stash(url, JSON.parse(this.responseText), "xhr", url) } catch (e) {} }) }
      } catch (e) {}
      return XS.apply(this, arguments)
    }
  } catch (e) {}
})()
