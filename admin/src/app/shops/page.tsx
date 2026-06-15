"use client"
import { useEffect, useState } from "react"
import Layout from "@/components/layout/Layout"
import { api } from "@/lib/api"

export default function ShopsPage() {
  const [data, setData] = useState<any[]>([])
  const [show, setShow] = useState(false)
  const [form, setForm] = useState({ alias: "", shop_domain: "", shop_name: "", custom_domain: "", access_token: "", tags: "" })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    api.getShops().then(d => setData(Array.isArray(d) ? d : []))
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError("")
    try {
      await api.createShop({
        alias: form.alias || undefined,
        shop_domain: form.shop_domain,
        shop_name: form.shop_name || undefined,
        custom_domain: form.custom_domain || undefined,
        access_token: form.access_token,
        tags: form.tags || undefined,
      })
      setShow(false); setForm({ alias: "", shop_domain: "", shop_name: "", custom_domain: "", access_token: "", tags: "" })
      setData(await api.getShops())
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <Layout>
      <div className="page-header"><h1 className="page-title">🏪 店铺管理</h1><button className="btn btn-primary" onClick={() => setShow(true)}>+ 绑定店铺</button></div>

      <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>别名</th><th>二级域名</th><th>正式域名</th><th>标签</th><th>状态</th></tr></thead>
        <tbody>
          {data.map(s => (
            <tr key={s.id}>
              <td><strong>{s.alias || s.shop_name || "—"}</strong></td>
              <td style={{ fontSize: ".85rem" }}>{s.shop_domain}</td>
              <td style={{ fontSize: ".85rem", color: "var(--gray-500)" }}>{s.custom_domain || "—"}</td>
              <td>
                {s.tags ? s.tags.split(",").map((t: string) => (
                  <span key={t} className="badge badge-gray" style={{ marginRight: 3, fontSize: ".7rem" }}>
                    <span className="badge-dot" />{t.trim()}
                  </span>
                )) : "—"}
              </td>
              <td><span className="badge badge-green"><span className="badge-dot" />{s.is_active ? "已连接" : "停用"}</span></td>
            </tr>
          ))}
          {data.length === 0 && (
            <tr><td colSpan={5} className="table-empty"><div className="empty-icon">🏪</div>暂无店铺</td></tr>
          )}
        </tbody>
      </table></div></div>

      {show && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99 }} onClick={() => setShow(false)}>
          <div style={{ background: "#fff", borderRadius: 8, width: 440, padding: 20, boxShadow: "0 8px 32px rgba(0,0,0,.2)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <strong>绑定 Shopify 店铺</strong>
              <button onClick={() => setShow(false)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <form onSubmit={submit}>
              <div className="form-group"><label>店铺别名</label><input className="input" value={form.alias} onChange={e => setForm({ ...form, alias: e.target.value })} placeholder="如：主店铺-家居" /></div>
              <div className="form-group"><label>店铺名称</label><input className="input" value={form.shop_name} onChange={e => setForm({ ...form, shop_name: e.target.value })} placeholder="可选" /></div>
              <div className="form-group"><label>店铺域名 *</label><input className="input" value={form.shop_domain} onChange={e => setForm({ ...form, shop_domain: e.target.value })} placeholder="xxx.myshopify.com" required /></div>
              <div className="form-group"><label>正式域名</label><input className="input" value={form.custom_domain} onChange={e => setForm({ ...form, custom_domain: e.target.value })} placeholder="www.mystore.com" /></div>
              <div className="form-group"><label>Access Token *</label><input className="input" value={form.access_token} onChange={e => setForm({ ...form, access_token: e.target.value })} required /></div>
              <div className="form-group"><label>店铺标签</label><input className="input" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="如：家居,户外,电子" /></div>
              <p style={{ fontSize: 11, color: "var(--gray-400)", margin: "0 0 8px" }}>多个标签用逗号分隔，用于标识主营品类</p>
              {error && <div style={{ background: "var(--red-50)", color: "var(--red-700)", padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 8 }}>{error}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShow(false)}>取消</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? "绑定中..." : "绑定"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  )
}
