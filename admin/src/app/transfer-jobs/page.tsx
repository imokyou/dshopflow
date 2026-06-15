"use client"
import { useCallback, useEffect, useState } from "react"
import Layout from "@/components/layout/Layout"
import { api } from "@/lib/api"

export const dynamic = "force-dynamic"

const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "⏳ 待处理", color: "#854d0e", bg: "#fef9c3" },
  running: { label: "🔄 处理中", color: "#1e40af", bg: "#dbeafe" },
  completed: { label: "✅ 完成", color: "#166534", bg: "#dcfce7" },
  failed: { label: "❌ 失败", color: "#991b1b", bg: "#fee2e2" },
}
const fmt = (s?: string) => (s ? new Date(s).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—")

export default function TransferJobsPage() {
  const [items, setItems] = useState<any[]>([])
  const [counts, setCounts] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("")
  const [auto, setAuto] = useState(true)

  const load = useCallback(async () => {
    try {
      const d: any = await api.getTransferJobs(200)
      setItems(d?.items || [])
      setCounts(d?.counts || {})
    } catch { }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!auto) return
    const t = setInterval(load, 2500)
    return () => clearInterval(t)
  }, [auto, load])

  const clearDone = async () => { if (confirm("清除所有已完成/失败的任务记录？")) { await api.clearTransferJobs(); load() } }

  const filtered = filter ? items.filter(j => j.status === filter) : items
  const active = (counts.pending || 0) + (counts.running || 0)

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">🕒 转入队列 <span className="page-subtitle">选品池 → 商品管理 的后台处理任务</span></h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>{loading ? "⏳ 刷新中…" : "🔄 刷新"}</button>
          <button className="btn btn-ghost btn-sm" onClick={clearDone}>🧹 清除已完成</button>
          <a className="btn btn-primary btn-sm" href="/products">前往商品管理</a>
        </div>
      </div>

      {/* 计数卡片 */}
      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        {(["pending", "running", "completed", "failed"] as const).map(k => (
          <div key={k} onClick={() => setFilter(filter === k ? "" : k)}
            style={{ cursor: "pointer", flex: "1 1 120px", padding: "10px 14px", borderRadius: 8, border: `1px solid ${filter === k ? STATUS[k].color : "var(--gray-200)"}`, background: STATUS[k].bg }}>
            <div style={{ fontSize: ".75rem", color: STATUS[k].color, fontWeight: 600 }}>{STATUS[k].label}</div>
            <div style={{ fontSize: "1.4rem", fontWeight: 700, color: STATUS[k].color }}>{counts[k] || 0}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <span style={{ fontSize: ".82rem", color: "var(--gray-500)" }}>
          {active > 0 ? `还有 ${active} 个任务在后台处理中…` : "队列空闲"}
          {filter && <> · 已筛选「{STATUS[filter]?.label}」 <a style={{ color: "var(--primary, #6366f1)", cursor: "pointer" }} onClick={() => setFilter("")}>清除</a></>}
        </span>
        <label style={{ marginLeft: "auto", fontSize: ".8rem", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> 自动刷新
        </label>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>商品标题</th><th style={{ width: 100 }}>状态</th>
              <th style={{ width: 150 }}>创建时间</th><th style={{ width: 150 }}>完成时间</th>
              <th>备注</th><th style={{ width: 90 }}>操作</th>
            </tr></thead>
            <tbody>
              {loading && items.length === 0 ? (
                <tr><td colSpan={6} className="table-empty"><div className="spinner" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="table-empty"><div className="empty-icon">🕒</div>暂无任务{filter ? "（当前筛选下）" : "，去选品池勾选商品并选「后台处理」转入"}</td></tr>
              ) : filtered.map(j => {
                const st = STATUS[j.status] || { label: j.status, color: "#475569", bg: "#f1f5f9" }
                return (
                  <tr key={j.id}>
                    <td style={{ fontWeight: 500 }}>{j.pool_title || "未命名"}</td>
                    <td><span style={{ fontSize: ".72rem", fontWeight: 600, color: st.color, background: st.bg, padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap" }}>{st.label}</span></td>
                    <td style={{ fontSize: ".72rem", color: "var(--gray-500)", whiteSpace: "nowrap" }}>{fmt(j.created_at)}</td>
                    <td style={{ fontSize: ".72rem", color: "var(--gray-500)", whiteSpace: "nowrap" }}>{fmt(j.completed_at)}</td>
                    <td style={{ fontSize: ".75rem", color: j.error ? "var(--red)" : "var(--gray-400)" }}>{j.error || (j.status === "completed" ? "已生成草稿" : "—")}</td>
                    <td>{j.status === "completed" && <a className="btn btn-ghost btn-sm" href="/products">查看</a>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  )
}
