"""轻量翻译服务：把中文标题/描述翻译为目标语言（商品管理模块用）。
复用 ProviderRouter；与选品池的翻译逻辑等价但独立，不改动选品池。
"""
import json
from app.integrations.llm.provider_router import ProviderRouter

LANG_NAME = {"en": "English", "de": "German", "fr": "French", "es": "Spanish", "ja": "Japanese"}


def _build_prompt(title_cn: str, desc_cn: str, target_lang: str) -> str:
    name = LANG_NAME.get(target_lang, target_lang)
    return f"""You are a professional e-commerce translator. Translate the following Chinese product information into native {name} suitable for a Shopify store.

**Title:**
{title_cn}

**Description:**
{desc_cn}

Return ONLY a valid JSON object with these fields:
{{
  "title": "SEO-optimized title under 70 characters",
  "description": "Marketing description (HTML allowed, <p> tags only)",
  "bullet_points": ["Feature 1", "Feature 2", "Feature 3", "Feature 4", "Feature 5"]
}}"""


def _parse(result: str, title_cn: str, desc_cn: str) -> dict:
    result = (result or "").strip()
    if result.startswith("```"):
        lines = result.split("\n")
        result = "\n".join(lines[1:]) if len(lines) > 1 else result
    if result.endswith("```"):
        result = result.rsplit("```", 1)[0]
    try:
        parsed = json.loads(result)
    except json.JSONDecodeError:
        return {"title": (title_cn or "")[:255], "description": desc_cn or "", "bullet_points": []}
    return {
        "title": (parsed.get("title") or title_cn or "")[:255],
        "description": parsed.get("description") or desc_cn or "",
        "bullet_points": parsed.get("bullet_points") or [],
    }


async def translate_terms(db, terms: list, language: str) -> dict:
    """把一批中文规格值（颜色/款式等）翻成简短英文，返回 {原文: 英文}。失败返回 {}。"""
    terms = [t for t in (terms or []) if t and str(t).strip()]
    if not terms:
        return {}
    name = LANG_NAME.get(language, language)
    numbered = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(terms))
    prompt = f"""Translate each Chinese product variant option value below into a SHORT {name} label (1-2 words, suitable for a product variant name and SKU). Keep any leading product code (like "PM04") unchanged. Drop filler like "短袖/翻领" if it's a pattern name; keep the core concept.
Return ONLY a JSON object mapping each original Chinese string to its translation, e.g. {{"原文":"Translation"}}.

{numbered}"""
    try:
        router = ProviderRouter(category="text")
        raw = (await router.call(db, prompt) or "").strip()
        if raw.startswith("```"):
            raw = "\n".join(raw.split("\n")[1:])
            if raw.endswith("```"):
                raw = raw.rsplit("```", 1)[0]
        data = json.loads(raw)
        return {str(k): str(v) for k, v in data.items()} if isinstance(data, dict) else {}
    except Exception:
        return {}


async def translate_product(db, title_cn: str, desc_cn: str, language: str) -> dict:
    """返回 {title, description, bullet_points}（目标语言）。失败时回退原文。"""
    title_cn = title_cn or ""
    desc_cn = desc_cn or ""
    if not title_cn and not desc_cn:
        return {"title": title_cn, "description": desc_cn, "bullet_points": []}
    try:
        router = ProviderRouter(category="text")
        raw = await router.call(db, _build_prompt(title_cn, desc_cn, language))
        return _parse(raw, title_cn, desc_cn)
    except Exception as e:
        return {"title": title_cn[:255], "description": desc_cn, "bullet_points": [], "error": str(e)}
