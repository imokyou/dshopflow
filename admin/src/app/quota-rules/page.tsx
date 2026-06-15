"use client"
import { useEffect, useState } from "react"
import Layout from "@/components/layout/Layout"
import { api } from "@/lib/api"

export default function QuotaRulesPage() {
  const [data, setData] = useState<any[]>([])
  const [show, setShow] = useState(false)
  const [editId, setEditId] = useState("")
  const [f, setF] = useState<any>({
    name: "", max_team_members: "1", max_shops: "1",
    daily_import_limit: "0", daily_image_limit: "0",
    monthly_import_limit: "0", monthly_image_limit: "0",
  })
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    try { setData(await api.getQuotaRules()) } catch {}
  }

  const resetForm = () => setF({
    name: "", max_team_members: "1", max_shops: "1",
    daily_import_limit: "0", daily_image_limit: "0",
    monthly_import_limit: "0", monthly_image_limit: "0",
  })

  const openCreate = () => { setEditId(""); resetForm(); setError(""); setShow(true) }

  const openEdit = (r: any) => {
    setEditId(r.id)
    setF({
      name: r.name || "",
      max_team_members: String(r.max_team_members ?? "1"),
      max_shops: String(r.max_shops ?? "1"),
      daily_import_limit: String(r.daily_import_limit ?? "0"),
      daily_image_limit: String(r.daily_image_limit ?? "0"),
      monthly_import_limit: String(r.monthly_import_limit ?? "0"),
      monthly_image_limit: String(r.monthly_image_limit ?? "0"),
    })
    setError(""); setShow(true)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError("")
    try {
      const payload = {
        name: f.name,
        max_team_members: +f.max_team_members, max_shops: +f.max_shops,
        daily_import_limit: +f.daily_import_limit, daily_image_limit: +f.daily_image_limit,
        monthly_import_limit: +f.monthly_import_limit, monthly_image_limit: +f.monthly_image_limit,
      }
      if (editId) await api.updateQuotaRule(editId, payload)
      else await api.createQuotaRule(payload)
      setShow(false); load()
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const toggle = async (id: string) => {
    try { await api.toggleQuotaRuleActive(id); load() } catch {}
  }

  const F = (label: string, key: string) => (
    <div className="form-group">
      <label>{label}</label>
      <input className="input" type="number" value={f[key]} onChange={e => setF({ ...f, [key]: e.target.value })} />
    </div>
  )

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">📏 配额规则</h1>
        <button className="btn btn-primary" onClick={openCreate}>+ 新建规则</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>名称</th><th>成员上限</th><th>店铺上限</th><th>日导入</th><th>日素材</th><th>月导入</th><th>月素材</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {data.map(r => (
                <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.5 }}>
                  <td><strong>{r.name}</strong></td>
                  <td>{r.max_team_members || "∞"}</td>
                  <td>{r.max_shops || "∞"}</td>
                  <td>{r.daily_import_limit || "∞"}</td>
                  <td>{r.daily_image_limit || "∞"}</td>
                  <td>{r.monthly_import_limit || "∞"}</td>
                  <td>{r.monthly_image_limit || "∞"}</td>
                  <td>
                    <span className={"badge " + (r.is_active ? "badge-green" : "badge-red")} style={{ fontSize: ".75rem" }}>
                      <span className="badge-dot" />{r.is_active ? "启用" : "停用"}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(r)}>编辑</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: r.is_active ? "var(--red)" : "var(--green)" }} onClick={() => toggle(r.id)}>
                        {r.is_active ? "停用" : "启用"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {show && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99 }} onClick={() => setShow(false)}>
          <div style={{ background: "#fff", borderRadius: 8, width: 440, padding: 20, boxShadow: "0 8px 32px rgba(0,0,0,.2)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <strong>{editId ? "编辑配额规则" : "新建配额规则"}</strong>
              <button onClick={() => setShow(false)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <form onSubmit={submit}>
              <div className="form-group"><label>规则名称 *</label><input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required /></div>
              {F("成员上限 (0=无限)", "max_team_members")}
              {F("店铺上限 (0=无限)", "max_shops")}
              {F("日导入商品上限 (0=无限)", "daily_import_limit")}
              {F("日处理素材上限 (0=无限)", "daily_image_limit")}
              {F("月导入商品上限 (0=无限)", "monthly_import_limit")}
              {F("月处理素材上限 (0=无限)", "monthly_image_limit")}
              {error && <div style={{ background: "var(--red-50)", color: "var(--red-700)", padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 8 }}>{error}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShow(false)}>取消</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? "保存中..." : "保存"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  )
}
