"use client"
import { useEffect, useState } from "react"
import Layout from "@/components/layout/Layout"
import { api } from "@/lib/api"

const typeOptions = [
  { v: "deepseek", l: "DeepSeek", url: "https://api.deepseek.com/v1" },
  { v: "openai", l: "OpenAI", url: "https://api.openai.com/v1" },
  { v: "anthropic", l: "Anthropic", url: "https://api.anthropic.com" },
  { v: "google", l: "Google", url: "https://generativelanguage.googleapis.com/v1beta" },
  { v: "glm", l: "GLM (智谱)", url: "https://open.bigmodel.cn/api/paas/v4" },
]
const catOptions = [
  { v: "text", l: "文字 AI" },
  { v: "vision", l: "视觉 AI" },
]

export default function AIProvidersPage() {
  const [data, setData] = useState<any[]>([])
  const [show, setShow] = useState(false)
  const [editId, setEditId] = useState("")
  const [f, setF] = useState<any>({
    name: "", slug: "", provider_type: "deepseek", category: "text",
    api_base_url: "", api_key: "", default_model: "", priority: "0",
  })
  const [models, setModels] = useState<string[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => { load() }, [])

  const load = async () => {
    try { setData(await api.getAIProviders()) } catch {}
  }

  const resetForm = () => {
    setF({ name: "", slug: "", provider_type: "deepseek", category: "text",
      api_base_url: "", api_key: "", default_model: "", priority: "0" })
    setModels([])
  }

  const openCreate = () => { setEditId(""); resetForm(); setError(""); setShow(true) }

  const openEdit = (p: any) => {
    setEditId(p.id)
    setF({
      name: p.name || "", slug: p.slug || "",
      provider_type: p.provider_type || "deepseek",
      category: p.category || "text",
      api_base_url: p.api_base_url || "",
      api_key: "", default_model: p.default_model || "",
      priority: String(p.priority ?? 0),
    })
    const saved = p.available_models || []
    setModels(saved)
    setError(""); setShow(true)
    // 没保存过模型列表则自动拉取
    if (saved.length === 0 && p.api_base_url) {
      setFetchingModels(true)
      api.fetchModels(p.api_base_url, "", p.id).then(result => {
        const list = result.models || []
        // 保留当前 default_model
        if (p.default_model && !list.includes(p.default_model)) {
          list.unshift(p.default_model)
        }
        setModels(list)
        if (list.length > 0 && !p.default_model) {
          // 如果 category 是 vision 且有带 v 的模型，优先选视觉模型
          const visionModels = p.category === "vision" ? list.filter((m: string) => m.includes("v") || m.includes("vision")) : []
          const preferred = visionModels.length > 0 ? visionModels[0] : list[0]
          setF(prev => ({ ...prev, default_model: preferred }))
        }
      }).catch(() => {}).finally(() => setFetchingModels(false))
    }
  }

  const fetchModels = async () => {
    if (!f.api_base_url) { setError("请先填写 API Base URL"); return }
    setFetchingModels(true); setError("")
    try {
      const result = await api.fetchModels(f.api_base_url, f.api_key, editId || undefined)
      const list = result.models || []
      // 保留当前 default_model 在列表中，避免下拉框显示不一致
      if (f.default_model && !list.includes(f.default_model)) {
        list.unshift(f.default_model)
      }
      setModels(list)
      if (!f.default_model && list.length > 0) setF({ ...f, default_model: list[0] })
    } catch (e: any) { setError(e.message) }
    finally { setFetchingModels(false) }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError("")
    try {
      const payload: any = { ...f, priority: +f.priority, available_models: models }
      if (!editId) payload.api_key = f.api_key
      else if (!f.api_key) delete payload.api_key
      if (editId) await api.updateAIProvider(editId, payload)
      else await api.createAIProvider(payload)
      setShow(false); load()
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const toggle = async (id: string) => {
    try { await api.toggleAIProviderActive(id); load() } catch {}
  }

  const F = (l: string, k: string, t = "text", o?: any) => (
    <div className="form-group">
      <label>{l}</label>
      {t === "select"
        ? <select className="input" value={f[k] || ""} onChange={e => setF({ ...f, [k]: e.target.value })}>{o.map((x: any) => <option key={x.v} value={x.v}>{x.l}</option>)}</select>
        : <input className="input" type={t} value={f[k] || ""} onChange={e => setF({ ...f, [k]: e.target.value })} />}
    </div>
  )

  return (
    <Layout>
      <div className="page-header">
        <h1 className="page-title">🤖 AI 提供商</h1>
        <button className="btn btn-primary" onClick={openCreate}>+ 添加提供商</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>名称</th><th>Slug</th><th>类别</th><th>默认模型</th><th>优先级</th><th>模型数</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {data.map(p => (
                <tr key={p.id} style={{ opacity: p.is_active ? 1 : 0.5 }}>
                  <td><strong>{p.name}</strong></td>
                  <td style={{ fontSize: ".85rem", color: "var(--gray-500)" }}>{p.slug}</td>
                  <td>
                    <span className={"badge " + (p.category === "text" ? "badge-blue" : "badge-purple")}>
                      <span className="badge-dot" />{p.category === "text" ? "文字" : "视觉"}
                    </span>
                  </td>
                  <td style={{ fontSize: ".85rem", color: "var(--gray-500)" }}>{p.default_model || "—"}</td>
                  <td>{p.priority || 0}</td>
                  <td style={{ fontSize: ".8rem", color: "var(--gray-400)" }}>{(p.available_models || []).length || 0} 个</td>
                  <td>
                    <span className={"badge " + (p.is_active ? "badge-green" : "badge-red")} style={{ fontSize: ".75rem" }}>
                      <span className="badge-dot" />{p.is_active ? "启用" : "停用"}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(p)}>编辑</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: p.is_active ? "var(--red)" : "var(--green)" }} onClick={() => toggle(p.id)}>
                        {p.is_active ? "停用" : "启用"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {show && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 99 }} onClick={() => setShow(false)}>
          <div style={{ background: "#fff", borderRadius: 8, width: 460, maxHeight: "80vh", overflow: "auto", padding: 20, boxShadow: "0 8px 32px rgba(0,0,0,.2)" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <strong>{editId ? "编辑 AI 提供商" : "添加 AI 提供商"}</strong>
              <button onClick={() => setShow(false)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            <form onSubmit={submit}>
              {F("名称 *", "name")}
              {F("Slug *", "slug")}
              <div className="form-group">
                <label>类型</label>
                <select className="input" value={f.provider_type} onChange={e => {
                  const t = e.target.value
                  const opt = typeOptions.find(o => o.v === t)
                  setF({ ...f, provider_type: t, api_base_url: opt?.url || f.api_base_url })
                }}>
                  {typeOptions.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
              </div>
              {F("类别", "category", "select", catOptions)}
              {F("API Base URL *", "api_base_url")}
              <div className="form-group">
                <label>API Key{editId ? "" : " *"}</label>
                <input className="input" type="password" value={f.api_key} onChange={e => setF({ ...f, api_key: e.target.value })}
                  placeholder={editId ? "已设置，留空不修改" : ""} />
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  {models.length > 0 ? (
                    <div className="form-group">
                      <label>默认模型</label>
                      <select className="input" value={f.default_model} onChange={e => setF({ ...f, default_model: e.target.value })}>
                        {models.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  ) : (
                    F("默认模型 *", "default_model")
                  )}
                </div>
                <button type="button" className="btn btn-secondary" onClick={fetchModels} disabled={fetchingModels}
                  style={{ alignSelf: "flex-end", marginBottom: 10, whiteSpace: "nowrap" }}>
                  {fetchingModels ? "拉取中..." : models.length > 0 ? "🔄 重新拉取" : "📡 拉取模型列表"}
                </button>
              </div>
              {models.length > 0 && (
                <div style={{ fontSize: ".75rem", color: "var(--gray-400)", marginTop: -4, marginBottom: 4 }}>
                  已拉取 {models.length} 个模型
                </div>
              )}
              {F("优先级 (越大越优先)", "priority", "number")}
              {error && <div style={{ background: "var(--red-50)", color: "var(--red-700)", padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 8 }}>{error}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShow(false)}>取消</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? "保存中..." : "保存"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  )
}
