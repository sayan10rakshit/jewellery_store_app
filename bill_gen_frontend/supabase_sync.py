from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any
import sys

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from shared.supabase_rest import SupabaseError, SupabaseRestClient
from tax_calculations import (
    ALL_GOLD_HSN_CODES,
    ALL_SILVER_HSN_CODES,
    ALL_STONE_CATEGORY_HSN_CODES,
    IMITATION_HSN_CODES,
    resolve_item_total as resolve_hsn_item_total,
    tax_groups,
)


def to_float(value: Any) -> float:
    if value in (None, ""):
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


STOCK_PROFIT_SELECT = (
    "id,hsn_code,purity,net_weight_g,weight_ratti,stone_amount,stone_expense,"
    "other_charges_amount,other_expenses,making_baseline,goldsmith_loss,"
    "gross_weight_g,stone_dust_deduction_g,stone_weight_g,making_charges_percent,"
    "silver_expense_entry_mode,silver_expense_price_per_gm,silver_cost_entry_mode,"
    "silver_cost_price_per_gm,silver_cost_total_price,silver_other_expenses,"
    "stone_expense_entry_mode,stone_expense_per_ratti,stone_cost_entry_mode,"
    "stone_cost_per_ratti"
)


def extract_purity_karat(value: Any) -> float | None:
    text = str(value or "").strip().upper()
    if not text:
        return None
    if text.endswith("K"):
        return to_float(text[:-1]) or None
    karat_map = {
        "999": 24.0,
        "916": 22.0,
        "750": 18.0,
        "585": 14.0,
        "375": 9.0,
    }
    if text in karat_map:
        return karat_map[text]
    return None


def classify_ornament(item: dict[str, Any]) -> str:
    hsn_code = str(item.get("hsn") or item.get("hsn_code") or "").strip()
    description = str(item.get("description") or "").strip().lower()
    if hsn_code in ALL_GOLD_HSN_CODES:
        return "gold"
    if hsn_code in ALL_SILVER_HSN_CODES:
        return "silver"
    if hsn_code in IMITATION_HSN_CODES:
        return "imitation"
    if hsn_code in ALL_STONE_CATEGORY_HSN_CODES:
        return "stone"
    if "silver" in description:
        return "silver"
    if "imitation" in description or "fashion" in description or "german silver" in description:
        return "imitation"
    if "stone" in description or "gem" in description or "ratti" in description:
        return "stone"
    if "gold" in description or extract_purity_karat(item.get("purity")):
        return "gold"
    return "other"


def first_positive(*values: Any) -> float:
    for value in values:
        numeric = to_float(value)
        if numeric > 0:
            return numeric
    return 0.0


def effective_line_total(item: dict[str, Any]) -> float:
    return first_positive(
        item.get("amount"),
        to_float(item.get("gold_silver_amount"))
        + to_float(item.get("diamond_or_stone_amount"))
        + to_float(item.get("other_charges"))
        + to_float(item.get("making_charges")),
    )


def derive_total_from_rate_or_total(rate: Any, total: Any, weight: Any) -> float:
    explicit_total = to_float(total)
    if explicit_total > 0:
        return explicit_total
    per_unit = to_float(rate)
    unit_count = to_float(weight)
    return round(per_unit * unit_count, 2) if per_unit > 0 and unit_count > 0 else 0.0


def values_differ(current: Any, proposed: Any, *, precision: int = 6) -> bool:
    """Compare database numeric values without generating no-op stock updates."""
    return round(to_float(current), precision) != round(to_float(proposed), precision)


def final_bill_stock_updates(item: dict[str, Any], stock_item: dict[str, Any]) -> dict[str, Any]:
    """Return stock fields whose customer-facing values changed on the final bill.

    The master portal's "Charged to Customer" and gold weight-breakup panels are
    calculated from stock_items.  A matched invoice line is the final source of
    truth once the bill is issued, so only changed values are carried back.
    """
    category = classify_ornament({**stock_item, **item})
    candidates: dict[str, Any] = {
        "stone_amount": to_float(item.get("diamond_or_stone_amount")),
        "other_charges_amount": to_float(item.get("other_charges")),
    }

    if category == "gold":
        # These are the inputs used by the master portal's Weight Breakup panel.
        candidates.update(
            {
                "gross_weight_g": to_float(item.get("gross_weight")),
                "stone_dust_deduction_g": to_float(item.get("stone_dust_deduction")),
                "net_weight_g": to_float(item.get("net_weight")),
                "stone_weight_g": to_float(item.get("diamond_or_stone_weight")),
                "making_charges_percent": to_float(item.get("making_charges_percent")),
            }
        )
    elif category == "silver":
        # Silver's customer cost is represented in the master portal as a
        # per-gram rate and/or a final total (shown as Making Charges in billing).
        candidates.update(
            {
                "silver_cost_price_per_gm": to_float(item.get("gold_silver_rate", item.get("rate_per_gram"))),
                "silver_cost_total_price": to_float(item.get("making_charges")),
            }
        )

    return {
        field: value
        for field, value in candidates.items()
        if values_differ(stock_item.get(field), value, precision=3 if field.endswith("_g") else 2)
    }


def compute_item_profit(item: dict[str, Any], stock_item: dict[str, Any] | None = None) -> tuple[float, float | None]:
    source = stock_item or {}
    cash_profit = round(
        (to_float(item.get("diamond_or_stone_amount")) + to_float(item.get("other_charges")))
        - (first_positive(item.get("stone_expense"), source.get("stone_expense")) + first_positive(item.get("other_expenses"), source.get("other_expenses"))),
        2,
    )
    category = classify_ornament({**source, **item})
    if category != "gold":
        if category == "silver":
            net_weight = first_positive(item.get("net_weight"), source.get("net_weight_g"))
            customer_cost_total = derive_total_from_rate_or_total(
                item.get("gold_silver_rate") or item.get("rate_per_gram"),
                item.get("gold_silver_amount"),
                net_weight,
            )
            artisan_expense_total = derive_total_from_rate_or_total(
                source.get("silver_expense_price_per_gm"),
                first_positive(item.get("other_expenses"), source.get("other_expenses")),
                net_weight,
            )
            if not customer_cost_total:
                customer_cost_total = derive_total_from_rate_or_total(
                    source.get("silver_cost_price_per_gm"),
                    source.get("silver_cost_total_price"),
                    net_weight,
                )
            cash_profit = round(
                (customer_cost_total - artisan_expense_total)
                + (to_float(item.get("diamond_or_stone_amount")) - first_positive(item.get("stone_expense"), source.get("stone_expense")))
                + (to_float(item.get("other_charges")) - to_float(source.get("silver_other_expenses"))),
                2,
            )
        elif category == "imitation":
            cash_profit = round(
                effective_line_total(item) - first_positive(item.get("other_expenses"), source.get("other_expenses")),
                2,
            )
        elif category == "stone":
            ratti = first_positive(source.get("weight_ratti"), item.get("diamond_or_stone_weight"))
            customer_cost_total = first_positive(
                item.get("amount"),
                item.get("diamond_or_stone_amount"),
                item.get("other_charges"),
            )
            if not customer_cost_total:
                customer_cost_total = derive_total_from_rate_or_total(source.get("stone_cost_per_ratti"), source.get("other_charges_amount"), ratti)
            artisan_expense_total = first_positive(item.get("other_expenses"), source.get("other_expenses"))
            if not artisan_expense_total:
                artisan_expense_total = derive_total_from_rate_or_total(source.get("stone_expense_per_ratti"), source.get("other_expenses"), ratti)
            cash_profit = round(customer_cost_total - artisan_expense_total, 2)
        return cash_profit, None

    net_weight = first_positive(item.get("net_weight"), source.get("net_weight_g"))
    making_percent = to_float(item.get("making_charges_percent"))
    baseline = first_positive(item.get("making_baseline"), source.get("making_baseline")) or 0.92
    artisan_loss = first_positive(item.get("goldsmith_loss"), source.get("goldsmith_loss"))
    purity_karat = extract_purity_karat(item.get("purity") or source.get("purity"))
    if not net_weight or purity_karat is None:
        return cash_profit, None
    excess_weight = net_weight * (((purity_karat / 24.0) * (1 + making_percent / 100)) - (baseline + artisan_loss / 100))
    return cash_profit, round(excess_weight, 3)


def parse_datetime(value: str | None) -> str | None:
    if not value:
        return None
    text = str(value).strip()
    formats = (
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d/%m/%Y",
    )
    for fmt in formats:
        try:
            return datetime.strptime(text, fmt).isoformat()
        except ValueError:
            continue
    return None


def parse_date(value: str | None) -> str | None:
    iso_value = parse_datetime(value)
    if not iso_value:
        return None
    return iso_value[:10]


def build_advance_receipt_description(items: list[dict[str, Any]]) -> str | None:
    descriptions: list[str] = []
    for item in items:
        parts = [str(item.get("description") or "").strip()]
        purity = str(item.get("purity") or "").strip()
        net_weight = to_float(item.get("net_weight"))
        gross_weight = to_float(item.get("gross_weight"))
        if purity:
            parts.append(purity)
        if net_weight > 0:
            parts.append(f"net {net_weight:g}g")
        elif gross_weight > 0:
            parts.append(f"gross {gross_weight:g}g")
        line = " | ".join(part for part in parts if part)
        if line:
            descriptions.append(line)
    if not descriptions:
        return None
    return "; ".join(descriptions[:3])


def calculate_round(total_before_old_gold: float) -> float:
    lower = int(total_before_old_gold)
    decimal = total_before_old_gold - lower
    return float(lower + 1 if decimal >= 0.5 else lower)


def summarize_payload(payload: dict[str, Any]) -> dict[str, float | bool]:
    items = payload.get("items", [])
    payment = payload.get("payment_info", {})
    settings = payload.get("document_settings", {})
    exchange_mode = str(settings.get("exchange_mode", "")).lower() in {"1", "true", "yes", "on"}
    if payload.get("document_type") == "receipt":
        total_amount = sum(to_float(item.get("amount")) for item in items)
        amount_received = to_float(payment.get("amount_received")) or (
            to_float(payment.get("cash_amount"))
            + to_float(payment.get("cheque_amount"))
            + to_float(payment.get("bank_amount"))
        )
        less_invoice_amount = to_float(payment.get("less_invoice_amount")) if exchange_mode else 0.0
        net_amount = max(total_amount - less_invoice_amount, 0.0)
        return {
            "items_total_amount": total_amount,
            "discount_amount": 0.0,
            "taxable_amount": total_amount,
            "sgst_amount": 0.0,
            "cgst_amount": 0.0,
            "igst_amount": 0.0,
            "total_tax_amount": 0.0,
            "gross_total": total_amount,
            "round_off_amount": 0.0,
            "old_gold_advance_amount": 0.0,
            "less_invoice_amount": less_invoice_amount,
            "net_amount": net_amount,
            "amount_received": amount_received,
            "balance_due_amount": max(net_amount - amount_received, 0.0),
            "is_igst": False,
        }

    total_amount = sum(resolve_hsn_item_total(item) for item in items)
    pos_gst_code = str(payload.get("customer_info", {}).get("place_of_supply_gst_code") or "19").strip()
    is_igst = pos_gst_code not in ("", "19")

    discount_amount = max(to_float(payment.get("discount")), 0.0)
    taxable_amount = max(total_amount - discount_amount, 0.0)
    groups = tax_groups(items, discount_amount, is_igst=is_igst)
    sgst_amount = round(sum(group["sgst"] for group in groups), 2)
    cgst_amount = round(sum(group["cgst"] for group in groups), 2)
    igst_amount = round(sum(group["igst"] for group in groups), 2)
    sgst_percent = round(sgst_amount * 100 / taxable_amount, 4) if not is_igst and taxable_amount else 0.0
    cgst_percent = round(cgst_amount * 100 / taxable_amount, 4) if not is_igst and taxable_amount else 0.0
    igst_percent = round(igst_amount * 100 / taxable_amount, 4) if is_igst and taxable_amount else 0.0

    total_tax_amount = round(sgst_amount + cgst_amount + igst_amount, 2)
    total_before_old_gold = taxable_amount + total_tax_amount
    rounded_total = calculate_round(total_before_old_gold)
    round_off_amount = round(rounded_total - total_before_old_gold, 2)
    old_gold_advance_amount = to_float(payment.get("old_gold_advance"))
    net_amount = max(round(rounded_total - old_gold_advance_amount, 2), 0.0)
    amount_received = to_float(payment.get("amount_received"))

    return {
        "items_total_amount": total_amount,
        "discount_amount": discount_amount,
        "taxable_amount": taxable_amount,
        "sgst_percent": sgst_percent,
        "sgst_amount": sgst_amount,
        "cgst_percent": cgst_percent,
        "cgst_amount": cgst_amount,
        "igst_amount": igst_amount,
        "igst_percent": igst_percent,
        "total_tax_amount": total_tax_amount,
        "gross_total": rounded_total,
        "round_off_amount": round_off_amount,
        "old_gold_advance_amount": old_gold_advance_amount,
        "net_amount": net_amount,
        "amount_received": amount_received,
        "balance_due_amount": max(net_amount - amount_received, 0.0),
        "is_igst": is_igst,
    }


def find_existing_customer_by_exact_details(client: SupabaseRestClient, row: dict[str, Any]) -> str | None:
    name = str(row.get("full_name") or "").strip()
    contact = str(row.get("primary_contact") or "").strip()
    email = str(row.get("email") or "").strip()
    filters: dict[str, str] = {}
    if name:
        filters["full_name"] = f"eq.{name}"
    if contact and contact != "N/A":
        filters["primary_contact"] = f"eq.{contact}"
    elif email:
        filters["email"] = f"eq.{email}"
    if not filters:
        return None

    existing = client.select_rows("customers", select="id", filters=filters, limit=1)
    return existing[0]["id"] if existing else None


def upsert_customer(client: SupabaseRestClient, payload: dict[str, Any]) -> str | None:
    customer = payload.get("customer_info", {})
    resolution = (payload.get("resolution") or {}).get("customer", {})
    resolution_mode = str(resolution.get("mode") or "new").strip()
    accepted_customer_id = str(resolution.get("customer_id") or "").strip()
    pan = str(customer.get("pan_aadhaar") or "").strip()
    contact = str(customer.get("contact") or "").strip()

    row = {
        "full_name": str(customer.get("name") or "").strip() or "Walk-in Customer",
        "primary_contact": contact or "N/A",
        "secondary_contact": str(customer.get("contact2") or "").strip() or None,
        "email": str(customer.get("email") or "").strip() or None,
        "address_line": str(customer.get("address") or "").strip() or None,
        "state_name": str(customer.get("state_name") or "").strip() or None,
        "state_gst_code": str(customer.get("state_gst_code") or "").strip() or None,
        "place_of_supply_name": str(customer.get("place_of_supply_name") or "").strip() or None,
        "place_of_supply_gst_code": str(customer.get("place_of_supply_gst_code") or "").strip() or None,
        "pincode": str(customer.get("pincode") or "").strip() or None,
        "pan_aadhaar_no": pan or None,
    }

    if accepted_customer_id and resolution_mode == "accepted":
        row["id"] = accepted_customer_id
        created = client.upsert_rows("customers", row, on_conflict="id")
        return created[0]["id"] if created else row["id"]

    exact_match_id = find_existing_customer_by_exact_details(client, row)
    if exact_match_id:
        row["id"] = exact_match_id
        created = client.upsert_rows("customers", row, on_conflict="id")
        return created[0]["id"] if created else exact_match_id

    try:
        created = client.insert_rows("customers", row)
        return created[0]["id"] if created else None
    except SupabaseError:
        # PAN / Aadhaar is unique. If the same person was rejected visually but the
        # government identifier already exists, merge into that exact person.
        if pan:
            existing = client.select_rows(
                "customers",
                select="id",
                filters={"pan_aadhaar_no": f"eq.{pan}"},
                limit=1,
            )
            if existing:
                row["id"] = existing[0]["id"]
                created = client.upsert_rows("customers", row, on_conflict="id")
                return created[0]["id"] if created else row["id"]
        raise


def lookup_invoice_id_by_number(client: SupabaseRestClient, invoice_no: str | None) -> str | None:
    value = (invoice_no or "").strip()
    if not value:
        return None
    rows = client.select_rows(
        "invoices",
        select="id",
        filters={"invoice_no": f"eq.{value}"},
        limit=1,
    )
    return rows[0]["id"] if rows else None


def lookup_receipt_id_by_number(client: SupabaseRestClient, receipt_no: str | None) -> str | None:
    value = (receipt_no or "").strip()
    if not value:
        return None
    rows = client.select_rows(
        "receipts",
        select="id",
        filters={"receipt_no": f"eq.{value}"},
        limit=1,
    )
    return rows[0]["id"] if rows else None


def replace_child_rows(
    client: SupabaseRestClient,
    *,
    table: str,
    parent_field: str,
    parent_id: str,
    rows: list[dict[str, Any]],
) -> None:
    client.delete_rows(table, filters={parent_field: f"eq.{parent_id}"})
    if rows:
        client.insert_rows(table, rows, returning=False)


def sync_payment_transaction(
    client: SupabaseRestClient,
    *,
    transaction_number: str,
    customer_id: str | None,
    direction: str,
    source_type: str,
    invoice_id: str | None = None,
    advance_receipt_id: str | None = None,
    receipt_id: str | None = None,
    payment_info: dict[str, Any],
    total_amount: float,
    adjustment_amount: float = 0.0,
    remarks: str | None,
) -> None:
    transaction_rows = client.upsert_rows(
        "payment_transactions",
        {
            "transaction_number": transaction_number,
            "transaction_datetime": parse_datetime(
                payment_info.get("transaction_datetime")
            ) or datetime.now().isoformat(),
            "customer_id": customer_id,
            "direction": direction,
            "source_type": source_type,
            "invoice_id": invoice_id,
            "advance_receipt_id": advance_receipt_id,
            "receipt_id": receipt_id,
            "total_amount": round(total_amount, 2),
            "remarks": remarks,
        },
        on_conflict="transaction_number",
    )
    if not transaction_rows:
        return

    transaction_id = transaction_rows[0]["id"]
    tender_rows: list[dict[str, Any]] = []

    tender_map = (
        ("cash", "cash_amount", None, None),
        ("upi", "upi_amount", None, None),
        ("card", "card_amount", "card_name", "card_number"),
        ("cheque", "cheque_amount", "cheque_bank_name", "cheque_number"),
        ("bank_transfer", "bank_amount", "bank_name", "account_number"),
    )
    for mode, amount_key, label_key, number_key in tender_map:
        amount = to_float(payment_info.get(amount_key))
        if amount <= 0:
            continue
        tender_rows.append(
            {
                "payment_transaction_id": transaction_id,
                "payment_mode": mode,
                "amount": round(amount, 2),
                "instrument_label": str(payment_info.get(label_key) or "").strip() or None,
                "instrument_number": str(payment_info.get(number_key) or "").strip() or None,
                "account_number": str(payment_info.get("account_number") or "").strip() or None,
            }
        )

    if adjustment_amount > 0:
        tender_rows.append(
            {
                "payment_transaction_id": transaction_id,
                "payment_mode": "adjustment",
                "amount": round(adjustment_amount, 2),
                "instrument_label": "Old Gold + Advance",
                "instrument_number": None,
                "account_number": None,
            }
        )

    replace_child_rows(
        client,
        table="payment_transaction_tenders",
        parent_field="payment_transaction_id",
        parent_id=transaction_id,
        rows=tender_rows,
    )


def upsert_document_file(
    client: SupabaseRestClient,
    *,
    document_type: str,
    document_id: str,
    pdf_path: str,
    pdf_url: str | None,
) -> None:
    file_name = Path(pdf_path).name
    existing = client.select_rows(
        "document_files",
        select="id",
        filters={
            "document_type": f"eq.{document_type}",
            "document_id": f"eq.{document_id}",
            "file_name": f"eq.{file_name}",
        },
        limit=1,
    )
    row = {
        "document_type": document_type,
        "document_id": document_id,
        "file_name": file_name,
        "file_path": pdf_url or pdf_path,
        "mime_type": "application/pdf",
    }
    if existing:
        row["id"] = existing[0]["id"]
        client.upsert_rows("document_files", row, on_conflict="id", returning=False)
    else:
        client.insert_rows("document_files", row, returning=False)


def mark_order_delivered_for_reference(
    client: SupabaseRestClient,
    *,
    order_number: str,
    document_type: str,
    document_id: str,
    document_no: str,
) -> None:
    """Close an Orderbook order as soon as an invoice or receipt names it."""
    reference = str(order_number or "").strip()
    if not reference:
        return
    matching_orders = client.select_rows(
        "orders",
        select="id,status",
        filters={"order_number": f"eq.{reference}"},
        limit=1,
    )
    if not matching_orders:
        return
    order = matching_orders[0]
    previous_status = str(order.get("status") or "pending_delivery")
    if previous_status == "delivered":
        return
    client.update_rows(
        "orders",
        {"status": "delivered"},
        filters={"id": f"eq.{order['id']}"},
        returning=False,
    )
    try:
        client.insert_rows(
            "order_lifecycle_events",
            {
                "order_id": order["id"],
                "event_type": "delivered",
                "from_status": previous_status,
                "to_status": "delivered",
                "details": {
                    f"{document_type}_id": document_id,
                    f"{document_type}_no": document_no,
                },
            },
            returning=False,
        )
    except SupabaseError as exc:
        # Keep invoice/receipt generation compatible with installations where
        # the optional lifecycle audit table has not yet been migrated.
        if "does not exist" not in str(exc) and "schema cache" not in str(exc):
            raise


def sync_invoice(
    client: SupabaseRestClient,
    payload: dict[str, Any],
    *,
    pdf_path: str,
    pdf_url: str | None,
) -> dict[str, Any]:
    summary = summarize_payload(payload)
    customer_id = upsert_customer(client, payload)
    customer = payload.get("customer_info", {})
    consignee = payload.get("consignee_info", {})
    invoice_info = payload.get("invoice_info", {})
    payment = payload.get("payment_info", {})
    linked_receipt_no = str(invoice_info.get("linked_receipt_no") or "").strip()
    linked_receipt_id = lookup_receipt_id_by_number(client, linked_receipt_no)

    invoice_rows = client.upsert_rows(
        "invoices",
        {
            "invoice_no": str(invoice_info.get("invoice_no") or "INVOICE").strip(),
            "customer_id": customer_id,
            "linked_reference_no": str(invoice_info.get("linked_reference_no") or "").strip() or None,
            "linked_receipt_id": linked_receipt_id,
            "invoice_datetime": parse_datetime(invoice_info.get("invoice_date")) or datetime.now().isoformat(),
            "source_order_date": parse_date(invoice_info.get("order_date")),
            "copy_type": str(invoice_info.get("copy_type") or "Original for Buyer").strip(),
            "customer_name": str(customer.get("name") or "").strip() or "Walk-in Customer",
            "customer_contact_primary": str(customer.get("contact") or "").strip() or None,
            "customer_contact_secondary": str(customer.get("contact2") or "").strip() or None,
            "customer_email": str(customer.get("email") or "").strip() or None,
            "customer_address": str(customer.get("address") or "").strip() or None,
            "customer_state_name": str(customer.get("state_name") or "").strip() or None,
            "customer_state_gst_code": str(customer.get("state_gst_code") or "").strip() or None,
            "place_of_supply_name": str(customer.get("place_of_supply_name") or "").strip() or None,
            "place_of_supply_gst_code": str(customer.get("place_of_supply_gst_code") or "").strip() or None,
            "customer_pincode": str(customer.get("pincode") or "").strip() or None,
            "customer_pan_aadhaar_no": str(customer.get("pan_aadhaar") or "").strip() or None,
            "consignee_name": str(consignee.get("name") or "").strip() or None,
            "consignee_contact_primary": str(consignee.get("contact") or "").strip() or None,
            "consignee_contact_secondary": str(consignee.get("contact2") or "").strip() or None,
            "consignee_address": str(consignee.get("address") or "").strip() or None,
            "consignee_state_name": str(consignee.get("state_name") or "").strip() or None,
            "consignee_state_gst_code": str(consignee.get("state_gst_code") or "").strip() or None,
            "consignee_pincode": str(consignee.get("pincode") or "").strip() or None,
            "consignee_pan_aadhaar_no": str(consignee.get("pan_aadhaar") or "").strip() or None,
            "items_total_amount": round(float(summary["items_total_amount"]), 2),
            "discount_amount": round(float(summary["discount_amount"]), 2),
            "taxable_amount": round(float(summary["taxable_amount"]), 2),
            "sgst_percent": round(float(summary.get("sgst_percent", 0.0)), 4),
            "sgst_amount": round(float(summary["sgst_amount"]), 2),
            "cgst_percent": round(float(summary.get("cgst_percent", 0.0)), 4),
            "cgst_amount": round(float(summary["cgst_amount"]), 2),
            "igst_percent": round(float(summary.get("igst_percent", 0.0)), 2),
            "igst_amount": round(float(summary["igst_amount"]), 2),
            "total_tax_amount": round(float(summary["total_tax_amount"]), 2),
            "gross_invoice_total": round(float(summary["gross_total"]), 2),
            "round_off_amount": round(float(summary["round_off_amount"]), 2),
            "old_gold_advance_amount": round(float(summary["old_gold_advance_amount"]), 2),
            "net_payable_amount": round(float(summary["net_amount"]), 2),
            "amount_received": round(float(summary["amount_received"]), 2),
            "balance_due_amount": round(float(summary["balance_due_amount"]), 2),
            "remarks": str(payment.get("remarks") or "").strip() or None,
            "narration": str(payment.get("narration") or "").strip() or None,
        },
        on_conflict="invoice_no",
    )
    invoice_id = invoice_rows[0]["id"]
    mark_order_delivered_for_reference(
        client,
        order_number=(
            str(invoice_info.get("linked_reference_no") or "").strip()
            or str(invoice_info.get("order_no") or "").strip()
        ),
        document_type="invoice",
        document_id=invoice_id,
        document_no=str(invoice_info.get("invoice_no") or "INVOICE").strip(),
    )
    if linked_receipt_id:
        client.update_rows(
            "receipts",
            {
                "linked_invoice_id": invoice_id,
            },
            filters={"id": f"eq.{linked_receipt_id}"},
            returning=False,
        )

    item_rows: list[dict[str, Any]] = []
    sold_stock_links: list[dict[str, Any]] = []
    accepted_stock_item_ids = [
        str(item.get("matched_stock_item_id") or "").strip()
        for item in payload.get("items", [])
        if str(item.get("matched_stock_item_id") or "").strip()
        and str(item.get("match_status") or "").strip() == "accepted"
    ]
    stock_profit_map: dict[str, dict[str, Any]] = {}
    if accepted_stock_item_ids:
        stock_rows = client.select_rows(
            "stock_items",
            select=STOCK_PROFIT_SELECT,
            filters={"id": f"in.({','.join(accepted_stock_item_ids)})"},
            limit=len(accepted_stock_item_ids),
        )
        stock_profit_map = {str(row.get("id") or "").strip(): row for row in stock_rows}
    for index, item in enumerate(payload.get("items", []), start=1):
        line_total = resolve_hsn_item_total(item)
        stock_item_id = str(item.get("matched_stock_item_id") or "").strip() or None
        match_status = str(item.get("match_status") or "").strip()
        quantity = max(int(float(item.get("quantity") or 1)), 1)
        cash_profit, excess_weight = compute_item_profit(item, stock_profit_map.get(stock_item_id or ""))
        if stock_item_id and match_status == "accepted":
            stock_item = stock_profit_map.get(stock_item_id or "", {})
            sold_stock_links.append(
                {
                    "stock_item_id": stock_item_id,
                    "quantity": quantity,
                    "cash_profit": cash_profit,
                    "excess_weight": excess_weight,
                    "final_bill_updates": final_bill_stock_updates(item, stock_item),
                }
            )
        item_rows.append(
            {
                "invoice_id": invoice_id,
                "stock_item_id": stock_item_id,
                "line_no": index,
                "stock_no": str(item.get("stock_no") or "").strip() or None,
                "huid": str(item.get("HUID") or "").strip() or None,
                "description": str(item.get("description") or "").strip() or f"Item {index}",
                "quantity": quantity,
                "hsn_code": str(item.get("hsn") or "").strip() or None,
                "purity": str(item.get("purity") or "").strip() or None,
                "gross_weight_g": to_float(item.get("gross_weight")),
                "stone_dust_deduction_g": to_float(item.get("stone_dust_deduction")),
                "net_weight_g": to_float(item.get("net_weight")),
                "gold_silver_rate": to_float(item.get("gold_silver_rate", item.get("rate_per_gram"))),
                "rate_per_gram": to_float(item.get("gold_silver_rate", item.get("rate_per_gram"))),
                "gold_silver_amount": to_float(item.get("gold_silver_amount")),
                "stone_weight_g": to_float(item.get("diamond_or_stone_weight")),
                "stone_amount": to_float(item.get("diamond_or_stone_amount")),
                "stone_expense": to_float(item.get("stone_expense")),
                "other_charges_amount": to_float(item.get("other_charges")),
                "making_charges_amount": to_float(item.get("making_charges")),
                "making_charges_percent": to_float(item.get("making_charges_percent")) or None,
                "making_baseline": to_float(item.get("making_baseline")) or None,
                "goldsmith_loss": to_float(item.get("goldsmith_loss")),
                "other_expenses": to_float(item.get("other_expenses")),
                "profit_cash_amount": cash_profit,
                "profit_excess_weight_g": excess_weight,
                "ornament_type": str(item.get("ornament_type") or "").strip() or None,
                "negotiated_total_amount_with_tax": to_float(item.get("negotiated_total_amount")) or None,
                "line_total_amount": round(line_total, 2),
            }
        )
    replace_child_rows(
        client,
        table="invoice_items",
        parent_field="invoice_id",
        parent_id=invoice_id,
        rows=item_rows,
    )

    sync_stock_status_for_invoice(
        client,
        invoice_id=invoice_id,
        invoice_no=str(invoice_info.get("invoice_no") or "INVOICE").strip(),
        sold_stock_links=sold_stock_links,
    )

    sync_payment_transaction(
        client,
        transaction_number=f"TXN-INVOICE-{invoice_info.get('invoice_no', 'INVOICE')}",
        customer_id=customer_id,
        direction="in",
        source_type="invoice",
        invoice_id=invoice_id,
        payment_info=payment,
        total_amount=float(summary["amount_received"]),
        adjustment_amount=float(summary.get("old_gold_advance_amount", 0.0)),
        remarks=str(payment.get("remarks") or "").strip() or None,
    )
    upsert_document_file(client, document_type="invoice", document_id=invoice_id, pdf_path=pdf_path, pdf_url=pdf_url)
    return {
        "document_type": "invoice",
        "document_id": invoice_id,
        "customer_id": customer_id,
    }


def sync_receipt(
    client: SupabaseRestClient,
    payload: dict[str, Any],
    *,
    pdf_path: str,
    pdf_url: str | None,
) -> dict[str, Any]:
    summary = summarize_payload(payload)
    customer_id = upsert_customer(client, payload)
    customer = payload.get("customer_info", {})
    invoice_info = payload.get("invoice_info", {})
    payment = payload.get("payment_info", {})
    workflow_context = payload.get("workflow_context", {})
    items = payload.get("items", [])
    linked_invoice_no = str(invoice_info.get("linked_invoice_no") or "").strip()
    linked_invoice_id = lookup_invoice_id_by_number(client, linked_invoice_no)
    advance_receipt_id = str(workflow_context.get("advance_receipt_id") or "").strip()

    receipt_rows = client.upsert_rows(
        "receipts",
        {
            "receipt_no": str(invoice_info.get("invoice_no") or "RECEIPT").strip(),
            "customer_id": customer_id,
            "linked_reference_no": str(invoice_info.get("linked_reference_no") or "").strip() or None,
            "linked_invoice_id": linked_invoice_id,
            "receipt_datetime": parse_datetime(invoice_info.get("invoice_date")) or datetime.now().isoformat(),
            "copy_type": str(invoice_info.get("copy_type") or "Original for Buyer").strip(),
            "customer_name": str(customer.get("name") or "").strip() or "Walk-in Customer",
            "customer_contact_primary": str(customer.get("contact") or "").strip() or None,
            "customer_contact_secondary": str(customer.get("contact2") or "").strip() or None,
            "customer_email": str(customer.get("email") or "").strip() or None,
            "customer_address": str(customer.get("address") or "").strip() or None,
            "customer_state_name": str(customer.get("state_name") or "").strip() or None,
            "customer_state_gst_code": str(customer.get("state_gst_code") or "").strip() or None,
            "customer_pincode": str(customer.get("pincode") or "").strip() or None,
            "customer_pan_aadhaar_no": str(customer.get("pan_aadhaar") or "").strip() or None,
            "gross_amount": round(float(summary["gross_total"]), 2),
            "less_invoice_amount": round(float(summary.get("less_invoice_amount", 0.0)), 2),
            "discount_amount": round(float(summary["discount_amount"]), 2),
            "round_off_amount": round(float(summary["round_off_amount"]), 2),
            "net_amount": round(float(summary["net_amount"]), 2),
            "amount_received": round(float(summary["amount_received"]), 2),
            "remarks": str(payment.get("remarks") or "").strip() or None,
            "narration": str(payment.get("narration") or "").strip() or None,
        },
        on_conflict="receipt_no",
    )
    receipt_id = receipt_rows[0]["id"]
    mark_order_delivered_for_reference(
        client,
        order_number=(
            str(invoice_info.get("linked_reference_no") or "").strip()
            or str(invoice_info.get("order_no") or "").strip()
        ),
        document_type="receipt",
        document_id=receipt_id,
        document_no=str(invoice_info.get("invoice_no") or "RECEIPT").strip(),
    )
    if linked_invoice_id:
        client.update_rows(
            "invoices",
            {
                "linked_receipt_id": receipt_id,
            },
            filters={"id": f"eq.{linked_invoice_id}"},
            returning=False,
        )
    if advance_receipt_id:
        advance_amount = round(
            float(summary["net_amount"] or summary["gross_total"] or 0.0),
            2,
        )
        advance_description = build_advance_receipt_description(items)
        advance_receipt_update = {
            "receipt_id": receipt_id,
            "amount": advance_amount,
        }
        if advance_description:
            advance_receipt_update["valuation_description"] = advance_description
        client.update_rows(
            "advance_receipts",
            advance_receipt_update,
            filters={"id": f"eq.{advance_receipt_id}"},
            returning=False,
        )

    item_rows: list[dict[str, Any]] = []
    for index, item in enumerate(items, start=1):
        item_rows.append(
            {
                "receipt_id": receipt_id,
                "line_no": index,
                "description": str(item.get("description") or "").strip() or f"Receipt line {index}",
                "purity": str(item.get("purity") or "").strip() or None,
                "gross_weight_g": to_float(item.get("gross_weight")),
                "net_weight_g": to_float(item.get("net_weight")),
                "rate_per_gram": to_float(item.get("rate_per_gram")),
                "line_total_amount": to_float(item.get("amount")),
            }
        )
    replace_child_rows(
        client,
        table="receipt_items",
        parent_field="receipt_id",
        parent_id=receipt_id,
        rows=item_rows,
    )

    sync_payment_transaction(
        client,
        transaction_number=f"TXN-RECEIPT-{invoice_info.get('invoice_no', 'RECEIPT')}",
        customer_id=customer_id,
        direction="out",
        source_type="receipt",
        receipt_id=receipt_id,
        payment_info=payment,
        total_amount=float(summary["amount_received"]),
        adjustment_amount=float(summary.get("less_invoice_amount", 0.0)),
        remarks=str(payment.get("remarks") or "").strip() or None,
    )
    upsert_document_file(client, document_type="receipt", document_id=receipt_id, pdf_path=pdf_path, pdf_url=pdf_url)
    return {
        "document_type": "receipt",
        "document_id": receipt_id,
        "customer_id": customer_id,
        "advance_receipt_id": advance_receipt_id or None,
    }


def persist_document(payload: dict[str, Any], *, pdf_path: str, pdf_url: str | None = None) -> dict[str, Any]:
    client = SupabaseRestClient.from_root(ROOT_DIR)
    if not client:
        return {
            "enabled": False,
            "status": "skipped",
            "message": "Supabase credentials not found in root .env",
        }

    try:
        if payload.get("document_type") == "receipt":
            result = sync_receipt(client, payload, pdf_path=pdf_path, pdf_url=pdf_url)
        else:
            result = sync_invoice(client, payload, pdf_path=pdf_path, pdf_url=pdf_url)
        return {
            "enabled": True,
            "status": "success",
            **result,
        }
    except SupabaseError as exc:
        return {
            "enabled": True,
            "status": "error",
            "message": str(exc),
        }


def sync_stock_status_for_invoice(
    client: SupabaseRestClient,
    *,
    invoice_id: str,
    invoice_no: str,
    sold_stock_links: list[dict[str, Any]],
) -> None:
    for link in sold_stock_links:
        stock_item_id = str(link.get("stock_item_id") or "").strip()
        quantity = max(int(to_float(link.get("quantity")) or 1), 1)
        if not stock_item_id:
            continue
        item_rows = client.select_rows(
            "stock_items",
            select="id,status",
            filters={"id": f"eq.{stock_item_id}"},
            limit=1,
        )
        if not item_rows:
            continue

        previous_status = str(item_rows[0].get("status") or "").strip() or None
        # The item was just confirmed to exist above.  This must be a PATCH, not
        # an upsert: an upsert may attempt to insert this partial status payload
        # when its conflict target is unavailable, which violates stock_items'
        # required stock_no column.
        stock_update = {
            "status": "sold",
            "profit_cash_amount": to_float(link.get("cash_profit")),
            "profit_excess_weight_g": link.get("excess_weight"),
            "profit_calculated_at": datetime.now().isoformat(),
        }
        # Keep the master portal's customer-facing cost details in sync with the
        # accepted final bill.  This is deliberately a differential payload so
        # an unchanged bill does not rewrite those stock values.
        stock_update.update(dict(link.get("final_bill_updates") or {}))
        client.update_rows(
            "stock_items",
            stock_update,
            filters={"id": f"eq.{stock_item_id}"},
            returning=False,
        )

        existing_movement = client.select_rows(
            "stock_movements",
            select="id",
            filters={
                "stock_item_id": f"eq.{stock_item_id}",
                "reference_type": "eq.invoice",
                "reference_id": f"eq.{invoice_id}",
            },
            limit=1,
        )
        if existing_movement:
            continue

        client.insert_rows(
            "stock_movements",
            {
                "stock_item_id": stock_item_id,
                "previous_status": previous_status,
                "new_status": "sold",
                "quantity_delta": -abs(quantity),
                "reference_type": "invoice",
                "reference_id": invoice_id,
                "remarks": f"Sold via invoice {invoice_no}",
            },
            returning=False,
        )
