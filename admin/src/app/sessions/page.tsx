"use client"
import { useEffect, useState } from "react"
import Layout from "@/components/layout/Layout"
import { api } from "@/lib/api"

export default function SessionsPage() {
  const [data, setData] = useState<any[]>([])
  useEffect(() => { api.getSessions().then(d => setData(Array.isArray(d) ? d : [])).catch(() => {}) }, [])
  return (
    <Layout>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>🟢 在线监控 · {data.length} 人在线</h1>
      <div className="card" style={{ overflow: "hidden" }}>
        <table className="table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th>用户</th><th>团队</th><th>IP</th><th>活跃时间</th><th>操作</th></tr></thead>
          <tbody>{data.map((r: any) => (
            <tr key={r.user_id}>
              <td><strong>{r.email || r.user_id?.slice(0, 8)}</strong></td><td>{r.team_name || "—"}</td>
              <td style={{ fontSize: 12 }}>{r.ip_address || "—"}</td>
              <td style={{ fontSize: 12, color: "#94a3b8" }}>{r.last_activity_iso ? new Date(r.last_activity_iso).toLocaleTimeString("zh-CN") : "—"}</td>
              <td><button className="btn btn-sm btn-danger" onClick={() => api.kickUser(r.user_id).then(() => window.location.reload())}>强制下线</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Layout>
  )
}
