"use client"
import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { api } from "@/lib/api"

export default function LoginPage() {
  // useSearchParams 必须置于 Suspense 边界内，否则 next build 报错 / 整页退化 CSR
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  )
}

function LoginInner() {
  const [mode, setMode] = useState<"login" | "register">("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const inviteToken = searchParams.get("invite")
  const source = searchParams.get("source")

  useEffect(() => {
    if (inviteToken) setMode("register")
    
    // 已登录 + 非扩展来源 → 自动跳转
    if (source !== "extension") {
      const token = localStorage.getItem("token")
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split(".")[1]))
          router.replace(payload.role === "super_admin" ? "/dashboard" : "/product-pool")
        } catch {}
      }
    }
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError("")
    try {
      let data: any
      if (mode === "login") {
        data = await api.login(email, password)
      } else {
        const payload: any = { email, password, name: name || undefined }
        if (inviteToken) payload.invitation_token = inviteToken
        data = await api.register(payload)
      }
      
      if (source === "extension") {
        // 来自扩展的登录 → ExtLoginView 已接管
        return
      }
      router.push(data.user?.role === "super_admin" ? "/dashboard" : "/product-pool")
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" }}>
      <div style={{ width: 420, background: "#fff", borderRadius: 16, padding: 40, boxShadow: "0 20px 60px rgba(0,0,0,.15)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg, var(--primary), #8b5cf6)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 28, marginBottom: 16 }}>⚡</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--gray-900)", marginBottom: 4 }}>DropShipFlow</h1>
          <p style={{ color: "var(--gray-400)", fontSize: 14 }}>1688 → Shopify 一键上架</p>
        </div>

        {source === "extension" && (
          <ExtLoginView />
        )}

        {source !== "extension" && (
          <>
            {inviteToken && (
              <div style={{ background: "var(--blue-50)", color: "var(--blue-700)", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 16, lineHeight: 1.4 }}>
                📨 你已被邀请加入团队，请设置密码完成注册。
              </div>
            )}

            <div style={{ display: "flex", marginBottom: 24, borderBottom: "2px solid var(--gray-100)", gap: 4 }}>
              {(["login", "register"] as const).map(m => (
                <button key={m} onClick={() => { if (!inviteToken || m === "register") { setMode(m); setError("") } }}
                  style={{ flex: 1, padding: "10px 0", border: "none", background: "none", cursor: inviteToken && m === "login" ? "not-allowed" : "pointer",
                    fontSize: 15, fontWeight: 600, color: mode === m ? "var(--primary)" : "var(--gray-400)",
                    borderBottom: mode === m ? "2px solid var(--primary)" : "2px solid transparent", marginBottom: -2,
                    opacity: inviteToken && m === "login" ? 0.4 : 1 }}
                >{m === "login" ? "登录" : "注册"}</button>
              ))}
            </div>
            <form onSubmit={submit}>
              {mode === "register" && <div className="form-group"><label>昵称</label><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="你的名字" /></div>}
              <div className="form-group"><label>邮箱</label><input type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@example.com" required /></div>
              <div className="form-group"><label>密码</label><input type="password" className="input" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required /></div>
              {mode === "register" && !inviteToken && <p style={{ fontSize: 12, color: "var(--gray-400)", margin: "8px 0 16px" }}>💡 第一个注册的用户自动成为<strong>超级管理员</strong>。</p>}
              {error && <div style={{ background: "var(--red-50)", color: "var(--red-700)", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 16 }}>{error}</div>}
              <button type="submit" className="btn btn-primary" style={{ width: "100%", padding: "12px 0", fontSize: 15 }} disabled={loading}>
                {loading ? <span className="spinner" /> : mode === "login" ? "登录" : (inviteToken ? "设置密码并加入" : "创建账号")}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

// ── 扩展登录专用视图 ──
function ExtLoginView() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  
  // 检查是否已登录
  useEffect(() => {
    const token = localStorage.getItem("token")
    if (token) {
      setDone(true)
      // 通过全局变量传给内容脚本
      try {
        const payload = JSON.parse(atob(token.split(".")[1]))
        ;(window as any).__DROPSHIPFLOW_TOKEN__ = {
          access_token: token,
          refresh_token: localStorage.getItem("refresh_token") || "",
          user: { email: payload.sub, role: payload.role, team_id: payload.team_id },
        }
      } catch {}
    }
  }, [])
  
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError("")
    try {
      await api.login(email, password)
      // 登录成功后设全局变量供内容脚本读取
      const token = localStorage.getItem("token")
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split(".")[1]))
          ;(window as any).__DROPSHIPFLOW_TOKEN__ = {
            access_token: token,
            refresh_token: localStorage.getItem("refresh_token") || "",
            user: { email: payload.sub, role: payload.role, team_id: payload.team_id },
          };
        } catch {}
      }
      setDone(true)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }
  
  if (done) {
    return (
      <div style={{ textAlign: "center", padding: "12px 0" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
        <h3 style={{ marginBottom: 8 }}>登录成功！</h3>
        <p style={{ color: "#666", fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
          可以关闭此页面了。<br/>
          回到 <strong>1688 商品页</strong>，点击右上角<br/>
          ⚡ <strong>DropShipFlow</strong> 扩展图标即可使用。
        </p>
      </div>
    )
  }
  
  return (
    <>
      <div style={{ background: "#eef2ff", color: "#4338ca", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 16, lineHeight: 1.4 }}>
        🔌 登录后自动连接浏览器插件
      </div>
      <form onSubmit={submit}>
        <div className="form-group"><label>邮箱</label><input type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@example.com" required /></div>
        <div className="form-group"><label>密码</label><input type="password" className="input" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required /></div>
        {error && <div style={{ background: "var(--red-50)", color: "var(--red-700)", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 16 }}>{error}</div>}
        <button type="submit" className="btn btn-primary" style={{ width: "100%", padding: "12px 0", fontSize: 15 }} disabled={loading}>
          {loading ? "登录中..." : "登录"}
        </button>
      </form>
    </>
  )
}
