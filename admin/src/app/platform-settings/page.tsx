"use client"
import { useEffect, useState } from "react"
import Layout from "@/components/layout/Layout"
import { api } from "@/lib/api"

export default function PlatformSettingsPage() {
  const [cfg, setCfg] = useState<any>(null)
  const [secret, setSecret] = useState("")        // shopify secret，仅当用户输入时才提交
  const [s3Secret, setS3Secret] = useState("")    // s3 secret key，同上
  const [saving, setSaving] = useState("")        // 哪张卡在保存（"shopify" | "s3" | ""）
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null)

  const load = async () => {
    try { setCfg(await api.getPlatformSettings()) }
    catch (e: any) { setMsg({ type: "err", text: e.message }) }
  }
  useEffect(() => { load() }, [])

  const set = (k: string, v: string) => setCfg((c: any) => ({ ...c, [k]: v }))

  const doSave = async (which: string, body: any): Promise<boolean> => {
    setSaving(which); setMsg(null)
    try {
      setCfg(await api.updatePlatformSettings(body))
      setMsg({ type: "ok", text: "已保存" })
      return true
    } catch (e: any) { setMsg({ type: "err", text: e.message }); return false }
    finally { setSaving("") }
  }

  const saveShopify = async () => {
    const body: any = {
      shopify_api_key: cfg.shopify_api_key || "", shopify_scopes: cfg.shopify_scopes || "",
      shopify_app_base_url: cfg.shopify_app_base_url || "", admin_base_url: cfg.admin_base_url || "",
    }
    if (secret) body.shopify_api_secret = secret
    if (await doSave("shopify", body)) setSecret("")
  }

  const saveS3 = async () => {
    const body: any = {
      storage_backend: cfg.storage_backend || "local", s3_endpoint: cfg.s3_endpoint || "",
      s3_bucket: cfg.s3_bucket || "", s3_access_key: cfg.s3_access_key || "",
      s3_public_url_prefix: cfg.s3_public_url_prefix || "",
    }
    if (s3Secret) body.s3_secret_key = s3Secret
    if (await doSave("s3", body)) setS3Secret("")
  }

  const cardStyle: React.CSSProperties = { padding: 20, flex: "1 1 480px", maxWidth: 600, alignSelf: "flex-start" }

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
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>

          {/* Shopify 卡片 */}
          <div className="card" style={cardStyle}>
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
              <input className="input" value={cfg.shopify_app_base_url || ""} onChange={e => set("shopify_app_base_url", e.target.value)} placeholder="https://appapi.你的域名.com" />
            </div>
            <div className="form-group"><label>管理后台地址（授权后跳回）</label>
              <input className="input" value={cfg.admin_base_url || ""} onChange={e => set("admin_base_url", e.target.value)} placeholder="https://app.你的域名.com" />
            </div>
            <div style={{ background: "var(--gray-50, #f8fafc)", border: "1px solid var(--gray-200, #e2e8f0)", borderRadius: 6, padding: "10px 12px", margin: "4px 0 16px", fontSize: 12 }}>
              <div style={{ color: "var(--gray-500)", marginBottom: 4 }}>👉 把下面这个回调地址填进 Partner app 的「Allowed redirection URL(s)」（需完全一致）：</div>
              <code style={{ wordBreak: "break-all", fontWeight: 600 }}>
                {cfg.callback_url || (cfg.admin_base_url ? `${cfg.admin_base_url.replace(/\/$/, "")}/shops/oauth/callback` : "（先填管理后台地址）")}
              </code>
            </div>
            <button className="btn btn-primary" onClick={saveShopify} disabled={!!saving}>{saving === "shopify" ? "保存中…" : "保存 Shopify 配置"}</button>
          </div>

          {/* 图片存储 卡片 */}
          <div className="card" style={cardStyle}>
            <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>🖼️ 图片存储（S3 / MinIO）</h3>
            <p style={{ fontSize: 12, color: "var(--gray-500)", margin: "0 0 16px" }}>
              选「S3」后，选品池转入时自动把 1688 图片转存到你的 S3，商品图与素材改用自有 URL（避免 Shopify 拉 alicdn 图被防盗链拦）。改这里即时生效，无需重启。
            </p>

            <div className="form-group"><label>存储方式</label>
              <select className="input" value={cfg.storage_backend || "local"} onChange={e => set("storage_backend", e.target.value)}>
                <option value="local">本地（保留 1688 原链接，不转存）</option>
                <option value="s3">S3 / MinIO（转入时转存）</option>
              </select>
            </div>

            {cfg.storage_backend === "s3" && (
              <>
                <div className="form-group"><label>S3 Endpoint</label>
                  <input className="input" value={cfg.s3_endpoint || ""} onChange={e => set("s3_endpoint", e.target.value)} placeholder="自建 MinIO 填 https://minio.你的域名.com；用 AWS S3 留空" />
                </div>
                <div className="form-group"><label>Bucket</label>
                  <input className="input" value={cfg.s3_bucket || ""} onChange={e => set("s3_bucket", e.target.value)} placeholder="dshopflow" />
                </div>
                <div className="form-group"><label>Access Key</label>
                  <input className="input" value={cfg.s3_access_key || ""} onChange={e => set("s3_access_key", e.target.value)} placeholder="S3/MinIO 的 access key" />
                </div>
                <div className="form-group"><label>Secret Key</label>
                  <input className="input" type="password" value={s3Secret} onChange={e => setS3Secret(e.target.value)}
                    placeholder={cfg.s3_secret_key_set ? "已设置（留空不修改）" : "未设置，请填入"} />
                </div>
                <div className="form-group"><label>公开访问前缀（Public URL Prefix）</label>
                  <input className="input" value={cfg.s3_public_url_prefix || ""} onChange={e => set("s3_public_url_prefix", e.target.value)} placeholder="https://minio.你的域名.com/dshopflow（桶的公开访问根）" />
                </div>
              </>
            )}
            <button className="btn btn-primary" onClick={saveS3} disabled={!!saving}>{saving === "s3" ? "保存中…" : "保存图片存储配置"}</button>
          </div>

        </div>
      )}
    </Layout>
  )
}
