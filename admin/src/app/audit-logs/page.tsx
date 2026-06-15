"use client"
import { useEffect, useState } from "react"
import Layout from "@/components/layout/Layout"
import { api } from "@/lib/api"

export const dynamic = "force-dynamic"

const actionLabels: Record<string, string> = {
  "user.update": "编辑成员",
  "user.activate": "启用成员",
  "user.deactivate": "停用成员",
  "user.remove": "移除成员",
  "user.update_role": "修改角色",
}

export default function AuditLogsPage() {
  const [data, setData] = useState<any[]>([])
  useEffect(() => { api.getAuditLogs().then(d => setData(Array.isArray(d) ? d : [])).catch(() => {}) }, [])

  const fmtTime = (iso: string) => {
    if (!iso) return "—"
    const d = new Date(iso)
    return d.toLocaleString("zh-CN", { hour12: false })
  }

  return (
    <Layout>
      <div className="page-header"><h1 className="page-title">📋 审计日志</h1></div>
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>操作人</th><th>操作</th><th>对象</th><th>时间</th></tr></thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={4} className="table-empty"><div className="empty-icon">📋</div>暂无日志</td></tr>
              ) : data.map((r: any) => (
                <tr key={r.id}>
                  <td style={{ fontSize: ".85rem" }}>
                    {r.operator_name || r.operator_email || "—"}
                    {r.operator_email && r.operator_name && (
                      <span style={{ fontSize: ".75rem", color: "var(--gray-400)", marginLeft: 4 }}>{r.operator_email}</span>
                    )}
                  </td>
                  <td><span className="badge badge-blue">{actionLabels[r.action] || r.action}</span></td>
                  <td style={{ fontSize: ".85rem" }}>{r.entity_label || "—"}</td>
                  <td style={{ fontSize: ".8rem", color: "var(--gray-400)", whiteSpace: "nowrap" }}>{fmtTime(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  )
}
