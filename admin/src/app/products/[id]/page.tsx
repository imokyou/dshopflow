"use client"
import { useParams, useRouter } from "next/navigation"
import Layout from "@/components/layout/Layout"
import ProductEditor from "@/components/ProductEditor"
import { setTabTitle } from "@/lib/tabs"

export const dynamic = "force-dynamic"

export default function ProductEditPage() {
  const params = useParams()
  const router = useRouter()
  const id = String(params?.id || "")

  return (
    <Layout>
      <ProductEditor
        id={id}
        onClose={() => router.push("/products")}
        onSaved={() => router.push("/products")}
        onLoaded={(p) => { if (p?.title) setTabTitle(`/products/${id}`, p.title.slice(0, 16)) }}
      />
    </Layout>
  )
}
