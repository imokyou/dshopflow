"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { api } from "@/lib/api"

// Shopify 授权完成后跳回此页（商户后台）。读回调 query 里的 code/hmac/state，
// 转给后端 exchange 换 token，再带结果跳回店铺管理页。secret 只在后端用。
type Phase = "loading" | "success" | "error"

export default function ShopifyOAuthCallback() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>("loading")
  const [shop, setShop] = useState("")
  const [err, setErr] = useState("")

  useEffect(() => {
    const params: Record<string, string> = {}
    new URLSearchParams(window.location.search).forEach((v, k) => { params[k] = v })
    setShop(params.shop || "")

    if (!params.code || !params.shop) {
      setErr("回调缺少 code / shop 参数"); setPhase("error"); return
    }
    let done = false
    api.shopifyExchange(params)
      .then(r => {
        done = true
        if (r.ok) {
          setShop(r.shop || params.shop)
          setPhase("success")
          setTimeout(() => router.replace("/shops?connected=" + encodeURIComponent(r.shop || params.shop)), 1400)
        } else {
          setErr(r.error || "授权失败"); setPhase("error")
        }
      })
      .catch(e => { done = true; setErr(e?.message || "网络错误"); setPhase("error") })

    // 兜底：异常久未返回也不卡死
    const t = setTimeout(() => { if (!done) { setErr("授权超时，请重试"); setPhase("error") } }, 25000)
    return () => clearTimeout(t)
  }, [router])

  return (
    <div style={wrap}>
      <style>{KEYFRAMES}</style>
      <div style={{ ...card, animation: "dsfFadeUp .4s ease both" }}>
        <div style={brand}>⚡ DropShipFlow</div>

        {phase === "loading" && (
          <>
            <div style={spinner} />
            <div style={title}>正在完成 Shopify 授权…</div>
            <div style={sub}>{shop || "校验授权信息并连接店铺"}</div>
          </>
        )}

        {phase === "success" && (
          <>
            <div style={{ ...badge, background: "#dcfce7" }}>
              <svg width="34" height="34" viewBox="0 0 36 36">
                <path d="M9 18.5l6 6 12-13" fill="none" stroke="#16a34a" strokeWidth="3.2"
                  strokeLinecap="round" strokeLinejoin="round"
                  style={{ strokeDasharray: 40, strokeDashoffset: 40, animation: "dsfDraw .5s .1s ease forwards" }} />
              </svg>
            </div>
            <div style={title}>授权成功</div>
            <div style={sub}>已连接 {shop}，正在跳转…</div>
          </>
        )}

        {phase === "error" && (
          <>
            <div style={{ ...badge, background: "#fee2e2", animation: "dsfPop .35s ease both, dsfShake .4s .2s ease" }}>
              <span style={{ fontSize: 30, color: "#dc2626", fontWeight: 700 }}>✕</span>
            </div>
            <div style={title}>授权失败</div>
            <div style={{ ...sub, color: "#b91c1c", maxWidth: 320 }}>{err}</div>
            <button style={btn} onClick={() => router.replace("/shops")}>返回店铺管理</button>
          </>
        )}
      </div>
    </div>
  )
}

const wrap: React.CSSProperties = {
  minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
  background: "linear-gradient(135deg,#eef2ff 0%,#faf5ff 100%)", padding: 20,
}
const card: React.CSSProperties = {
  background: "#fff", borderRadius: 16, padding: "40px 44px", width: 420, maxWidth: "92vw",
  boxShadow: "0 12px 40px rgba(99,102,241,.18)", textAlign: "center",
  display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
}
const brand: React.CSSProperties = { fontWeight: 800, fontSize: 15, color: "#6366f1", letterSpacing: ".3px", marginBottom: 6 }
const spinner: React.CSSProperties = {
  width: 54, height: 54, borderRadius: "50%",
  border: "5px solid #ede9fe", borderTopColor: "#6366f1", animation: "dsfSpin .8s linear infinite",
}
const badge: React.CSSProperties = {
  width: 64, height: 64, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
  animation: "dsfPop .35s ease both",
}
const title: React.CSSProperties = { fontSize: 17, fontWeight: 700, color: "#1e293b" }
const sub: React.CSSProperties = { fontSize: 13, color: "#64748b", lineHeight: 1.5, wordBreak: "break-all" }
const btn: React.CSSProperties = {
  marginTop: 6, padding: "9px 18px", borderRadius: 8, border: "none", cursor: "pointer",
  background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", fontWeight: 600, fontSize: 13,
}

const KEYFRAMES = `
@keyframes dsfSpin{to{transform:rotate(360deg)}}
@keyframes dsfFadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes dsfPop{0%{transform:scale(0)}60%{transform:scale(1.12)}100%{transform:scale(1)}}
@keyframes dsfDraw{to{stroke-dashoffset:0}}
@keyframes dsfShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
`
