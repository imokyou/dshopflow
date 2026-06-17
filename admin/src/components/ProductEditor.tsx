"use client"
import { useEffect, useRef, useState } from "react"
import { api } from "@/lib/api"

const cartesian = (lists: string[][]): string[][] =>
  lists.reduce<string[][]>((acc, l) => acc.flatMap(a => l.map(v => [...a, v])), [[]])

// SKU 生成规则：SPU + 各规格值（用 - 连接）。无 SPU 时回退到原有 SKU。
const skuFor = (spu: string, combo: (string | null | undefined)[], fallback = ""): string => {
  const parts = combo.filter(Boolean) as string[]
  if (!spu) return fallback
  return [spu, ...parts].join("-")
}

function buildVariants(options: any[], prev: any[], spu = ""): any[] {
  const valid = options.filter(o => o.name && (o.values || []).length).slice(0, 3)
  const prevByKey: Record<string, any> = {}
  ;(prev || []).forEach(v => { prevByKey[[v.option1, v.option2, v.option3].filter(Boolean).join(" / ")] = v })
  if (valid.length === 0) {
    const ex = prev?.[0] || {}
    return [{ title: "Default", option1: null, option2: null, option3: null, price: ex.price ?? "", compare_at_price: ex.compare_at_price ?? "", sku: skuFor(spu, [], ex.sku ?? ""), inventory_quantity: ex.inventory_quantity ?? 0, barcode: ex.barcode ?? "" }]
  }
  return cartesian(valid.map(o => o.values)).map(combo => {
    const key = combo.join(" / ")
    const ex = prevByKey[key] || {}
    return { title: key, option1: combo[0] ?? null, option2: combo[1] ?? null, option3: combo[2] ?? null, price: ex.price ?? "", compare_at_price: ex.compare_at_price ?? "", sku: skuFor(spu, combo, ex.sku ?? ""), inventory_quantity: ex.inventory_quantity ?? 0, barcode: ex.barcode ?? "" }
  })
}

function RichEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (ref.current && ref.current.innerHTML !== (value || "")) ref.current.innerHTML = value || "" }, [])
  const cmd = (c: string, val?: string) => { document.execCommand(c, false, val); ref.current?.focus(); onChange(ref.current?.innerHTML || "") }
  const Btn = ({ c, val, children }: any) => (
    <button type="button" className="btn btn-ghost btn-sm" onMouseDown={e => { e.preventDefault(); cmd(c, val) }}>{children}</button>
  )
  return (
    <div style={{ border: "1px solid var(--gray-200)", borderRadius: 6 }}>
      <div style={{ display: "flex", gap: 2, padding: 4, borderBottom: "1px solid var(--gray-200)", flexWrap: "wrap" }}>
        <Btn c="bold"><b>B</b></Btn>
        <Btn c="italic"><i>I</i></Btn>
        <Btn c="underline"><u>U</u></Btn>
        <Btn c="insertUnorderedList">• 列表</Btn>
        <Btn c="insertOrderedList">1. 列表</Btn>
        <Btn c="formatBlock" val="h3">标题</Btn>
        <Btn c="formatBlock" val="p">正文</Btn>
        <button type="button" className="btn btn-ghost btn-sm" onMouseDown={e => { e.preventDefault(); const u = prompt("链接地址"); if (u) cmd("createLink", u) }}>链接</button>
      </div>
      <div ref={ref} contentEditable suppressContentEditableWarning onInput={e => onChange(e.currentTarget.innerHTML)}
        style={{ minHeight: 140, padding: 10, fontSize: ".85rem", lineHeight: 1.6, outline: "none" }} />
    </div>
  )
}

const Field = ({ label, children, hint }: any) => (
  <div style={{ marginBottom: 12 }}>
    <label style={{ display: "block", fontSize: ".78rem", fontWeight: 600, color: "var(--gray-600)", marginBottom: 4 }}>{label}</label>
    {children}
    {hint && <div style={{ fontSize: ".72rem", color: "var(--gray-400)", marginTop: 3 }}>{hint}</div>}
  </div>
)
const Card = ({ title, children }: any) => (
  <div className="card" style={{ padding: 14, marginBottom: 12 }}>
    {title && <div style={{ fontWeight: 700, fontSize: ".85rem", marginBottom: 10 }}>{title}</div>}
    {children}
  </div>
)

export default function ProductEditor({ id, onClose, onSaved, onLoaded }: { id: string; onClose: () => void; onSaved: () => void; onLoaded?: (p: any) => void }) {
  const isNew = id === "new"
  const [form, setForm] = useState<any>(null)
  const [collections, setCollections] = useState<any[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState("")
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [imgSel, setImgSel] = useState<Set<number>>(new Set())
  const [spuRules, setSpuRules] = useState<any[]>([])
  const [spuRuleId, setSpuRuleId] = useState("")
  const [genningSpu, setGenningSpu] = useState(false)
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))

  const loadCollections = async () => { try { setCollections((await api.getCollections() as any) || []) } catch { setCollections([]) } }
  useEffect(() => { loadCollections() }, [])
  useEffect(() => { api.getSpuRules().then((r: any) => setSpuRules(Array.isArray(r) ? r : (r?.items || []))).catch(() => setSpuRules([])) }, [])

  const generateSpu = async () => {
    if (!spuRuleId) { setErr("请先选择 SPU 规则"); return }
    setErr(""); setGenningSpu(true)
    try {
      const r: any = await api.generateSpu(spuRuleId, isNew ? undefined : id)
      // 生成/更换 SPU 时，按规则 SKU = SPU + 规格 同步重算各变体 SKU
      setForm((f: any) => ({
        ...f, spu: r.spu, spu_code: r.spu_code,
        variants: (f.variants || []).map((v: any) => ({ ...v, sku: skuFor(r.spu, [v.option1, v.option2, v.option3]) })),
      }))
    } catch (e: any) { setErr(e?.message || "生成 SPU 失败") }
    finally { setGenningSpu(false) }
  }

  // 按当前 SPU + 规格重算所有变体 SKU（SPU 更新后手动刷新 SKU 款号）
  const regenSkus = () => {
    if (!form.spu) { setErr("请先生成或填写 SPU，再生成 SKU 款号"); return }
    setErr("")
    setForm((f: any) => ({ ...f, variants: (f.variants || []).map((v: any) => ({ ...v, sku: skuFor(f.spu, [v.option1, v.option2, v.option3]) })) }))
  }

  useEffect(() => {
    if (isNew) {
      setForm({ title: "", body_html: "", vendor: "", product_type: "", tags: "", seo_title: "", seo_description: "", status: "draft", options: [], variants: buildVariants([], []), images: [], collection_ids: [] })
    } else {
      api.getProduct(id).then((p: any) => {
        setForm({ ...p, options: p.options || [], variants: (p.variants?.length ? p.variants : buildVariants(p.options || [], [])), images: p.images || [], collection_ids: p.collection_ids || [] })
        onLoaded?.(p)
      })
    }
  }, [id])

  useEffect(() => {
    if (lightbox === null) return
    const total = form?.images?.length || 0
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null)
      else if (e.key === "ArrowRight") setLightbox(i => (i === null ? i : (i + 1) % total))
      else if (e.key === "ArrowLeft") setLightbox(i => (i === null ? i : (i - 1 + total) % total))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [lightbox, form])

  if (!form) return <div className="center" style={{ padding: 40 }}><div className="spinner" /></div>

  const addOption = () => set("options", [...form.options, { name: "", values: [] }])
  const updOption = (i: number, patch: any) => {
    const opts = form.options.map((o: any, idx: number) => idx === i ? { ...o, ...patch } : o)
    setForm((f: any) => ({ ...f, options: opts, variants: buildVariants(opts, f.variants, f.spu || "") }))
  }
  const delOption = (i: number) => {
    const opts = form.options.filter((_: any, idx: number) => idx !== i)
    setForm((f: any) => ({ ...f, options: opts, variants: buildVariants(opts, f.variants, f.spu || "") }))
  }
  const updVariant = (i: number, patch: any) => set("variants", form.variants.map((v: any, idx: number) => idx === i ? { ...v, ...patch } : v))

  const addImage = () => { const u = prompt("图片 URL"); if (u) set("images", [...form.images, { src: u, alt: "" }]) }
  const delImage = (i: number) => { set("images", form.images.filter((_: any, idx: number) => idx !== i)); setImgSel(new Set()) }
  const moveImage = (i: number, d: number) => {
    const arr = [...form.images]; const j = i + d; if (j < 0 || j >= arr.length) return
    ;[arr[i], arr[j]] = [arr[j], arr[i]]; set("images", arr); setImgSel(new Set())
  }
  const toggleImgSel = (i: number) => setImgSel(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })
  const batchDelImages = () => { set("images", form.images.filter((_: any, idx: number) => !imgSel.has(idx))); setImgSel(new Set()) }
  const allImgSelected = form.images.length > 0 && imgSel.size === form.images.length
  const toggleAllImg = () => setImgSel(allImgSelected ? new Set() : new Set(form.images.map((_: any, i: number) => i)))

  const toggleCollection = (cid: string) => set("collection_ids", form.collection_ids.includes(cid) ? form.collection_ids.filter((x: string) => x !== cid) : [...form.collection_ids, cid])
  const newCollection = async () => { const t = prompt("新合集名称"); if (!t) return; const c: any = await api.createCollection({ title: t }); await loadCollections(); set("collection_ids", [...form.collection_ids, c.id]) }

  const save = async (publishAfter?: boolean) => {
    setErr(""); setSaving(true)
    try {
      const payload = { ...form, variants: form.variants.map((v: any) => ({ ...v, price: v.price === "" ? null : Number(v.price), compare_at_price: v.compare_at_price === "" ? null : Number(v.compare_at_price), inventory_quantity: Number(v.inventory_quantity) || 0 })) }
      let saved: any
      if (isNew) saved = await api.createProduct(payload)
      else saved = await api.updateProduct(id, payload)
      if (publishAfter) await api.publishProduct(saved.id)
      onSaved()
    } catch (e: any) { setErr(e?.message || "保存失败"); setSaving(false) }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>← 返回</button>
        <h1 className="page-title" style={{ margin: 0 }}>{isNew ? "添加商品" : "编辑商品"}</h1>
        {form.source_url && (
          <a className="btn btn-ghost btn-sm" href={form.source_url} target="_blank" rel="noopener noreferrer" title="打开来源选品池的 1688 原始页面">🔗 原 1688 页面</a>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" disabled={saving} onClick={() => save(false)}>{saving ? "保存中…" : "保存"}</button>
          <button className="btn btn-primary" disabled={saving} onClick={() => save(true)}>保存并发布</button>
        </div>
      </div>
      {err && <div className="card" style={{ padding: 10, marginBottom: 12, color: "var(--red)", fontSize: ".82rem" }}>{err}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 12, alignItems: "start" }}>
        <div>
          <Card>
            <Field label="标题"><input className="input" value={form.title || ""} onChange={e => set("title", e.target.value)} placeholder="商品标题" style={{ width: "100%" }} /></Field>
            <Field label="描述"><RichEditor value={form.body_html || ""} onChange={v => set("body_html", v)} /></Field>
          </Card>

          <Card title="媒体">
            {form.images.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, fontSize: ".8rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                  <input type="checkbox" checked={allImgSelected} onChange={toggleAllImg} /> 全选（{form.images.length} 张）
                </label>
                {imgSel.size > 0 && (
                  <>
                    <span style={{ color: "var(--gray-500)" }}>已选 {imgSel.size} 张</span>
                    <button className="btn btn-sm" style={{ background: "var(--red)", color: "#fff" }} onClick={batchDelImages}>🗑 批量删除</button>
                    <a style={{ cursor: "pointer", color: "var(--gray-500)" }} onClick={() => setImgSel(new Set())}>清除选择</a>
                  </>
                )}
              </div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {form.images.map((im: any, i: number) => {
                const sel = imgSel.has(i)
                return (
                  <div key={i} style={{ position: "relative", width: 90, border: `1px solid ${sel ? "var(--primary)" : "var(--gray-200)"}`, boxShadow: sel ? "0 0 0 2px var(--primary-50)" : "none", borderRadius: 6, padding: 4 }}>
                    <input type="checkbox" checked={sel} onChange={() => toggleImgSel(i)}
                      style={{ position: "absolute", top: 6, left: 6, zIndex: 2, cursor: "pointer", width: 15, height: 15 }} />
                    <img src={im.src} alt="" title="点击查看原图" style={{ width: "100%", height: 72, objectFit: "cover", borderRadius: 4, cursor: "zoom-in" }} onClick={() => setLightbox(i)} onError={e => { (e.target as HTMLImageElement).style.opacity = ".3" }} />
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                      <span style={{ cursor: "pointer", fontSize: ".7rem" }} onClick={() => moveImage(i, -1)}>◀</span>
                      <span style={{ cursor: "pointer", fontSize: ".7rem", color: "var(--red)" }} onClick={() => delImage(i)}>删</span>
                      <span style={{ cursor: "pointer", fontSize: ".7rem" }} onClick={() => moveImage(i, 1)}>▶</span>
                    </div>
                  </div>
                )
              })}
              <button className="btn btn-ghost btn-sm" style={{ width: 90, height: 96, border: "1px dashed var(--gray-300)" }} onClick={addImage}>+ 添加图片</button>
            </div>
          </Card>

          <Card title="变体 / 规格">
            {form.options.map((o: any, i: number) => (
              <div key={i} style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <input className="input" placeholder="选项名(颜色/尺码)" value={o.name} onChange={e => updOption(i, { name: e.target.value })} style={{ width: 140 }} />
                <input className="input" placeholder="选项值，逗号分隔(红,蓝)" value={(o.values || []).join(",")} onChange={e => updOption(i, { values: e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean) })} style={{ flex: 1 }} />
                <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)" }} onClick={() => delOption(i)}>删</button>
              </div>
            ))}
            {form.options.length < 3 && <button className="btn btn-ghost btn-sm" onClick={addOption}>+ 添加选项</button>}

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, gap: 8 }}>
              <span style={{ fontSize: ".72rem", color: "var(--gray-400)" }}>SKU 规则：SPU + 规格（如 {form.spu ? form.spu : "MO00001"}-RED-80CM）</span>
              <button className="btn btn-secondary btn-sm" onClick={regenSkus} disabled={!form.spu} title={form.spu ? "按当前 SPU + 规格重算所有变体 SKU" : "请先生成或填写 SPU"}>🔄 生成 SKU 款号</button>
            </div>

            <table style={{ fontSize: ".75rem", marginTop: 8, width: "100%", tableLayout: "fixed" }}>
              <thead><tr>
                <th style={{ width: "28%" }}>变体</th>
                <th style={{ width: 72 }}>价格($)</th>
                <th style={{ width: 72 }}>划线价</th>
                <th style={{ width: "auto" }}>SKU</th>
                <th style={{ width: 64 }}>库存</th>
              </tr></thead>
              <tbody>
                {form.variants.map((v: any, i: number) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={v.title}>{v.title || "Default"}</td>
                    <td><input className="input" value={v.price ?? ""} onChange={e => updVariant(i, { price: e.target.value })} style={{ width: "100%" }} /></td>
                    <td><input className="input" value={v.compare_at_price ?? ""} onChange={e => updVariant(i, { compare_at_price: e.target.value })} style={{ width: "100%" }} /></td>
                    <td><input className="input" value={v.sku ?? ""} onChange={e => updVariant(i, { sku: e.target.value })} style={{ width: "100%" }} /></td>
                    <td><input className="input" value={v.inventory_quantity ?? 0} onChange={e => updVariant(i, { inventory_quantity: e.target.value })} style={{ width: "100%" }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card title="搜索引擎(SEO)">
            <Field label="SEO 标题"><input className="input" value={form.seo_title || ""} onChange={e => set("seo_title", e.target.value)} style={{ width: "100%" }} /></Field>
            <Field label="SEO 描述"><textarea className="input" value={form.seo_description || ""} onChange={e => set("seo_description", e.target.value)} rows={2} style={{ width: "100%" }} /></Field>
          </Card>
        </div>

        <div>
          <Card title="状态">
            <select className="input" value={form.status} onChange={e => set("status", e.target.value)} style={{ width: "100%" }}>
              <option value="draft">草稿</option>
              <option value="active">已上架</option>
              <option value="archived">已归档</option>
            </select>
          </Card>
          <Card title="SPU 款号">
            <Field label="SPU" hint={form.spu_code ? `规则代码：${form.spu_code}` : "规则代码 + 5 位自增序号，如 MK00001"}>
              <input className="input" value={form.spu || ""} onChange={e => set("spu", e.target.value)} placeholder="选规则后点「生成」，或手动填写" style={{ width: "100%", fontFamily: "monospace" }} />
            </Field>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select className="input" value={spuRuleId} onChange={e => setSpuRuleId(e.target.value)} style={{ flex: 1 }}>
                <option value="">选择 SPU 规则…</option>
                {spuRules.map((s: any) => <option key={s.id} value={s.id}>{s.name}（{s.code}）</option>)}
              </select>
              <button className="btn btn-secondary btn-sm" disabled={!spuRuleId || genningSpu} onClick={generateSpu} style={{ whiteSpace: "nowrap" }}>
                {genningSpu ? "生成中…" : "生成"}
              </button>
            </div>
            <div style={{ fontSize: ".72rem", color: "var(--gray-400)", marginTop: 6 }}>自动生成后仍可手动修改；保存时以输入框为准。</div>
          </Card>
          <Card title="商品组织">
            <Field label="供应商(Vendor)"><input className="input" value={form.vendor || ""} onChange={e => set("vendor", e.target.value)} style={{ width: "100%" }} /></Field>
            <Field label="商品类型"><input className="input" value={form.product_type || ""} onChange={e => set("product_type", e.target.value)} style={{ width: "100%" }} /></Field>
            <Field label="标签" hint="逗号分隔"><input className="input" value={form.tags || ""} onChange={e => set("tags", e.target.value)} style={{ width: "100%" }} /></Field>
            <Field label="合集">
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 140, overflow: "auto" }}>
                {collections.map((c: any) => (
                  <label key={c.id} style={{ display: "flex", gap: 6, fontSize: ".8rem", cursor: "pointer" }}>
                    <input type="checkbox" checked={form.collection_ids.includes(c.id)} onChange={() => toggleCollection(c.id)} />{c.title}
                  </label>
                ))}
                {collections.length === 0 && <span style={{ fontSize: ".75rem", color: "var(--gray-400)" }}>暂无合集</span>}
              </div>
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={newCollection}>+ 新建合集</button>
            </Field>
          </Card>
        </div>
      </div>

      {lightbox !== null && form.images[lightbox] && (
        <div onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ position: "absolute", top: 16, right: 20, color: "#fff", fontSize: 28, cursor: "pointer", lineHeight: 1 }} onClick={() => setLightbox(null)}>✕</span>
          <span style={{ position: "absolute", top: 18, left: 20, color: "#fff", fontSize: ".85rem" }}>{lightbox + 1} / {form.images.length}</span>
          {form.images.length > 1 && (
            <span onClick={e => { e.stopPropagation(); setLightbox((lightbox - 1 + form.images.length) % form.images.length) }}
              style={{ position: "absolute", left: 16, color: "#fff", fontSize: 44, cursor: "pointer", userSelect: "none", padding: "0 10px" }}>‹</span>
          )}
          <img src={form.images[lightbox].src} alt="" onClick={e => e.stopPropagation()}
            style={{ maxWidth: "88vw", maxHeight: "88vh", objectFit: "contain", borderRadius: 4, boxShadow: "0 4px 40px rgba(0,0,0,.5)" }} />
          {form.images.length > 1 && (
            <span onClick={e => { e.stopPropagation(); setLightbox((lightbox + 1) % form.images.length) }}
              style={{ position: "absolute", right: 16, color: "#fff", fontSize: 44, cursor: "pointer", userSelect: "none", padding: "0 10px" }}>›</span>
          )}
          <a href={form.images[lightbox].src} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
            style={{ position: "absolute", bottom: 16, color: "#cbd5e1", fontSize: ".78rem" }}>在新标签打开原图 ↗</a>
        </div>
      )}
    </div>
  )
}
