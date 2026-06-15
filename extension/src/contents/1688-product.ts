import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["*://detail.1688.com/offer/*.html"],
  run_at: "document_idle",
}

export interface ProductData {
  title: string
  priceRange: string
  images: string[]
  skus: { spec: string; price: string; stock: string; image?: string }[]
  description: string
  offerId: string
  videoUrl?: string
}

function extractText(sel: string): string {
  try {
    const el = document.querySelector(sel)
    return el?.textContent?.trim() || ""
  } catch { return "" }
}

function extractAllImages(sel: string): string[] {
  try {
    const els = document.querySelectorAll(sel)
    return Array.from(els).map(el => (el as HTMLImageElement).src || el.getAttribute("data-src") || "").filter(Boolean)
  } catch { return [] }
}

function extractOfferId(): string {
  const m = location.href.match(/offer\/(\d+)\.html/)
  return m?.[1] || ""
}

async function scrapeProduct(): Promise<ProductData> {
  // Wait for dynamic content
  await new Promise(r => setTimeout(r, 1000))

  // Scroll to trigger lazy images
  window.scrollTo({ top: document.body.scrollHeight / 3, behavior: "smooth" })
  await new Promise(r => setTimeout(r, 500))

  // Try multiple selectors (1688 changes frequently)
  const title = extractText("h1[data-testid='title']") || extractText(".offer-title") || extractText("h1")
  const priceRange = extractText(".price-range") || extractText("[class*='price'] span")
  const images = extractAllImages(".main-image img") || extractAllImages("[class*='main-image'] img") || extractAllImages("img[src*='cbu01.alicdn.com']")
  const descEl = document.querySelector(".desc-content") || document.querySelector("[class*='description']")
  const description = descEl?.innerHTML || ""
  const offerId = extractOfferId()

  // Extract SKUs from table rows
  const skus: ProductData["skus"] = []
  const skuRows = document.querySelectorAll(".sku-item, [class*='sku'] tr, table[class*='sku'] tr")
  skuRows.forEach(row => {
    const cells = row.querySelectorAll("td")
    if (cells.length >= 2) {
      skus.push({
        spec: cells[0]?.textContent?.trim() || "",
        price: cells[1]?.textContent?.trim() || "",
        stock: cells[2]?.textContent?.trim() || "0",
        image: (cells[0]?.querySelector("img") as HTMLImageElement)?.src,
      })
    }
  })

  const videoUrl = (document.querySelector("video source") as HTMLSourceElement)?.src || undefined

  return { title, priceRange, images, skus, description, offerId, videoUrl }
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SCRAPE_PRODUCT") {
    scrapeProduct().then(data => sendResponse({ success: true, data })).catch(e => sendResponse({ success: false, error: e.message }))
    return true
  }
})
