// 隔离单测：在 vm 沙箱里加载 content.js（桩掉 DOM/chrome），验证纯解析函数。
// 运行：node test_scrape.js
const fs = require("fs")
const vm = require("vm")
const path = require("path")

const code = fs.readFileSync(path.join(__dirname, "content.js"), "utf8")

// 最小桩：content.js 顶层只调用 chrome.runtime.onMessage.addListener
const noopList = { addListener() {} }
const ctx = {
  document: { querySelectorAll: () => [], querySelector: () => null, title: "", body: { innerText: "" } },
  window: { scrollY: 0, scrollTo() {} },
  location: { href: "https://detail.1688.com/offer/123.html" },
  chrome: { runtime: { onMessage: noopList } },
  setTimeout: (fn) => fn && fn(),
  console,
}
ctx.window = ctx.window
vm.createContext(ctx)
vm.runInContext(code, ctx)

let pass = 0, fail = 0
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log("  ✓", name) }
  else { fail++; console.error("  ✗", name, "\n     got :", g, "\n     want:", w) }
}
function ok(name, cond) {
  if (cond) { pass++; console.log("  ✓", name) }
  else { fail++; console.error("  ✗", name) }
}

console.log("parseSpecKey:")
eq("颜色:红色&gt;尺码:M", ctx.parseSpecKey("颜色:红色&gt;尺码:M"), ["红色", "M"])
eq("红色>M", ctx.parseSpecKey("红色>M"), ["红色", "M"])
eq("红色;M;XL", ctx.parseSpecKey("红色;M;XL"), ["红色", "M", "XL"])
eq("空", ctx.parseSpecKey(""), [])

console.log("parsePriceNum:")
eq("¥12.50", ctx.parsePriceNum("¥12.50"), 12.5)
eq("区间取最低", ctx.parsePriceNum("12.50-15.00"), 12.5)
eq("number", ctx.parsePriceNum(8), 8)
eq("无效", ctx.parsePriceNum("abc"), 0)

console.log("cartesian:")
eq("2x2", ctx.cartesian([["红", "蓝"], ["M", "L"]]), [["红", "M"], ["红", "L"], ["蓝", "M"], ["蓝", "L"]])
eq("单组", ctx.cartesian([["红", "蓝"]]), [["红"], ["蓝"]])
ok("上限 200", ctx.cartesian([Array.from({ length: 30 }, (_, i) => i), Array.from({ length: 30 }, (_, i) => i)]).length <= 200)

console.log("buildSkusFromModel — keyed skuInfoMap (颜色×尺码):")
const model = {
  skuProps: [
    { prop: "颜色", value: [{ name: "红色", imageUrl: "//cbu01.alicdn.com/red.jpg" }, { name: "蓝色", imageUrl: "//cbu01.alicdn.com/blue.jpg" }] },
    { prop: "尺码", value: [{ name: "M" }, { name: "L" }] },
  ],
  skuInfoMap: {
    "红色&gt;M": { price: "12.50", canBookCount: 100 },
    "红色&gt;L": { price: "13.00", canBookCount: 50 },
    "蓝色&gt;M": { price: "12.50", canBookCount: 0 },
    "蓝色&gt;L": { price: "13.00", canBookCount: 7 },
  },
}
const built = ctx.buildSkusFromModel(model, 9.9, 100)
eq("4 个 SKU", built.skus.length, 4)
eq("第一个 spec", built.skus[0].spec, "红色 / M")
eq("第一个 price", built.skus[0].price, 12.5)
eq("第一个 stock", built.skus[0].stock, 100)
ok("红色 SKU 取到红图", built.skus[0].image.includes("red.jpg"))
ok("蓝色 SKU 取到蓝图", built.skus[2].image.includes("blue.jpg"))
eq("2 个规格组", built.props.length, 2)

console.log("buildSkusFromModel — list 形态 specAttrs + 库存别名:")
const model2 = {
  skuProps: [{ propName: "颜色", propValues: [{ value: "黑" }] }],
  skuInfoList: [{ specAttrs: "颜色:黑", price: 20, saleableQuantity: 33 }],
}
const built2 = ctx.buildSkusFromModel(model2, 0, 100)
eq("1 个 SKU", built2.skus.length, 1)
eq("spec", built2.skus[0].spec, "黑")
eq("price", built2.skus[0].price, 20)
eq("stock(别名 saleableQuantity)", built2.skus[0].stock, 33)

console.log("buildSkusFromModel — 仅 props 无 info → 笛卡尔兜底:")
const model3 = { skuProps: [{ prop: "颜色", value: [{ name: "红" }, { name: "蓝" }] }], skuInfoMap: {} }
const built3 = ctx.buildSkusFromModel(model3, 5, 88)
eq("2 个 SKU(兜底)", built3.skus.length, 2)
eq("兜底价格", built3.skus[0].price, 5)
eq("兜底库存", built3.skus[0].stock, 88)

console.log("findSkuModel — 深层嵌套:")
const nested = { a: { b: { globalData: { skuModel: model } } }, c: [1, 2, 3] }
const found = ctx.findSkuModel([nested])
ok("找到 skuModel", found && Array.isArray(found.skuProps) && found.skuInfoMap)

console.log("findOfferImages — 取最长图数组 + 过滤图标:")
const data = {
  offer: {
    images: ["//cbu01.alicdn.com/a.jpg", "//cbu01.alicdn.com/b.jpg", "//gw.alicdn.com/icon-tps-16-16.png"],
    other: { imageList: [{ fullPathImageURI: "cbu01.alicdn.com/c.jpg" }] },
  },
}
const imgs = ctx.findOfferImages([data])
ok("取到 2 张主图(过滤掉 gw 图标)", imgs.length === 2 && imgs.every(u => /alicdn/.test(u)))
ok("规整为 800x800", imgs[0].includes("_800x800.jpg"))

console.log("balancedSlice / extractJsonObjects — 从脚本文本提取:")
const script = 'window.x = {"foo":1,"skuModel":{"skuProps":[],"skuInfoMap":{"a":{"price":1}}}}; var y=2;'
const objs = ctx.extractJsonObjects(script)
ok("提取到含 skuModel 的对象", objs.some(o => o && o.skuModel && o.skuModel.skuInfoMap))

console.log("isReviewOrThumb — 评价图/SKU缩略图 URL 特征:")
ok("评价图 -rate.jpg", ctx.isReviewOrThumb("https://cbu01.alicdn.com/x/11686018427383568-0-rate.jpg_b.jpg", null) === true)
ok("SKU色块 _sum.jpg", ctx.isReviewOrThumb("https://cbu01.alicdn.com/img/ibank/x_!!2217553439683-0-cib.jpg_sum.jpg", null) === true)
ok("正常主图不误杀", ctx.isReviewOrThumb("https://cbu01.alicdn.com/img/ibank/O1CN01fC_!!2217553439683-0-cib.jpg_800x800.jpg", null) === false)
ok("评价头像(年份/目录/id_id)", ctx.isReviewOrThumb("https://cbu01.alicdn.com/img/ibank/2020/428/378/22185873824_536529798.jpg", null) === true)
ok("详情cib图不误杀", ctx.isReviewOrThumb("https://cbu01.alicdn.com/img/ibank/o1cn010t2rep2an4rrckgux_!!2210477678190-0-cib.jpg", null) === false)
ok("平台推广图(!!0-0-cib)", ctx.isReviewOrThumb("https://cbu01.alicdn.com/img/ibank/O1CN01qNvHKO1Bs2s4zV4Re_!!0-0-cib.jpg_800x800.jpg", null) === true)
ok("真实商品图(非0会员id)不误杀", ctx.isReviewOrThumb("https://cbu01.alicdn.com/img/ibank/O1CN01vWe67u2AN4rt3JGfs_!!2210477678190-0-cib.jpg_800x800.jpg", null) === false)
ok("祖先 evaluation-content → 评价图", ctx.isReviewOrThumb("https://cbu01.alicdn.com/x.jpg", { parentElement: { className: "evaluate-images", parentElement: { className: "evaluation-content", parentElement: null } } }) === true)
ok("祖先 od-gallery-preview → 主图(不排除)", ctx.isReviewOrThumb("https://cbu01.alicdn.com/x.jpg", { parentElement: { className: "od-gallery-list", parentElement: { className: "od-gallery-preview", parentElement: null } } }) === false)

console.log("deepCollectImageUrls — 详情HTML内嵌长图 + 过滤评价/swatch:")
const apiResp = {
  description: '<div class="detail-desc">' + '商品详情图文描述，纯棉A类无骨空调服，适合0-3岁宝宝。'.repeat(8) +
    '<img src="https://cbu01.alicdn.com/img/ibank/detail1.jpg"/><p>说明</p><img src="https://cbu01.alicdn.com/img/ibank/detail2.png"></div>',
  skuModel: { skuImages: ["https://cbu01.alicdn.com/x_!!1-0-cib.jpg_sum.jpg"] },
  reviews: { pics: ["https://cbu01.alicdn.com/y-0-rate.jpg_b.jpg"] },
  shop: { logo: "https://gw.alicdn.com/tps-logo.png" },
}
const di = ctx.deepCollectImageUrls([apiResp])
ok("抓到 2 张详情长图", di.length === 2)
ok("详情图规整 800x800", di.every(u => u.includes("_800x800.jpg")))
ok("排除 swatch(_sum)/评价(-rate)/logo(gw)", !di.some(u => /_sum|-rate|gw\.alicdn/.test(u)))

console.log("findDescriptionHtml — 取最像图文详情的长HTML:")
const dh = ctx.findDescriptionHtml([apiResp])
ok("取到 description HTML", dh.includes("<img") && dh.includes("detail1.jpg"))

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} 通过, ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
