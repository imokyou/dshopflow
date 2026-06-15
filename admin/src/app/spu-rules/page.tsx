"use client"
import { useCallback, useEffect, useState } from "react"
import Layout from "@/components/layout/Layout"
import { api } from "@/lib/api"

export const dynamic = "force-dynamic"

export default function SpuRulesPage() {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<any>(null) // {id?, name, code, remark} | null
  const [err, setErr] = useState("")
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { setRows((await api.getSpuRules() as any) || []) } catch { setRows([]) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const save = async () => {
    setErr("")
    if (!edit.name || !edit.code) { setErr("名称和编码不能为空"); return }
    setSaving(true)
    try {
      if (edit.id) await api.updateSpuRule(edit.id, { name: edit.name, code: edit.code, remark: edit.remark })
      else await api.createSpuRule({ name: edit.name, code: edit.code, remark: edit.remark })
      setEdit(null); load()
    } catch (e: any) { setErr(e?.message || "保存失败") }
    setSaving(false)
  }
  const del = async (r: any) => { if (confirm(`删除 SPU 规则「${r.name}」？`)) { await api.deleteSpuRule(r.id); load() } }

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">🏷️ SPU规则 <span className="page-subtitle">SKU 编码前缀，转入商品时用于自动生成 SKU</span></h1>
        <button className="btn btn-primary" onClick={() => { setErr(""); setEdit({ name: "", code: "", remark: "" }) }}>+ 新建规则</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>名称</th><th style={{ width: 160 }}>编码</th><th>备注</th><th style={{ width: 120 }}>操作</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="table-empty"><div className="spinner" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={4} className="table-empty"><div className="empty-icon">🏷️</div>暂无 SPU 规则，点击「+ 新建规则」</td></tr>
              ) : rows.map(r => (
                <tr key={r.id}>
                  <td><strong>{r.name}</strong></td>
                  <td><code style={{ background: "#f1f5f9", padding: "2px 6px", borderRadius: 4 }}>{r.code}</code></td>
                  <td style={{ color: "var(--gray-500)", fontSize: ".82rem" }}>{r.remark || "—"}</td>
                  <td>
                    <div style={{ display: "flex", gap: 8, fontSize: ".8rem" }}>
                      <a style={{ color: "var(--primary, #6366f1)", cursor: "pointer" }} onClick={() => { setErr(""); setEdit({ ...r }) }}>编辑</a>
                      <a style={{ color: "var(--red)", cursor: "pointer" }} onClick={() => del(r)}>删除</a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {edit && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99, padding: 24 }} onClick={() => !saving && setEdit(null)}>
          <div style={{ background: "#fff", borderRadius: 8, width: 420, maxWidth: "94vw", padding: 20, boxShadow: "0 8px 32px rgba(0,0,0,.2)" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>{edit.id ? "编辑 SPU 规则" : "新建 SPU 规则"}</div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--gray-600)" }}>名称</label>
              <input className="input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} style={{ width: "100%" }} placeholder="例如：女装 T 恤" />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--gray-600)" }}>编码（SKU 前缀）</label>
              <input className="input" value={edit.code} onChange={e => setEdit({ ...edit, code: e.target.value.toUpperCase() })} style={{ width: "100%" }} placeholder="例如：MK" />
              <div style={{ fontSize: ".72rem", color: "var(--gray-400)", marginTop: 3 }}>SKU = 编码 + 规格，如 MK-XL、MK-XL-RED</div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: ".78rem", fontWeight: 600, color: "var(--gray-600)" }}>备注</label>
              <textarea className="input" value={edit.remark || ""} onChange={e => setEdit({ ...edit, remark: e.target.value })} rows={2} style={{ width: "100%" }} />
            </div>
            {err && <div style={{ color: "var(--red)", fontSize: ".8rem", marginBottom: 8 }}>{err}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn btn-secondary" disabled={saving} onClick={() => setEdit(null)}>取消</button>
              <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? "保存中…" : "保存"}</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
