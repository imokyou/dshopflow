import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = { title: "DropShipFlow Admin", description: "1688 → Shopify One-Click Import" }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
