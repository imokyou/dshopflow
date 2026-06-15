"use client"
import { useState } from "react"

interface Field {
  name: string
  label: string
  type?: "text" | "number" | "email" | "select"
  options?: { label: string; value: string }[]
  required?: boolean
}

interface Props {
  title: string
  fields: Field[]
  onSubmit: (data: Record<string, any>) => Promise<void>
  onClose: () => void
}

export default function FormModal({ title, fields, onSubmit, onClose }: Props) {
  const [data, setData] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError("")
    try { await onSubmit(data); onClose() }
    catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 8, width: 480, maxWidth: "90vw", maxHeight: "80vh", overflow: "auto", boxShadow: "0 8px 32px rgba(0,0,0,.2)" }} onClick={e => e.stopPropagation()}>
        <div className="card-header">
          <span className="card-title">{title}</span>
          <button onClick={onClose} className="btn btn-ghost">✕</button>
        </div>
        <form onSubmit={submit} style={{ padding: "12px 16px" }}>
          {fields.map(f => (
            <div key={f.name} className="form-group">
              <label>{f.label}{f.required ? " *" : ""}</label>
              {f.type === "select" ? (
                <select className="input" value={data[f.name] || ""} onChange={e => setData({ ...data, [f.name]: e.target.value })} required={f.required}>
                  <option value="">请选择</option>
                  {f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input className="input" type={f.type || "text"} value={data[f.name] || ""} onChange={e => setData({ ...data, [f.name]: e.target.value })} required={f.required} />
              )}
            </div>
          ))}
          {error && <div style={{ background: "var(--red-50)", color: "var(--red-700)", padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 8 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? <span className="spinner" /> : "保存"}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
