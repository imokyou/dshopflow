import { useState, useEffect, useCallback } from "react"
import { api, isLoggedIn, getUser, setAuth, clearAuth } from "../lib/api"

type ProductData = {
  title: string; priceRange: string; images: string[]; skus: any[]; description: string; offerId: string; videoUrl?: string
}

export default function Popup() {
  const [loggedIn, setLoggedIn] = useState(false)
  const [product, setProduct] = useState<ProductData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [teams, setTeams] = useState<any[]>([])
  const [shops, setShops] = useState<any[]>([])
  const [selectedTeam, setSelectedTeam] = useState("")
  const [selectedShop, setSelectedShop] = useState("")
  const [options, setOptions] = useState({ watermark: true, whiteBg: true, translate: true, marketing: false })
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    isLoggedIn() ? setLoggedIn(true) : chrome.storage.local.get(["access_token"], (d) => { if (d.access_token) setLoggedIn(true) })
  }, [])

  const scrape = useCallback(async () => {
    setLoading(true); setError("")
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return setError("No active tab")
      const resp = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_PRODUCT" })
      if (resp.success) { setProduct(resp.data); loadUserData() }
      else setError(resp.error || "Scrape failed")
    } catch { setError("请在 1688 商品详情页使用此插件") }
    finally { setLoading(false) }
  }, [])

  const loadUserData = async () => {
    try {
      const [t, s] = await Promise.all([api.getTeams(), api.getShops()])
      setTeams(t); setShops(s)
      if (t.length > 0) setSelectedTeam(t[0].id)
      if (s.length > 0) setSelectedShop(s[0].id)
    } catch {}
  }

  const submit = async () => {
    if (!product || !selectedTeam || !selectedShop) return
    setLoading(true)
    try {
      await api.createImport({
        team_id: selectedTeam, shop_id: selectedShop,
        source_url: `https://detail.1688.com/offer/${product.offerId}.html`,
        offer_id: product.offerId,
        raw_data: { ...product, options },
      })
      setSubmitted(true)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const login = () => {
    chrome.tabs.create({ url: "https://admin.dropshipflow.com/login?source=extension" })
  }

  const toggle = (k: keyof typeof options) => setOptions(prev => ({ ...prev, [k]: !prev[k] }))

  if (!loggedIn) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>🔌 DropShipFlow</div>
        <div style={{ padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔌</div>
          <h3 style={{ marginBottom: 8 }}>欢迎使用 DropShipFlow</h3>
          <p style={{ color: "#666", fontSize: 13, marginBottom: 20 }}>1688 商品一键上架到 Shopify</p>
          <button onClick={login} style={styles.primaryBtn}>🔗 登录 / 注册</button>
          <p style={{ fontSize: 11, color: "#999", marginTop: 12 }}>点击后将打开 Web 管理后台<br />登录后自动连接插件</p>
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>✅ DropShipFlow</div>
        <div style={{ padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <h3>导入任务已创建！</h3>
          <p style={{ color: "#666", fontSize: 13 }}>商品正在处理中，请前往管理后台查看进度</p>
          <button onClick={() => setSubmitted(false)} style={{ ...styles.primaryBtn, marginTop: 16 }}>继续导入下一个</button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>⚡ DropShipFlow {product && <span style={{ fontSize: 10 }}>· 已抓取</span>}</div>
      <div style={{ padding: 12 }}>
        {!product ? (
          <div style={{ textAlign: "center", padding: 40 }}>
            <p style={{ marginBottom: 16, color: "#666" }}>在 1688 商品详情页使用此插件</p>
            <button onClick={scrape} disabled={loading} style={styles.primaryBtn}>
              {loading ? "抓取中..." : "📦 抓取当前商品"}
            </button>
            {error && <p style={{ color: "red", fontSize: 12, marginTop: 8 }}>{error}</p>}
          </div>
        ) : (
          <>
            <div style={styles.card}>
              {product.images[0] && <img src={product.images[0]} style={{ width: "100%", maxHeight: 120, objectFit: "cover" }} />}
              <div style={{ padding: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>{product.title}</div>
                <div style={{ color: "#e53e3e", fontWeight: 700 }}>{product.priceRange}</div>
                <div style={{ fontSize: 11, color: "#666" }}>SKU: {product.skus.length} 个 · 图片: {product.images.length} 张</div>
              </div>
            </div>

            <div style={{ marginTop: 8, fontSize: 12 }}>
              <label>目标店铺</label>
              <select value={selectedShop} onChange={e => setSelectedShop(e.target.value)} style={styles.select}>
                {shops.map(s => <option key={s.id} value={s.id}>{s.shop_domain}</option>)}
              </select>
            </div>

            <div style={{ marginTop: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 600 }}>处理选项</label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 4 }}>
                {Object.entries({ watermark: "去水印", whiteBg: "白底图", translate: "AI 翻译", marketing: "营销图" }).map(([k, v]) => (
                  <label key={k} onClick={() => toggle(k as keyof typeof options)} style={{ ...styles.toggle, ...(options[k as keyof typeof options] ? styles.toggleOn : {}) }}>
                    {options[k as keyof typeof options] ? "☑" : "☐"} {v}
                  </label>
                ))}
              </div>
            </div>

            {error && <p style={{ color: "red", fontSize: 11 }}>{error}</p>}

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => setProduct(null)} style={styles.secondaryBtn}>取消</button>
              <button onClick={submit} disabled={loading} style={styles.primaryBtn}>{loading ? "提交中..." : "🚀 一键上架"}</button>
            </div>

            <div style={{ fontSize: 10, color: "#999", textAlign: "center", marginTop: 8 }}>
              👤 {getUser()?.email} · <a onClick={() => { clearAuth(); setLoggedIn(false) }} style={{ cursor: "pointer", color: "#e53e3e" }}>退出</a>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { width: 360, fontFamily: "-apple-system, sans-serif", background: "#fff" },
  header: { background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", padding: "10px 14px", fontWeight: 700, fontSize: 14 },
  card: { border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden", marginBottom: 8 },
  primaryBtn: { flex: 1, padding: "10px 16px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 13 },
  secondaryBtn: { padding: "10px 16px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#666", cursor: "pointer", fontSize: 13 },
  toggle: { padding: "6px 10px", borderRadius: 6, border: "1px solid #e2e8f0", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 4 },
  toggleOn: { borderColor: "#6366f1", background: "#eef2ff" },
  select: { width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12, marginTop: 2 },
}
