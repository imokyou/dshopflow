"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Layout from "@/components/layout/Layout"
import { api, getToken } from "@/lib/api"

export default function TeamsPage() {
  const [data, setData] = useState<any[]>([])
  const [plans, setPlans] = useState<any[]>([])
  const [show, setShow] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editId, setEditId] = useState("")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [managerName, setManagerName] = useState("")
  const [planId, setPlanId] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // For non-super-admin: team detail
  const [myTeam, setMyTeam] = useState<any>(null)
  const [myMembers, setMyMembers] = useState<any[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [addEmail, setAddEmail] = useState("")
  const [addPassword, setAddPassword] = useState("")
  const [addName, setAddName] = useState("")
  const [addRole, setAddRole] = useState("member")
  const [addError, setAddError] = useState("")
  // Edit member
  const [showEditMember, setShowEditMember] = useState(false)
  const [editMemberId, setEditMemberId] = useState("")
  const [editMemberName, setEditMemberName] = useState("")
  const [editMemberEmail, setEditMemberEmail] = useState("")
  const [editMemberPassword, setEditMemberPassword] = useState("")
  const [editMemberRole, setEditMemberRole] = useState("")
  const [editMemberError, setEditMemberError] = useState("")
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const router = useRouter()

  useEffect(() => {
    const t = getToken()
    if (t) {
      try {
        const payload = JSON.parse(atob(t.split(".")[1]))
        if (payload.role !== "super_admin") {
          // 非超级管理员无权访问团队管理 → 跳转选品池
          setAllowed(false)
          router.replace("/product-pool")
          return
        }
        setIsSuperAdmin(true)
        setAllowed(true)
      } catch { setAllowed(false); router.replace("/product-pool"); return }
    } else { setAllowed(false); return }
    api.getTeams().then(d => setData(Array.isArray(d) ? d : []))
    api.getPlans().then(d => setPlans(Array.isArray(d) ? d : []))
  }, [])

  const loadMyData = async () => {
    try {
      const me = await api.getMe()
      setMyTeam(me.team)
      setMyMembers(me.members || [])
    } catch {}
  }

  const openCreate = () => { setEditMode(false); setEditId(""); setName(""); setEmail(""); setPassword(""); setManagerName(""); setPlanId(""); setError(""); setShow(true) }
  const openEdit = (t: any) => { setEditMode(true); setEditId(t.id); setName(t.name); setPlanId(t.plan_id || ""); setEmail(""); setPassword(""); setManagerName(""); setError(""); setShow(true) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError("")
    try {
      if (editMode) {
        await api.updateTeam(editId, { name, plan_id: planId || undefined })
      } else {
        await api.createTeam({ name, manager_email: email, manager_password: password, manager_name: managerName || undefined, plan_id: planId || undefined })
      }
      setShow(false); setData(await api.getTeams())
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const addMember = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setAddError("")
    try {
      await api.addMember({ team_id: myTeam.id, email: addEmail, password: addPassword, name: addName || undefined, role: addRole })
      setAddEmail(""); setAddPassword(""); setAddName(""); setAddRole("member"); setShowAdd(false)
      loadMyData()
    } catch (e: any) { setAddError(e.message) }
    finally { setLoading(false) }
  }

  const openEditMemberModal = (m: any) => {
    setEditMemberId(m.id); setEditMemberName(m.name || ""); setEditMemberEmail(m.email)
    setEditMemberPassword(""); setEditMemberRole(m.role); setEditMemberError(""); setShowEditMember(true)
  }

  const saveEditMember = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setEditMemberError("")
    try {
      const payload: any = {}
      if (editMemberName !== undefined) payload.name = editMemberName || undefined
      if (editMemberEmail) payload.email = editMemberEmail
      if (editMemberPassword) payload.password = editMemberPassword
      if (editMemberRole) payload.role = editMemberRole
      await api.updateMember(myTeam.id, editMemberId, payload)
      setShowEditMember(false); loadMyData()
    } catch (e: any) { setEditMemberError(e.message) }
    finally { setLoading(false) }
  }

  const toggleMember = async (userId: string) => {
    try { await api.toggleMemberActive(myTeam.id, userId); loadMyData() } catch {}
  }

  const roleLabel = (role: string) => {
    switch (role) { case "super_admin": return { text: "超管", cls: "badge-red" }; case "manager": return { text: "管理者", cls: "badge-blue" }; default: return { text: "成员", cls: "badge-gray" } }
  }

  // 非超级管理员：无权访问，跳转中占位
  if (allowed !== true) {
    return <Layout><div style={{ padding: 60, textAlign: "center", color: "var(--gray-400)" }}>无权访问团队管理，正在跳转…</div></Layout>
  }

  // ── Non-super-admin: show own team detail（已由上方守卫拦截，保留以防万一）──
  if (!isSuperAdmin) {
    return (
      <Layout>
        <div className="page-header">
          <div>
            <h1 className="page-title">👥 {myTeam?.name || "我的团队"}
              <span className="page-subtitle" style={{ marginLeft: 8 }}>· {myMembers.length} 人</span>
            </h1>
          </div>
          <button className="btn btn-primary" onClick={() => { setAddError(""); setShowAdd(true) }}>+ 添加成员</button>
        </div>

        <div className="stats-grid" style={{ marginBottom: 12 }}>
          <div className="stat-card"><div className="stat-label">套餐</div><div className="stat-value" style={{ fontSize: "1rem" }}>{myTeam?.plan_name || "免费"}</div></div>
          <div className="stat-card"><div className="stat-label">总成员</div><div className="stat-value">{myMembers.length}</div></div>
        </div>

        <div className="card">
          <div className="card-header"><span className="card-title">团队成员</span></div>
          <div className="table-wrap"><table>
            <thead><tr><th>姓名</th><th>邮箱</th><th>角色</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {myMembers.length === 0 ? <tr><td colSpan={5} className="table-empty"><div className="empty-icon">👥</div>暂无成员</td></tr>
                : myMembers.map((m: any) => {
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
                      <td>
                        {m.role !== "super_admin" && (
                          <div style={{ display: "flex", gap: 4 }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => openEditMemberModal(m)}>编辑</button>
                            <button className="btn btn-ghost btn-sm" style={{ color: m.is_active ? "var(--red)" : "var(--green)" }} onClick={() => toggleMember(m.id)}>
                              {m.is_active ? "停用" : "启用"}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table></div>
        </div>

        {/* Add member modal */}
        {showAdd && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99 }} onClick={() => setShowAdd(false)}>
            <div style={{ background: "#fff", borderRadius: 8, width: 440, padding: 20, boxShadow: "0 8px 32px rgba(0,0,0,.2)" }} onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}><strong>添加新成员</strong><button onClick={() => setShowAdd(false)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16 }}>✕</button></div>
              <form onSubmit={addMember}>
                <div className="form-group"><label>邮箱 *</label><input className="input" type="email" value={addEmail} onChange={e => setAddEmail(e.target.value)} required /></div>
                <div className="form-group"><label>昵称</label><input className="input" value={addName} onChange={e => setAddName(e.target.value)} placeholder="可选" /></div>
                <div className="form-group"><label>密码 *</label><input className="input" type="password" value={addPassword} onChange={e => setAddPassword(e.target.value)} required placeholder="至少6位" /></div>
                <div className="form-group"><label>角色</label><select className="input" value={addRole} onChange={e => setAddRole(e.target.value)}><option value="member">成员</option><option value="manager">管理者</option></select></div>
                {addError && <div style={{ background: "var(--red-50)", color: "var(--red-700)", padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 8 }}>{addError}</div>}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)}>取消</button><button type="submit" className="btn btn-primary" disabled={loading}>{loading ? "添加中..." : "添加"}</button></div>
              </form>
            </div>
          </div>
        )}

        {/* Edit member modal */}
        {showEditMember && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99 }} onClick={() => setShowEditMember(false)}>
            <div style={{ background: "#fff", borderRadius: 8, width: 440, padding: 20, boxShadow: "0 8px 32px rgba(0,0,0,.2)" }} onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}><strong>编辑成员</strong><button onClick={() => setShowEditMember(false)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16 }}>✕</button></div>
              <form onSubmit={saveEditMember}>
                <div className="form-group"><label>昵称</label><input className="input" value={editMemberName} onChange={e => setEditMemberName(e.target.value)} /></div>
                <div className="form-group"><label>邮箱</label><input className="input" type="email" value={editMemberEmail} onChange={e => setEditMemberEmail(e.target.value)} /></div>
                <div className="form-group"><label>新密码</label><input className="input" type="password" value={editMemberPassword} onChange={e => setEditMemberPassword(e.target.value)} placeholder="留空则不修改" /></div>
                <div className="form-group"><label>角色</label><select className="input" value={editMemberRole} onChange={e => setEditMemberRole(e.target.value)}><option value="member">成员</option><option value="manager">管理者</option></select></div>
                {editMemberError && <div style={{ background: "var(--red-50)", color: "var(--red-700)", padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 8 }}>{editMemberError}</div>}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><button type="button" className="btn btn-secondary" onClick={() => setShowEditMember(false)}>取消</button><button type="submit" className="btn btn-primary" disabled={loading}>{loading ? "保存中..." : "保存"}</button></div>
              </form>
            </div>
          </div>
        )}
      </Layout>
    )
  }

  // ── Super admin: show all teams ──
  return (
    <Layout>
      <div className="page-header"><h1 className="page-title">👥 用户管理</h1><button className="btn btn-primary" onClick={openCreate}>+ 新建团队</button></div>
      <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>团队名称</th><th>套餐</th><th>成员数</th><th>操作</th></tr></thead>
        <tbody>{data.map((r: any) => (
          <tr key={r.id}>
            <td><strong>{r.name}</strong></td>
            <td><span className="badge badge-blue"><span className="badge-dot"/>{r.plan_name || "未分配"}</span></td>
            <td>{r.member_count}</td>
            <td>
              <button className="btn btn-ghost btn-sm" onClick={() => openEdit(r)}>编辑</button>
              <button className="btn btn-ghost btn-sm" onClick={() => window.location.href = `/teams/${r.id}`}>查看成员</button>
            </td>
          </tr>
        ))}</tbody>
      </table></div></div>

      {show && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.4)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:99}} onClick={() => setShow(false)}>
          <div style={{background:"#fff",borderRadius:8,width:440,padding:20,boxShadow:"0 8px 32px rgba(0,0,0,.2)"}} onClick={e => e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:16}}><strong>{editMode ? "编辑团队" : "新建团队"}</strong><button onClick={() => setShow(false)} style={{border:"none",background:"none",cursor:"pointer",fontSize:16}}>✕</button></div>
            <form onSubmit={submit}>
              <div className="form-group"><label>团队名称 *</label><input className="input" value={name} onChange={e => setName(e.target.value)} required /></div>
              {!editMode && <>
                <div className="form-group"><label>管理者邮箱 *</label><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
                <div className="form-group"><label>管理者昵称</label><input className="input" value={managerName} onChange={e => setManagerName(e.target.value)} placeholder="可选" /></div>
                <div className="form-group"><label>管理者密码 *</label><input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="至少6位" /></div>
              </>}
              <div className="form-group">
                <label>绑定套餐</label>
                <select className="input" value={planId} onChange={e => setPlanId(e.target.value)}>
                  <option value="">不绑定套餐</option>
                  {plans.map(p => <option key={p.id} value={p.id}>{p.name} (${p.monthly_price}/月)</option>)}
                </select>
              </div>
              {error && <div style={{background:"var(--red-50)",color:"var(--red-700)",padding:"8px 12px",borderRadius:6,fontSize:12,marginBottom:8}}>{error}</div>}
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button type="button" className="btn btn-secondary" onClick={() => setShow(false)}>取消</button><button type="submit" className="btn btn-primary" disabled={loading}>{loading?"保存中...":editMode?"保存":"创建"}</button></div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  )
}
