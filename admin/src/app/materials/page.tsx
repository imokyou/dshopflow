"use client"
export const dynamic = "force-dynamic"

import { useCallback, useEffect, useRef, useState } from "react"
import Layout from "@/components/layout/Layout"
import { api } from "@/lib/api"
import { toast, toastError } from "@/lib/toast"

type Material = any

const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "待生成", color: "#b45309", bg: "#fffbeb" },
  running: { label: "生成中…", color: "#1d4ed8", bg: "#eff6ff" },
  done: { label: "已生成", color: "#15803d", bg: "#f0fdf4" },
  failed: { label: "失败", color: "#b91c1c", bg: "#fef2f2" },
}
const Badge = ({ s }: { s: string }) => {
  const st = STATUS[s] || { label: s, color: "#666", bg: "#f3f4f6" }
  return <span style={{ fontSize: ".72rem", fontWeight: 600, color: st.color, background: st.bg, padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap" }}>{st.label}</span>
}

export default function MaterialsPage() {
  const [data, setData] = useState<Material[]>([])
  const [counts, setCounts] = useState<any>({})
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [lightbox, setLightbox] = useState<string | null>(null)

  const setBusyId = (id: string, on: boolean) => setBusy(s => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n })

  const reqId = useRef(0)
  const load = useCallback(async () => {
    const seq = ++reqId.current
    setLoading(true)
    try {
      const p = new URLSearchParams()
      p.set("page", String(page)); p.set("page_size", "30")
      if (search) p.set("search", search)
      if (statusFilter) p.set("status", statusFilter)
      const d: any = await api.getMaterials(p.toString())
      if (seq === reqId.current) { setData(d.items || []); setTotal(d.total || 0); setCounts(d.counts || {}) }
    } catch (e) { if (seq === reqId.current) toastError(e, "加载素材失败") }
    finally { if (seq === reqId.current) setLoading(false) }
  }, [page, search, statusFilter])

  useEffect(() => { const t = setTimeout(() => load(), 300); return () => clearTimeout(t) }, [load])

  // 有待生成/生成中的素材时自动轮询刷新
  useEffect(() => {
    const pendingN = (counts.pending || 0) + (counts.running || 0)
    if (pendingN <= 0) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [counts, load])

  const regen = async (id: string) => {
    if (busy.has(id)) return
    setBusyId(id, true)
    try { await api.regenerateMaterial(id); toast("已重新提交生成", "success"); setTimeout(load, 800) }
    catch (e) { toastError(e, "重新生成失败") }
    finally { setBusyId(id, false) }
  }

  const saveDesc = async (id: string) => {
    setBusyId(id, true)
    try { await api.updateMaterial(id, { description: draft }); setEditId(null); toast("已保存", "success"); load() }
    catch (e) { toastError(e, "保存失败") }
    finally { setBusyId(id, false) }
  }

  const FILTERS = [
    ["", "全部"], ["done", `已生成 (${counts.done || 0})`],
    ["pending", `待生成 (${counts.pending || 0})`], ["running", `生成中 (${counts.running || 0})`],
    ["failed", `失败 (${counts.failed || 0})`],
  ] as const

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">🖼️ 素材库 <span className="page-subtitle">商品图片素材 + AI 视觉描述（GLM-4.7-FlashX）</span></h1>
        <button className="btn btn-ghost btn-sm" onClick={() => load()} disabled={loading}>{loading ? "⏳ 刷新中…" : "🔄 刷新"}</button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input className="input" placeholder="搜索 SPU / SKU / 描述…" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} style={{ width: 240 }} />
        <div style={{ display: "flex", gap: 4 }}>
          {FILTERS.map(([v, label]) => (
            <button key={v} className={`btn btn-sm ${statusFilter === v ? "btn-primary" : "btn-ghost"}`} onClick={() => { setStatusFilter(v); setPage(1) }}>{label}</button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th style={{ width: 64 }}>素材</th>
              <th style={{ width: 110 }}>SPU</th>
              <th style={{ width: 160 }}>SKU</th>
              <th>素材描述</th>
              <th style={{ width: 80 }}>状态</th>
              <th style={{ width: 140 }}>操作</th>
            </tr></thead>
            <tbody>
              {loading && data.length === 0 ? (
                <tr><td colSpan={6} className="table-empty"><div className="spinner" /></td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={6} className="table-empty"><div className="empty-icon">🖼️</div>暂无素材。从「选品池」转入商品时会自动生成素材并识图描述。</td></tr>
              ) : data.map(m => (
                <tr key={m.id}>
                  <td>
                    {m.image_url
                      ? <img src={m.image_url} alt="" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 4, cursor: "zoom-in" }} onClick={() => setLightbox(m.image_url)} onError={e => { (e.target as HTMLImageElement).style.opacity = ".3" }} />
                      : <span style={{ fontSize: 20 }}>📷</span>}
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: ".78rem", fontWeight: 600 }}>{m.spu || "—"}</td>
                  <td style={{ fontFamily: "monospace", fontSize: ".75rem", color: m.sku ? "var(--gray-700)" : "var(--gray-400)" }}>{m.sku || "（仅 SPU）"}</td>
                  <td style={{ fontSize: ".8rem", lineHeight: 1.5 }}>
                    {editId === m.id ? (
                      <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                        <textarea className="input" value={draft} onChange={e => setDraft(e.target.value)} rows={2} style={{ flex: 1 }} />
                        <button className="btn btn-primary btn-sm" disabled={busy.has(m.id)} onClick={() => saveDesc(m.id)}>保存</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditId(null)}>取消</button>
                      </div>
                    ) : m.status === "failed" ? (
                      <span style={{ color: "var(--red)", fontSize: ".75rem" }} title={m.error || ""}>生成失败：{(m.error || "").slice(0, 60) || "未知错误"}</span>
                    ) : m.description ? (
                      <span>{m.description}</span>
                    ) : (
                      <span style={{ color: "var(--gray-400)" }}>{m.status === "running" ? "AI 识图生成中…" : "待生成…"}</span>
                    )}
                  </td>
                  <td><Badge s={m.status} /></td>
                  <td>
                    <div style={{ display: "flex", gap: 8, fontSize: ".78rem", whiteSpace: "nowrap" }}>
                      <a style={{ color: "var(--primary, #6366f1)", cursor: busy.has(m.id) ? "default" : "pointer", opacity: busy.has(m.id) ? .5 : 1 }} onClick={() => regen(m.id)}>{busy.has(m.id) ? "…" : "重新生成"}</a>
                      <a style={{ color: "var(--gray-600)", cursor: "pointer" }} onClick={() => { setEditId(m.id); setDraft(m.description || "") }}>编辑</a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {total > 30 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", marginTop: 8, fontSize: ".8rem" }}>
          <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
          <span>第 {page} 页 / 共 {Math.ceil(total / 30)} 页（{total} 条）</span>
          <button className="btn btn-ghost btn-sm" disabled={page * 30 >= total} onClick={() => setPage(p => p + 1)}>下一页</button>
        </div>
      )}

      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <img src={lightbox} alt="" style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 8 }} />
        </div>
      )}
    </Layout>
  )
}
