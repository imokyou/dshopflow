"use client"
import { useEffect, useState } from "react"
import Layout from "@/components/layout/Layout"
import { api } from "@/lib/api"

export default function ImportsPage() {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => { api.getImports().then(d => { setData(Array.isArray(d) ? d : []); setLoading(false) }).catch(() => setLoading(false)) }, [])

  const statusMap: Record<string, { cls: string; label: string }> = {
    pending: { cls: "badge-amber", label: "等待中" },
    completed: { cls: "badge-green", label: "已完成" },
    failed: { cls: "badge-red", label: "失败" },
    translating: { cls: "badge-blue", label: "翻译中" },
  }

  return (
    <Layout>
      <div className="page-header">
        <div><h1 className="page-title">🔄 导入任务</h1><p className="page-subtitle">追踪所有商品导入进度</p></div>
        <span style={{ color: "var(--gray-400)", fontSize: ".85rem" }}>共 {data.length} 条</span>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>状态</th><th>来源</th><th>时间</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={3} className="table-empty"><div className="spinner" /></td></tr> :
                data.map(t => {
                  const st = statusMap[t.status] || { cls: "badge-amber", label: t.status }
                  return (
                    <tr key={t.id}>
                      <td><span className={`badge ${st.cls}`}><span className="badge-dot" />{st.label}</span></td>
                      <td style={{ fontSize: ".85rem", maxWidth: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.source_url}</td>
                      <td style={{ color: "var(--gray-400)", fontSize: ".8rem" }}>{t.created_at ? new Date(t.created_at).toLocaleString("zh-CN") : "—"}</td>
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
