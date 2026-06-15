"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Layout from "@/components/layout/Layout"
import { api } from "@/lib/api"

export const dynamic = "force-dynamic"

export default function DashboardPage() {
  const [teams, setTeams] = useState<any[]>([])
  const router = useRouter()
  useEffect(() => { api.getTeams().then(d => setTeams(Array.isArray(d) ? d : [])).catch(() => {}) }, [])

  const totalMembers = teams.reduce((a, t) => a + (t.member_count || 0), 0)

  return (
    <Layout>
      <div className="page-header">
        <div><h1 className="page-title">📊 团队总览 <span className="page-subtitle">管理所有团队与数据</span></h1></div>
        <button className="btn btn-primary" onClick={() => router.push("/teams")}>+ 创建新团队</button>
      </div>

      <div className="stats-grid">
        <div className="stat-card"><div className="stat-label">团队总数</div><div className="stat-value">{teams.length}</div></div>
        <div className="stat-card"><div className="stat-label">总用户数</div><div className="stat-value">{totalMembers}</div></div>
        <div className="stat-card"><div className="stat-label">今日活跃</div><div className="stat-value">—</div></div>
        <div className="stat-card"><div className="stat-label">本月导入</div><div className="stat-value">—</div></div>
      </div>

      <div className="card">
        <div className="card-header"><span className="card-title">所有团队</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>团队名称</th><th>套餐</th><th>成员</th><th>创建时间</th><th>更新时间</th><th></th></tr></thead>
            <tbody>
              {teams.length === 0 ? (
                <tr><td colSpan={6} className="table-empty"><div className="empty-icon">📊</div>暂无团队</td></tr>
              ) : teams.map(t => (
                <tr key={t.id}>
                  <td><strong>{t.name}</strong></td>
                  <td><span className="badge badge-blue"><span className="badge-dot" />{t.plan_name || "免费"}</span></td>
                  <td>{t.member_count}</td>
                  <td style={{ color: "var(--gray-400)", fontSize: ".82rem" }}>{t.created_at || "—"}</td>
                  <td style={{ color: "var(--gray-400)", fontSize: ".82rem" }}>{t.updated_at || "—"}</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => router.push(`/teams/${t.id}`)}>进入团队 →</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  )
}
