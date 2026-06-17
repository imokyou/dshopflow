"use client"
import { useEffect, useState } from "react"
import Layout from "@/components/layout/Layout"
import { api } from "@/lib/api"

export default function PlatformSettingsPage() {
  const [cfg, setCfg] = useState<any>(null)
  const [secret, setSecret] = useState("")        // 仅当用户输入时才提交
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  const load = async () => {
    try { setCfg(await api.getPlatformSettings()) }
    catch (e: any) { setMsg({ type: "err", text: e.message }) }
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!cfg) return
    setSaving(true); setMsg(null)
    try {
      const body: any = {
        shopify_api_key: cfg.shopify_api_key || "",
        shopify_scopes: cfg.shopify_scopes || "",
        shopify_app_base_url: cfg.shopify_app_base_url || "",
        admin_base_url: cfg.admin_base_url || "",
      }
      if (secret) body.shopify_api_secret = secret  // 留空不改
      const updated = await api.updatePlatformSettings(body)
      setCfg(updated); setSecret("")
      setMsg({ type: "ok", text: "已保存" })
    } catch (e: any) { setMsg({ type: "err", text: e.message }) }
    finally { setSaving(false) }
  }

  const set = (k: string, v: string) => setCfg((c: any) => ({ ...c, [k]: v }))

  return (
    <Layout>
      <div className="page-header"><h1 className="page-title">⚙️ 平台设置</h1></div>

      {msg && (
        <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 6, fontSize: 13,
          background: msg.type === "ok" ? "#dcfce7" : "#fee2e2", color: msg.type === "ok" ? "#166534" : "#991b1b" }}>
          {msg.text}
        </div>
      )}

      {!cfg ? <div className="card" style={{ padding: 20 }}>加载中…</div> : (
        <div className="card" style={{ padding: 20, maxWidth: 640 }}>
          <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>🛍️ Shopify App（OAuth 接入）</h3>
          <p style={{ fontSize: 12, color: "var(--gray-500)", margin: "0 0 16px" }}>
            在 Shopify Partner 后台创建 App 后，把 API key / secret 填这里。secret 加密存储、不回显。
          </p>

          <div className="form-group"><label>API key（Client ID）</label>
            <input className="input" value={cfg.shopify_api_key || ""} onChange={e => set("shopify_api_key", e.target.value)} placeholder="Partner app 的 Client ID" />
          </div>

          <div className="form-group"><label>API secret（Client secret）</label>
            <input className="input" type="password" value={secret} onChange={e => setSecret(e.target.value)}
              placeholder={cfg.shopify_api_secret_set ? "已设置（留空不修改）" : "未设置，请填入"} />
          </div>

          <div className="form-group"><label>Scopes</label>
            <input className="input" value={cfg.shopify_scopes || ""} onChange={e => set("shopify_scopes", e.target.value)} placeholder="write_products,read_products" />
          </div>

          <div className="form-group"><label>后端公网地址（App Base URL）</label>
            <input className="input" value={cfg.shopify_app_base_url || ""} onChange={e => set("shopify_app_base_url", e.target.value)} placeholder="https://xxx.trycloudflare.com（内网穿透域名）" />
          </div>

          <div className="form-group"><label>管理后台地址（授权后跳回）</label>
            <input className="input" value={cfg.admin_base_url || ""} onChange={e => set("admin_base_url", e.target.value)} placeholder="http://localhost:3000" />
          </div>

          <div style={{ background: "var(--gray-50, #f8fafc)", border: "1px solid var(--gray-200, #e2e8f0)", borderRadius: 6, padding: "10px 12px", margin: "4px 0 16px", fontSize: 12 }}>
            <div style={{ color: "var(--gray-500)", marginBottom: 4 }}>👉 把下面这个回调地址填进 Partner app 的「Allowed redirection URL(s)」（需完全一致）：</div>
            <code style={{ wordBreak: "break-all", fontWeight: 600 }}>
              {cfg.callback_url || (cfg.shopify_app_base_url ? `${cfg.shopify_app_base_url.replace(/\/$/, "")}/api/v1/shops/oauth/callback` : "（先填后端公网地址）")}
            </code>
          </div>

          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "保存中…" : "保存"}</button>
        </div>
      )}
    </Layout>
  )
}
