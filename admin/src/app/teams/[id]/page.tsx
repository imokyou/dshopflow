"use client"
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Layout from "@/components/layout/Layout"
import { api } from "@/lib/api"

export const dynamic = "force-dynamic"

export default function TeamDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [team, setTeam] = useState<any>(null)
  const [members, setMembers] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  // Add modal
  const [showAdd, setShowAdd] = useState(false)
  const [addEmail, setAddEmail] = useState("")
  const [addPassword, setAddPassword] = useState("")
  const [addName, setAddName] = useState("")
  const [addRole, setAddRole] = useState("member")
  const [addError, setAddError] = useState("")

  // Edit modal
  const [showEdit, setShowEdit] = useState(false)
  const [editUserId, setEditUserId] = useState("")
  const [editName, setEditName] = useState("")
  const [editEmail, setEditEmail] = useState("")
  const [editPassword, setEditPassword] = useState("")
  const [editRole, setEditRole] = useState("")
  const [editError, setEditError] = useState("")

  useEffect(() => { loadData() }, [id])

  const loadData = async () => {
    try {
      const [t, m] = await Promise.all([api.getTeam(id as string), api.getTeamMembers(id as string)])
      setTeam(t); setMembers(Array.isArray(m) ? m : [])
    } catch {}
  }

  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setAddError("")
    try {
      await api.addMember({ team_id: id, email: addEmail, password: addPassword, name: addName || undefined, role: addRole })
      setAddEmail(""); setAddPassword(""); setAddName(""); setAddRole("member"); setShowAdd(false)
      loadData()
    } catch (e: any) { setAddError(e.message) }
    finally { setLoading(false) }
  }

  const openEditMember = (m: any) => {
    setEditUserId(m.id); setEditName(m.name || ""); setEditEmail(m.email)
    setEditPassword(""); setEditRole(m.role); setEditError(""); setShowEdit(true)
  }

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setEditError("")
    try {
      const payload: any = {}
      if (editName !== undefined) payload.name = editName || undefined
      if (editEmail) payload.email = editEmail
      if (editPassword) payload.password = editPassword
      if (editRole) payload.role = editRole
      await api.updateMember(id as string, editUserId, payload)
      setShowEdit(false); loadData()
    } catch (e: any) { setEditError(e.message) }
    finally { setLoading(false) }
  }

  const toggleActive = async (userId: string) => {
    setLoading(true)
    try { await api.toggleMemberActive(id as string, userId); loadData() }
    catch {}
    finally { setLoading(false) }
  }

  const roleLabel = (role: string) => {
    switch (role) {
      case "super_admin": return { text: "超管", cls: "badge-red" }
      case "manager": return { text: "管理者", cls: "badge-blue" }
      default: return { text: "成员", cls: "badge-gray" }
    }
  }

  if (!team) return <Layout><div style={{ padding: 32, textAlign: "center", color: "var(--gray-400)" }}>加载中...</div></Layout>

  return (
    <Layout>
      <div className="page-header">
        <div><h1 className="page-title">👥 {team.name}<span className="page-subtitle" style={{ marginLeft: 8 }}>· {members.length} 人</span></h1></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => router.push("/teams")}>← 返回</button>
          <button className="btn btn-primary" onClick={() => { setAddError(""); setShowAdd(true) }}>+ 添加成员</button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 12 }}>
        <div className="stat-card"><div className="stat-label">套餐</div><div className="stat-value" style={{ fontSize: "1rem" }}>{team.plan_name || "免费"}</div></div>
        <div className="stat-card"><div className="stat-label">总成员</div><div className="stat-value">{members.length}</div></div>
      </div>

      {/* Members table */}
      <div className="card">
        <div className="card-header"><span className="card-title">团队成员</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>姓名</th><th>邮箱</th><th>角色</th><th>状态</th><th>创建时间</th><th>更新时间</th><th>操作</th></tr></thead>
            <tbody>
              {members.length === 0 ? (
                <tr><td colSpan={7} className="table-empty"><div className="empty-icon">👥</div>暂无成员</td></tr>
              ) : members.map((m: any) => {
                const r = roleLabel(m.role)
                return (
                  <tr key={m.id} style={{ opacity: m.is_active ? 1 : 0.5 }}>
                    <td><strong>{m.name || "—"}</strong></td>
                    <td style={{ fontSize: ".85rem" }}>{m.email}</td>
                    <td><span className={"badge " + r.cls}><span className="badge-dot" />{r.text}</span></td>
                    <td>
                      <span className={"badge " + (m.is_active ? "badge-green" : "badge-red")} style={{ fontSize: ".75rem" }}>
                        <span className="badge-dot" />{m.is_active ? "正常" : "停用"}
                      </span>
                    </td>
                    <td style={{ fontSize: ".8rem", color: "var(--gray-400)", whiteSpace: "nowrap" }}>{m.created_at ? new Date(m.created_at).toLocaleString("zh-CN", { hour12: false }) : "—"}</td>
                    <td style={{ fontSize: ".8rem", color: "var(--gray-400)", whiteSpace: "nowrap" }}>{m.updated_at ? new Date(m.updated_at).toLocaleString("zh-CN", { hour12: false }) : "—"}</td>
                    <td>
                      {m.role !== "super_admin" && (
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => openEditMember(m)}>编辑</button>
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ color: m.is_active ? "var(--red)" : "var(--green)" }}
                            onClick={() => toggleActive(m.id)}
                          >
                            {m.is_active ? "停用" : "启用"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add member modal */}
      {showAdd && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99 }} onClick={() => setShowAdd(false)}>
          <div style={{ background: "#fff", borderRadius: 8, width: 440, padding: 20, boxShadow: "0 8px 32px rgba(0,0,0,.2)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}><strong>添加新成员</strong><button onClick={() => setShowAdd(false)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16 }}>✕</button></div>
            <form onSubmit={add}>
              <div className="form-group"><label>邮箱 *</label><input className="input" type="email" value={addEmail} onChange={e => setAddEmail(e.target.value)} required /></div>
              <div className="form-group"><label>昵称</label><input className="input" value={addName} onChange={e => setAddName(e.target.value)} placeholder="可选" /></div>
              <div className="form-group"><label>密码 *</label><input className="input" type="password" value={addPassword} onChange={e => setAddPassword(e.target.value)} required placeholder="至少6位" /></div>
              <div className="form-group">
                <label>角色</label>
                <select className="input" value={addRole} onChange={e => setAddRole(e.target.value)}>
                  <option value="member">成员</option>
                  <option value="manager">管理者</option>
                </select>
              </div>
              {addError && <div style={{ background: "var(--red-50)", color: "var(--red-700)", padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 8 }}>{addError}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)}>取消</button><button type="submit" className="btn btn-primary" disabled={loading}>{loading ? "添加中..." : "添加"}</button></div>
            </form>
          </div>
        </div>
      )}

      {/* Edit member modal */}
      {showEdit && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99 }} onClick={() => setShowEdit(false)}>
          <div style={{ background: "#fff", borderRadius: 8, width: 440, padding: 20, boxShadow: "0 8px 32px rgba(0,0,0,.2)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}><strong>编辑成员</strong><button onClick={() => setShowEdit(false)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16 }}>✕</button></div>
            <form onSubmit={saveEdit}>
              <div className="form-group"><label>昵称</label><input className="input" value={editName} onChange={e => setEditName(e.target.value)} /></div>
              <div className="form-group"><label>邮箱</label><input className="input" type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} /></div>
              <div className="form-group"><label>新密码</label><input className="input" type="password" value={editPassword} onChange={e => setEditPassword(e.target.value)} placeholder="留空则不修改" /></div>
              <div className="form-group">
                <label>角色</label>
                <select className="input" value={editRole} onChange={e => setEditRole(e.target.value)}>
                  <option value="member">成员</option>
                  <option value="manager">管理者</option>
                </select>
              </div>
              {editError && <div style={{ background: "var(--red-50)", color: "var(--red-700)", padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 8 }}>{editError}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><button type="button" className="btn btn-secondary" onClick={() => setShowEdit(false)}>取消</button><button type="submit" className="btn btn-primary" disabled={loading}>{loading ? "保存中..." : "保存"}</button></div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  )
}
