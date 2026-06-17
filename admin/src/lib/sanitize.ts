// 轻量 HTML 净化器（无第三方依赖，浏览器端运行）。
// 用途：渲染来自 1688 抓取 / AI 翻译 / 富文本编辑器的不可信 HTML 前过滤，
// 阻断存储型 XSS（<script>、on* 事件、javascript: 协议等）。
// 说明：基于浏览器 DOMParser，仅在客户端组件中调用；SSR/无 DOM 环境降级为纯文本转义。

const DANGEROUS_TAGS = new Set([
  "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META",
  "BASE", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "OPTION",
  "SVG", "MATH", "AUDIO", "VIDEO", "SOURCE", "TEMPLATE", "NOSCRIPT",
]);

// 允许保留的 URL 协议
const SAFE_URL = /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/|data:image\/)/i;

function escapeText(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cleanElement(el: Element) {
  // 移除所有事件处理属性、危险协议的 href/src/style
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const value = attr.value;
    if (name.startsWith("on")) {
      el.removeAttribute(attr.name);
      continue;
    }
    if ((name === "href" || name === "src" || name === "xlink:href") && !SAFE_URL.test(value.trim())) {
      el.removeAttribute(attr.name);
      continue;
    }
    // 去掉内联 style 里的 expression()/url(javascript:) 等
    if (name === "style" && /javascript:|expression\(|url\(\s*['"]?\s*javascript:/i.test(value)) {
      el.removeAttribute(attr.name);
    }
  }
  // 递归清理子节点；移除危险标签
  for (const child of Array.from(el.children)) {
    if (DANGEROUS_TAGS.has(child.tagName)) {
      child.remove();
    } else {
      cleanElement(child);
    }
  }
}

export function sanitizeHtml(dirty: string | null | undefined): string {
  if (!dirty) return "";
  if (typeof window === "undefined" || typeof window.DOMParser === "undefined") {
    // SSR 或无 DOM：退化为纯文本转义，绝不输出原始标签
    return escapeText(String(dirty));
  }
  try {
    const doc = new DOMParser().parseFromString(String(dirty), "text/html");
    const body = doc.body;
    // 先删顶层危险标签，再递归清理
    for (const child of Array.from(body.children)) {
      if (DANGEROUS_TAGS.has(child.tagName)) child.remove();
    }
    cleanElement(body);
    return body.innerHTML;
  } catch {
    return escapeText(String(dirty));
  }
}
