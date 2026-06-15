"""定价计算引擎。

按优先级匹配定价规则 → 汇率转换 → 阶梯加价 → 尾数处理 → 输出最终价格。
"""
import math
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models import PricingRule
from app.config import settings


class PricingEngine:
    """定价引擎：规则匹配 + 公式计算 + 尾数处理"""

    # 默认定价参数
    DEFAULT_MARKUP = 3.0  # 默认加价倍率
    PRICE_ENDINGS = {
        ".99": lambda p: math.floor(p) + 0.99,
        ".95": lambda p: math.floor(p) + 0.95,
        ".00": lambda p: round(p),
        ".49": lambda p: math.floor(p) + 0.49,
    }

    def __init__(self, team_id: str, exchange_rate: float = None):
        self.team_id = team_id
        self.exchange_rate = exchange_rate or settings.DEFAULT_EXCHANGE_RATE
        self._rules: list[PricingRule] | None = None

    async def load_rules(self, db: AsyncSession):
        """从 DB 加载该团队所有启用的定价规则（按 priority 排序）"""
        result = await db.scalars(
            select(PricingRule)
            .where(PricingRule.team_id == self.team_id, PricingRule.is_active == True)
            .order_by(PricingRule.priority.asc())
        )
        self._rules = list(result)

    @property
    def rules(self) -> list[PricingRule]:
        if self._rules is None:
            return []
        return self._rules

    def match_rule(self, price_cny: float, category: str = None) -> Optional[PricingRule]:
        """按 priority 匹配第一条符合条件的规则"""
        for rule in self.rules:
            if self._check_conditions(rule.conditions or [], price_cny, category):
                return rule
        return None

    def calculate(
        self, price_cny: float, category: str = None, matched_rule: PricingRule = None
    ) -> dict:
        """计算最终售价。

        Returns:
            {
                "cost_cny": float,
                "exchange_rate": float,
                "cost_usd": float,
                "markup": float,
                "price_usd": float,      # 未处理尾数
                "final_price": float,     # 尾数处理后
                "compare_at_price": float, # 划线价
                "profit": float,
                "rule_name": str,
            }
        """
        rule = matched_rule or self.match_rule(price_cny, category)
        formula = rule.formula if rule and rule.formula else {}

        # 1. 汇率
        rate = float(formula.get("exchange_rate", self.exchange_rate))
        cost_usd = price_cny / rate

        # 2. 加价倍率 — 支持阶梯定价
        markup = self._resolve_markup(formula, price_cny)

        # 3. 未处理售价
        raw_price = cost_usd * markup

        # 4. 尾数处理
        ending = formula.get("price_ending", ".99")
        final_price = self._apply_ending(raw_price, ending)

        # 5. 划线价（用于 Shopify compare-at-price）
        compare_mult = float(formula.get("compare_at_multiplier", 1.5))
        compare_price = self._apply_ending(final_price * compare_mult, ".99")

        # 6. 利润
        profit = final_price - cost_usd

        return {
            "cost_cny": round(price_cny, 2),
            "exchange_rate": round(rate, 4),
            "cost_usd": round(cost_usd, 2),
            "markup": round(markup, 2),
            "price_usd": round(raw_price, 2),
            "final_price": round(final_price, 2),
            "compare_at_price": round(compare_price, 2),
            "profit": round(profit, 2),
            "rule_name": rule.name if rule else "default",
        }

    def calculate_skus(
        self, skus: list[dict], category: str = None
    ) -> tuple[dict, list[dict]]:
        """计算所有 SKU 的价格。

        以最低价 SKU 作为商品主价格，其余 SKU 各算各的。

        Returns:
            (base_price_result, sku_results) — base_price 用于商品主价格
        """
        if not skus:
            return self.calculate(0), []

        results = []
        base_price_cny = float("inf")

        for sku in skus:
            try:
                price_str = str(sku.get("price", "0")).replace("¥", "").replace("¥", "").strip()
                price_cny = float(price_str)
            except (ValueError, TypeError):
                price_cny = 0

            base_price_cny = min(base_price_cny, price_cny)

            result = self.calculate(price_cny, category)
            results.append({**sku, "pricing": result})

        # 主商品价格 = 最低 SKU 价格
        base = self.calculate(base_price_cny, category) if base_price_cny != float("inf") else self.calculate(0)
        return base, results

    # ── Private helpers ──

    def _check_conditions(self, conditions: list[dict], price: float, category: str = None) -> bool:
        """检查是否满足所有条件（AND）"""
        for cond in conditions:
            field = cond.get("field", "")
            op = cond.get("op", "eq")
            value = cond.get("value")

            current = None
            if field == "price_min":
                current = price
            elif field == "price_max":
                current = price
            elif field == "category":
                current = category

            if current is None:
                continue

            if op == "gte":
                if current < value:
                    return False
            elif op == "lte":
                if current > value:
                    return False
            elif op == "eq":
                if current != value:
                    return False
            elif op == "contains":
                if value not in str(current):
                    return False

        return True

    def _resolve_markup(self, formula: dict, price_cny: float) -> float:
        """解析加价倍率：支持固定值和阶梯定价"""
        # 阶梯定价
        tiers = formula.get("tiers")
        if tiers:
            for tier in sorted(tiers, key=lambda t: t.get("max", float("inf"))):
                if price_cny <= tier.get("max", float("inf")):
                    return float(tier.get("multiplier", self.DEFAULT_MARKUP))

        # 固定倍率
        return float(formula.get("markup", self.DEFAULT_MARKUP))

    def _apply_ending(self, price: float, ending: str) -> float:
        """应用价格尾数"""
        fn = self.PRICE_ENDINGS.get(ending)
        if fn:
            return fn(price)
        # 自定义尾数格式 e.g. ".x9"
        if ending.startswith("."):
            try:
                frac = float(ending)
                return math.floor(price) + frac
            except ValueError:
                pass
        return round(price, 2)
