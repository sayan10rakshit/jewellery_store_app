"""HSN-based GST rules shared by bill preview, PDF generation, and syncing."""

from __future__ import annotations

from typing import Any

GOLD_HSN_CODES = {"71131910", "71131920", "71131930", "71131940", "71131960", "71131990", "71132000"}
GOLD_SEMI_MANUFACTURED_CODES = {"71081200", "71081300", "71082000", "71090000"}
GOLD_ARTICLES_CODES = {"71141910", "71141930", "71142010", "71142020", "71142030"}
SILVER_HSN_CODES = {"71131110", "71131120", "71131130", "71131190"}
SILVER_SEMI_MANUFACTURED_CODES = {"71069100", "71069210", "71069290", "71070000"}
SILVER_ARTICLES_CODES = {"71141110", "71141120"}
IMITATION_HSN_CODES = {"71179010", "71171990", "71179090", "71171100", "71171910", "71171920"}
PEARL_ARTICLES_HSN_CODES = {"71161000", "71162000"}
PEARL_LOOSE_HSN_CODES = {"71011010", "71011020", "71012100", "71012200"}
STONE_HSN_CODES = {
    "71039110", "71039120", "71039130", "71039911", "71039912", "71039913",
    "71039919", "71039921", "71039929", "71039931", "71039932", "71039939",
    "71039941", "71039942", "71039943", "71039944", "71039949", "71039951",
    "71039952", "71039959", "71039990",
}
ALL_GOLD_HSN_CODES = GOLD_HSN_CODES | GOLD_SEMI_MANUFACTURED_CODES | GOLD_ARTICLES_CODES
ALL_SILVER_HSN_CODES = SILVER_HSN_CODES | SILVER_SEMI_MANUFACTURED_CODES | SILVER_ARTICLES_CODES
ALL_STONE_CATEGORY_HSN_CODES = STONE_HSN_CODES | PEARL_ARTICLES_HSN_CODES | PEARL_LOOSE_HSN_CODES


def to_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def classify_hsn_code(hsn_code: Any) -> str:
    code = str(hsn_code or "").strip()
    if code in ALL_GOLD_HSN_CODES:
        return "gold"
    if code in ALL_SILVER_HSN_CODES:
        return "silver"
    if code in IMITATION_HSN_CODES:
        return "imitation"
    if code in ALL_STONE_CATEGORY_HSN_CODES:
        return "stone"
    return "other"


def tax_percent_for_hsn(hsn_code: Any) -> float:
    """Only the specified STONE HSN codes qualify for the reduced 0.25% GST."""
    return 0.25 if str(hsn_code or "").strip() in STONE_HSN_CODES else 3.0


def resolve_item_total(item: dict[str, Any]) -> float:
    negotiated_total = to_float(item.get("negotiated_total_amount"))
    tax_percent = tax_percent_for_hsn(item.get("hsn") or item.get("hsn_code"))
    if negotiated_total > 0:
        return round(negotiated_total / (1 + tax_percent / 100), 2)
    return round(
        to_float(item.get("gold_silver_amount"))
        + to_float(item.get("diamond_or_stone_amount"))
        + to_float(item.get("other_charges"))
        + to_float(item.get("making_charges")),
        2,
    )


def tax_groups(items: list[dict[str, Any]], discount: Any, *, is_igst: bool) -> list[dict[str, float]]:
    """Allocate the invoice discount across HSN groups before calculating GST."""
    lines = [(resolve_item_total(item), tax_percent_for_hsn(item.get("hsn") or item.get("hsn_code"))) for item in items]
    total = sum(amount for amount, _ in lines)
    discount_amount = min(max(to_float(discount), 0.0), total)
    grouped: dict[float, float] = {}
    for amount, rate in lines:
        taxable = max(amount - (discount_amount * amount / total if total else 0.0), 0.0)
        grouped[rate] = grouped.get(rate, 0.0) + taxable
    result: list[dict[str, float]] = []
    for rate in sorted(grouped, reverse=True):
        taxable = round(grouped[rate], 2)
        if is_igst:
            result.append({"rate": rate, "taxable": taxable, "sgst": 0.0, "cgst": 0.0, "igst": round(taxable * rate / 100, 2)})
        else:
            component_rate = rate / 2
            result.append({"rate": rate, "taxable": taxable, "sgst": round(taxable * component_rate / 100, 2), "cgst": round(taxable * component_rate / 100, 2), "igst": 0.0})
    return result
