"use client"
import { useEffect, useState } from "react"
import Layout from "@/components/layout/Layout"
import { api } from "@/lib/api"

function Modal({ title, children, onClose }: any) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 8, width: 500, maxHeight: "85vh", overflow: "auto", padding: 20, boxShadow: "0 8px 32px rgba(0,0,0,.2)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
          <strong>{title}</strong>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

const yn = [{ v: "true", l: "是" }, { v: "false", l: "否" }]

export default function PricingPage() {
  const [data, setData] = useState<any[]>([])
  const [show, setShow] = useState(false)
  const [editId, setEditId] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const [name, setName] = useState("")
  const [priority, setPriority] = useState("0")
  const [exchangeRate, setExchangeRate] = useState("7.25")
  const [markup, setMarkup] = useState("3.0")
  const [priceEnding, setPriceEnding] = useState(".99")
  const [compareAtMult, setCompareAtMult] = useState("1.5")
  // 阶梯定价
  const [tiers, setTiers] = useState<any[]>([])
  const [tierMin, setTierMin] = useState("")
  const [tierMax, setTierMax] = useState("")
  const [tierMult, setTierMult] = useState("")

  useEffect(() => {
    api.getPricingRules().then(d => setData(Array.isArray(d) ? d : []))
  }, [])

  const resetForm = () => {
    setName(""); setPriority("0"); setExchangeRate("7.25"); setMarkup("3.0")
    setPriceEnding(".99"); setCompareAtMult("1.5"); setTiers([])
    setTierMin(""); setTierMax(""); setTierMult(""); setError("")
  }

  const openCreate = () => { setEditId(""); resetForm(); setShow(true) }

  const openEdit = (r: any) => {
    setEditId(r.id); setName(r.name)
    setPriority(String(r.priority ?? 0))
    const f = r.formula || {}
    setExchangeRate(String(f.exchange_rate ?? ""))
    setMarkup(String(f.markup ?? "3.0"))
    setPriceEnding(f.price_ending || ".99")
    setCompareAtMult(String(f.compare_at_multiplier ?? "1.5"))
    setTiers(f.tiers || [])
    setShow(true)
  }

  const addTier = () => {
    if (!tierMax || !tierMult) return
    setTiers([...tiers, { min: +tierMin || 0, max: +tierMax, multiplier: +tierMult }])
    setTierMin(""); setTierMax(""); setTierMult("")
  }

  const buildFormula = () => {
    const f: any = {}
    if (exchangeRate) f.exchange_rate = +exchangeRate
    f.markup = +markup || 3.0
    f.price_ending = priceEnding || ".99"
    if (compareAtMult) f.compare_at_multiplier = +compareAtMult
    if (tiers.length > 0) f.tiers = tiers
    return f
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError("")
    try {
      const payload = {
        name, priority: +priority,
        formula: buildFormula(),
      }
      if (editId) await api.updatePricingRule(editId, payload)
      else await api.createPricingRule(payload)
      setShow(false); setData(await api.getPricingRules())
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const toggle = async (id: string) => {
    try { await api.togglePricingRuleActive(id); setData(await api.getPricingRules()) } catch {}
  }

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">💰 定价规则</h1>
        <button className="btn btn-primary" onClick={openCreate}>+ 新建规则</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>名称</th><th>加价倍率</th><th>汇率</th><th>尾数</th><th>优先级</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={7} className="table-empty"><div className="empty-icon">💰</div>暂无规则</td></tr>
              ) : data.map(r => {
                const f = r.formula || {}
                return (
                  <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.5 }}>
                    <td><strong>{r.name}</strong></td>
                    <td>{f.markup || "—"}x</td>
                    <td style={{ fontSize: ".85rem", color: "var(--gray-500)" }}>{f.exchange_rate || "实时"}</td>
                    <td>{f.price_ending || "—"}</td>
                    <td>{r.priority || 0}</td>
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
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {show && (
        <Modal title={editId ? "编辑定价规则" : "新建定价规则"} onClose={() => setShow(false)}>
          <form onSubmit={submit}>
            <div className="form-group"><label>规则名称 *</label><input className="input" value={name} onChange={e => setName(e.target.value)} required /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div className="form-group"><label>加价倍率</label><input className="input" type="number" step="0.1" value={markup} onChange={e => setMarkup(e.target.value)} /></div>
              <div className="form-group"><label>汇率 (0=实时)</label><input className="input" type="number" step="0.01" value={exchangeRate} onChange={e => setExchangeRate(e.target.value)} /></div>
              <div className="form-group"><label>优先级</label><input className="input" type="number" value={priority} onChange={e => setPriority(e.target.value)} /></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div className="form-group">
                <label>价格尾数</label>
                <select className="input" value={priceEnding} onChange={e => setPriceEnding(e.target.value)}>
                  <option value=".99">.99</option>
                  <option value=".95">.95</option>
                  <option value=".49">.49</option>
                  <option value=".00">.00</option>
                </select>
              </div>
              <div className="form-group"><label>划线价倍率</label><input className="input" type="number" step="0.1" value={compareAtMult} onChange={e => setCompareAtMult(e.target.value)} /></div>
            </div>

            {/* 阶梯定价 */}
            <div className="form-group">
              <label>阶梯定价（可选）</label>
              <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                <input className="input" type="number" placeholder="最低¥" value={tierMin} onChange={e => setTierMin(e.target.value)} style={{ width: 80 }} />
                <input className="input" type="number" placeholder="最高¥" value={tierMax} onChange={e => setTierMax(e.target.value)} style={{ width: 80 }} />
                <input className="input" type="number" step="0.1" placeholder="倍率" value={tierMult} onChange={e => setTierMult(e.target.value)} style={{ width: 60 }} />
                <button type="button" className="btn btn-secondary btn-sm" onClick={addTier} style={{ whiteSpace: "nowrap" }}>+ 添加阶梯</button>
              </div>
              {tiers.length > 0 && (
                <table style={{ fontSize: ".75rem", marginTop: 4 }}>
                  <thead><tr><th>最低</th><th>最高</th><th>倍率</th><th></th></tr></thead>
                  <tbody>
                    {tiers.map((t, i) => (
                      <tr key={i}>
                        <td>¥{t.min}</td><td>¥{t.max}</td><td>{t.multiplier}x</td>
                        <td><button type="button" className="btn btn-ghost btn-sm" style={{ color: "var(--red)" }} onClick={() => setTiers(tiers.filter((_, j) => j !== i))}>移除</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {error && <div style={{ background: "var(--red-50)", color: "var(--red-700)", padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 8 }}>{error}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShow(false)}>取消</button>
              <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? "保存中..." : "保存"}</button>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  )
}
