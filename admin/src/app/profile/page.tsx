"use client"
import { useEffect, useState } from "react"
import Layout from "@/components/layout/Layout"
import { api, clearTokens } from "@/lib/api"
import { useRouter } from "next/navigation"

export const dynamic = "force-dynamic"

export default function ProfilePage() {
  const [me, setMe] = useState<any>(null)
  const router = useRouter()

  useEffect(() => { api.getMe().then(setMe).catch(() => { }) }, [])

  const u = me?.user || {}
  const roleLabel = (r: string) => r === "super_admin" ? "超级管理员" : r === "manager" ? "管理者" : "团队成员"

  const Row = ({ label, value }: any) => (
    <div style={{ display: "flex", padding: "10px 0", borderBottom: "1px solid var(--gray-100)" }}>
      <div style={{ width: 120, color: "var(--gray-500)", fontSize: ".85rem" }}>{label}</div>
      <div style={{ fontSize: ".85rem", color: "var(--gray-800)" }}>{value ?? "—"}</div>
    </div>
  )

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">⚙️ 个人中心 <span className="page-subtitle">账户信息与设置</span></h1>
      </div>

      <div className="card" style={{ padding: 18, maxWidth: 560 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
          <span style={{ width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg,var(--primary),#8b5cf6)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.4rem", fontWeight: 700 }}>
            {(u.email || "U")[0]?.toUpperCase()}
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: "1rem" }}>{u.name || u.email || "—"}</div>
            <div style={{ fontSize: ".8rem", color: "var(--gray-400)" }}>{roleLabel(u.role)}</div>
          </div>
        </div>

        <Row label="邮箱" value={u.email} />
        <Row label="昵称" value={u.name} />
        <Row label="角色" value={roleLabel(u.role)} />
        <Row label="所属团队" value={me?.team?.name} />
        <Row label="套餐" value={me?.team?.plan_name} />
        <Row label="状态" value={u.is_active === false ? "已停用" : "正常"} />

        <div style={{ marginTop: 18, display: "flex", gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => router.push("/product-pool")}>返回选品池</button>
          <button className="btn btn-sm" style={{ background: "var(--red)", color: "#fff" }} onClick={() => { clearTokens(); router.push("/login") }}>退出登录</button>
        </div>
      </div>
    </Layout>
  )
}
