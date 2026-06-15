"use client"
import { useEffect, useState } from "react"
import Layout from "@/components/layout/Layout"
import { api } from "@/lib/api"

export default function PlansPage() {
  const [data, setData] = useState<any[]>([])
  const [quotaRules, setQuotaRules] = useState<any[]>([])

  // Modal state
  const [show, setShow] = useState(false)
  const [editId, setEditId] = useState("")
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [monthlyPrice, setMonthlyPrice] = useState(0)
  const [yearlyPrice, setYearlyPrice] = useState(0)
  const [quotaRuleId, setQuotaRuleId] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const [plans, rules] = await Promise.all([api.getPlans(), api.getQuotaRules()])
      setData(Array.isArray(plans) ? plans : [])
      setQuotaRules(Array.isArray(rules) ? rules : [])
    } catch {}
  }

  const openCreate = () => {
    setEditId(""); setName(""); setSlug("")
    setMonthlyPrice(0); setYearlyPrice(0); setQuotaRuleId("")
    setError(""); setShow(true)
  }

  const openEdit = (p: any) => {
    setEditId(p.id); setName(p.name); setSlug(p.slug)
    setMonthlyPrice(p.monthly_price || 0); setYearlyPrice(p.yearly_price || 0)
    setQuotaRuleId(p.quota_rule_id || "")
    setError(""); setShow(true)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError("")
    try {
      const payload = { name, slug, monthly_price: monthlyPrice, yearly_price: yearlyPrice, quota_rule_id: quotaRuleId || undefined }
      if (editId) await api.updatePlan(editId, payload)
      else await api.createPlan(payload)
      setShow(false); load()
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const toggle = async (id: string) => {
    try { await api.togglePlanActive(id); load() } catch {}
  }

  return (
    <Layout>
      <div className="page-header">
        <div><h1 className="page-title">💳 订阅套餐</h1></div>
        <button className="btn btn-primary" onClick={openCreate}>+ 新建套餐</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>名称</th><th>Slug</th><th>月付</th><th>年付</th><th>配额规则</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {data.map(p => (
                <tr key={p.id} style={{ opacity: p.is_active ? 1 : 0.5 }}>
                  <td><strong>{p.name}</strong></td>
                  <td style={{ color: "var(--gray-500)", fontSize: ".85rem" }}>{p.slug}</td>
                  <td style={{ fontWeight: 600, color: "var(--green-700)" }}>${p.monthly_price}</td>
                  <td style={{ fontWeight: 600 }}>${p.yearly_price}</td>
                  <td style={{ fontSize: ".85rem", color: "var(--gray-500)" }}>{p.quota_rule_name || "—"}</td>
                  <td>
                    <span className={"badge " + (p.is_active ? "badge-green" : "badge-red")} style={{ fontSize: ".75rem" }}>
                      <span className="badge-dot" />{p.is_active ? "启用" : "停用"}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(p)}>编辑</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: p.is_active ? "var(--red)" : "var(--green)" }} onClick={() => toggle(p.id)}>
                        {p.is_active ? "停用" : "启用"}
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
              <strong>{editId ? "编辑套餐" : "新建套餐"}</strong>
              <button onClick={() => setShow(false)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <form onSubmit={submit}>
              <div className="form-group"><label>名称 *</label><input className="input" value={name} onChange={e => setName(e.target.value)} required /></div>
              <div className="form-group"><label>Slug *</label><input className="input" value={slug} onChange={e => setSlug(e.target.value)} required placeholder="starter" /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div className="form-group"><label>月付 ($)</label><input className="input" type="number" value={monthlyPrice} onChange={e => setMonthlyPrice(+e.target.value)} /></div>
                <div className="form-group"><label>年付 ($)</label><input className="input" type="number" value={yearlyPrice} onChange={e => setYearlyPrice(+e.target.value)} /></div>
              </div>
              <div className="form-group">
                <label>绑定配额规则</label>
                <select className="input" value={quotaRuleId} onChange={e => setQuotaRuleId(e.target.value)}>
                  <option value="">不绑定</option>
                  {quotaRules.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              {error && <div style={{ background: "var(--red-50)", color: "var(--red-700)", padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 8 }}>{error}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
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
