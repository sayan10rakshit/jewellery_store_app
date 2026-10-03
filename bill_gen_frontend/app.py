from __future__ import annotations

from copy import deepcopy
from datetime import datetime
import json
import mimetypes
import os
from pathlib import Path
from typing import Any
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from difflib import SequenceMatcher
import re

from bill_generator import generate_pdf, render_invoice_html
from supabase_sync import persist_document
from shared.supabase_rest import SupabaseError, SupabaseRestClient
from tax_calculations import classify_hsn_code


mimetypes.add_type("image/svg+xml", ".svg")

BASE_DIR = Path(__file__).resolve().parent
GENERATED_DIR = BASE_DIR / "generated_bills"
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"
ASSETS_DIR = BASE_DIR / "assets"
DATA_DIR = BASE_DIR / "data"

STOCK_ITEM_BILLING_SELECT = (
    "id,stock_no,huid,description,hsn_code,ornament_type,quantity,purity,"
    "gross_weight_g,weight_entry_unit,weight_ratti,stone_dust_deduction_g,"
    "net_weight_g,stone_weight_g,stone_amount,stone_expense,"
    "stone_expense_entry_mode,stone_expense_per_ratti,stone_cost_entry_mode,"
    "stone_cost_per_ratti,other_charges_amount,making_charges_percent,"
    "making_baseline,goldsmith_loss,other_expenses,silver_expense_entry_mode,"
    "silver_expense_price_per_gm,silver_cost_entry_mode,silver_cost_price_per_gm,"
    "silver_cost_total_price,silver_other_expenses,status,notes"
)


DEFAULT_INVOICE_DATA: dict[str, Any] = {
    "customer_info": {
        "name": "",
        "address": "",
        "contact": "",
        "contact2": "",
        "email": "",
        "state_name": "West Bengal",
        "pincode": "",
        "pan_aadhaar": "",
        "state_gst_code": "19",
        "place_of_supply_name": "West Bengal",
        "place_of_supply_gst_code": "19",
    },
    "consignee_info": {
        "name": "",
        "address": "",
        "contact": "",
        "contact2": "",
        "email": "",
        "state_name": "West Bengal",
        "pincode": "",
        "pan_aadhaar": "",
        "state_gst_code": "19",
    },
    "invoice_info": {
        "order_no": "",
        "linked_reference_no": "",
        "linked_invoice_no": "",
        "linked_receipt_no": "",
        "order_date": "",
        "invoice_no": "",
        "invoice_date": datetime.now().strftime("%d/%m/%Y %H:%M:%S"),
        "copy_type": "Original for Buyer",
    },
    "items": [
        {
            "description": "",
            "stock_no": "",
            "HUID": "",
            "quantity": "1",
            "hsn": "71131910",
            "purity": "22K",
            "gold_silver_rate": 0,
            "gross_weight": 0,
            "stone_dust_deduction": 0,
            "net_weight": 0,
            "rate_per_gram": 0,
            "gold_silver_amount": 0,
            "diamond_or_stone_weight": 0,
            "diamond_or_stone_amount": 0,
            "stone_expense": 0,
            # Leave the new-item charge unset so the frontend can apply the
            # persisted document_settings.hallmark_charge_per_item value.
            "other_charges": "",
            "making_charges": 0,
            "making_charges_percent": "",
            "show_making_percent": True,
            "making_baseline": "",
            "goldsmith_loss": 0,
            "other_expenses": 0,
            "ornament_type": "",
            "negotiated_total_amount": 0,
            "matched_stock_item_id": "",
            "match_status": "new",
            "match_source": "",
            "amount": 0,
        }
    ],
    "charges": {
        "sgst_percent": 1.5,
        "cgst_percent": 1.5,
    },
    "payment_info": {
        "cash_amount": 0,
        "upi_amount": 0,
        "card_amount": 0,
        "cheque_amount": 0,
        "bank_amount": 0,
        "card_name": "",
        "cheque_bank_name": "",
        "bank_name": "",
        "card_number": "",
        "cheque_number": "",
        "account_number": "",
        "old_gold_advance": 0,
        "less_invoice_amount": 0,
        "discount": 0,
        "round_off": 0,
        "net_amount": "",
        "amount_received": 0,
        "remarks": "",
        "narration": "",
    },
    "document_settings": {
        "invoice_item_limit": 3,
        "receipt_item_limit": 4,
        "include_terms_and_conditions": True,
        "recommendations_enabled": True,
        "back_calculation_enabled": True,
        "sync_enabled": True,
        "show_making_percent": True,
        "exchange_mode": False,
        "hallmark_charge_per_item": 53,
    },
    "document_sequence": {
        "invoice_no": "INV-001",
        "receipt_no": "REC-001",
    },
    "resolution": {
        "customer": {
            "mode": "new",
            "customer_id": "",
        }
    },
    "workflow_context": {
        "advance_receipt_id": "",
        "return_order_id": "",
        "return_tab": "",
        "return_to_portal": False,
    },
    "output_dir": str(GENERATED_DIR),
}


class InvoiceRequestHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        request_path = parsed.path or "/"

        if request_path == "/":
            self.serve_index()
            return
        if request_path == "/favicon.ico":
            self.send_response(HTTPStatus.NO_CONTENT)
            self.end_headers()
            return
        if request_path.startswith("/static/"):
            self.serve_file(STATIC_DIR / request_path.removeprefix("/static/"))
            return
        if request_path.startswith("/assets/"):
            self.serve_file(ASSETS_DIR / request_path.removeprefix("/assets/"))
            return
        if request_path.startswith("/generated/"):
            self.serve_file(GENERATED_DIR / request_path.removeprefix("/generated/"))
            return
        if request_path == "/api/customer-suggestions":
            params = parse_qs(parsed.query)
            name = (params.get("name", [""])[0] or "").strip()
            contact = (params.get("contact", [""])[0] or "").strip()
            email = (params.get("email", [""])[0] or "").strip()
            self.send_json({"suggestions": fetch_customer_suggestions(name=name, contact=contact, email=email)})
            return
        if request_path == "/api/item-match":
            params = parse_qs(parsed.query)
            stock_no = (params.get("stock_no", [""])[0] or "").strip()
            huid = (params.get("huid", [""])[0] or "").strip()
            self.send_json({"match": fetch_exact_stock_match(stock_no=stock_no, huid=huid)})
            return
        if request_path == "/api/order-match":
            params = parse_qs(parsed.query)
            order_no = (params.get("order_no", [""])[0] or "").strip()
            self.send_json({"match": fetch_order_match(order_no)})
            return
        if request_path == "/api/invoice-match":
            params = parse_qs(parsed.query)
            invoice_no = (params.get("invoice_no", [""])[0] or "").strip()
            self.send_json({"match": fetch_invoice_match(invoice_no)})
            return
        if request_path == "/api/receipt-match":
            params = parse_qs(parsed.query)
            receipt_no = (params.get("receipt_no", [""])[0] or "").strip()
            self.send_json({"match": fetch_receipt_match(receipt_no)})
            return
        if request_path == "/api/document-defaults":
            self.send_json(build_initial_data())
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

    def do_POST(self) -> None:
        if self.path == "/api/settings":
            try:
                settings = save_document_settings(self.read_json_body())
            except (SupabaseError, ValueError) as exc:
                self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_GATEWAY)
                return
            self.send_json({"document_settings": settings})
            return
        if self.path == "/api/preview":
            payload = normalize_invoice_payload(self.read_json_body())
            html = render_invoice_html(payload, include_terms_and_conditions=False, include_preview_ids=True)
            self.send_json({"html": html})
            return
        if self.path == "/api/generate":
            payload = normalize_invoice_payload(self.read_json_body())
            pdf_path = generate_pdf(payload)
            pdf_url = f"/generated/{Path(pdf_path).name}"
            storage_result = persist_document(payload, pdf_path=str(Path(pdf_path).resolve()), pdf_url=pdf_url)
            self.send_json(
                {
                    "pdf_path": str(Path(pdf_path).resolve()),
                    "pdf_url": pdf_url,
                    "storage": storage_result,
                }
            )
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

    def read_json_body(self) -> dict[str, Any]:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length else b"{}"
        try:
            return json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def serve_index(self) -> None:
        template = (TEMPLATES_DIR / "index.html").read_text(encoding="utf-8")
        page = template.replace("{{INITIAL_DATA_JSON}}", json.dumps(build_initial_data()))
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(page.encode("utf-8"))

    def serve_file(self, path: Path) -> None:
        safe_path = path.resolve()
        allowed_roots = (STATIC_DIR.resolve(), GENERATED_DIR.resolve(), ASSETS_DIR.resolve())
        if not any(str(safe_path).startswith(str(root)) for root in allowed_roots) or not safe_path.exists():
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return

        content_type, _ = mimetypes.guess_type(str(safe_path))
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.end_headers()
        self.wfile.write(safe_path.read_bytes())

    def send_json(self, payload: dict[str, Any], status: int = HTTPStatus.OK) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format: str, *args: Any) -> None:
        return


def normalize_invoice_payload(payload: dict[str, Any]) -> dict[str, Any]:
    normalized = deepcopy(DEFAULT_INVOICE_DATA)

    for section in ("customer_info", "consignee_info", "invoice_info", "charges", "payment_info", "document_settings", "workflow_context"):
        normalized[section].update(payload.get(section, {}))
    normalized["document_sequence"].update(payload.get("document_sequence", {}))
    normalized["resolution"]["customer"].update((payload.get("resolution") or {}).get("customer", {}))

    items = payload.get("items") or normalized["items"]
    normalized["items"] = [normalize_item(item) for item in items if has_visible_item_data(item)]
    if not normalized["items"]:
        normalized["items"] = [normalize_item({})]

    normalized["charges"]["sgst_percent"] = to_float(normalized["charges"].get("sgst_percent"))
    normalized["charges"]["cgst_percent"] = to_float(normalized["charges"].get("cgst_percent"))

    payment = normalized["payment_info"]
    for key in (
        "cash_amount",
        "upi_amount",
        "card_amount",
        "cheque_amount",
        "bank_amount",
        "old_gold_advance",
        "less_invoice_amount",
        "discount",
        "round_off",
        "amount_received",
    ):
        payment[key] = to_float(payment.get(key))

    invoice_info = normalized["invoice_info"]
    invoice_info["invoice_no"] = str(invoice_info.get("invoice_no") or "INVOICE").strip()
    invoice_info["invoice_date"] = str(
        invoice_info.get("invoice_date") or datetime.now().strftime("%d/%m/%Y %H:%M:%S")
    ).strip()
    invoice_info["copy_type"] = str(invoice_info.get("copy_type") or "Original for Buyer").strip()
    invoice_info["linked_reference_no"] = str(invoice_info.get("linked_reference_no") or "").strip()
    invoice_info["linked_invoice_no"] = str(invoice_info.get("linked_invoice_no") or "").strip()
    invoice_info["linked_receipt_no"] = str(invoice_info.get("linked_receipt_no") or "").strip()

    settings = normalized["document_settings"]
    settings["invoice_item_limit"] = max(int(to_float(settings.get("invoice_item_limit")) or 3), 1)
    settings["receipt_item_limit"] = max(int(to_float(settings.get("receipt_item_limit")) or 4), 1)
    hallmark_charge = to_float(settings.get("hallmark_charge_per_item"))
    settings["hallmark_charge_per_item"] = max(53 if hallmark_charge is None else hallmark_charge, 0)
    for key in (
        "recommendations_enabled",
        "back_calculation_enabled",
        "sync_enabled",
        "show_making_percent",
        "exchange_mode",
        "include_terms_and_conditions",
    ):
        settings[key] = to_bool(settings.get(key))

    normalized["document_type"] = payload.get("document_type", "invoice")
    normalized["workflow_context"]["advance_receipt_id"] = str(normalized["workflow_context"].get("advance_receipt_id") or "").strip()
    normalized["workflow_context"]["return_order_id"] = str(normalized["workflow_context"].get("return_order_id") or "").strip()
    normalized["workflow_context"]["return_tab"] = str(normalized["workflow_context"].get("return_tab") or "").strip()
    normalized["workflow_context"]["return_to_portal"] = to_bool(normalized["workflow_context"].get("return_to_portal"))
    if settings["exchange_mode"]:
        linked_number = (
            invoice_info["linked_receipt_no"]
            if normalized["document_type"] == "invoice"
            else invoice_info["linked_invoice_no"]
        )
        payment["remarks"] = compose_exchange_remark(
            payment.get("remarks"),
            document_type=normalized["document_type"],
            linked_number=linked_number,
        )

    normalized["output_dir"] = str(GENERATED_DIR)
    return normalized


def normalize_item(item: dict[str, Any]) -> dict[str, Any]:
    normalized = {
        "description": str(item.get("description", "")).strip(),
        "stock_no": str(item.get("stock_no", "")).strip(),
        "HUID": str(item.get("HUID", "")).strip(),
        "quantity": str(item.get("quantity", "")).strip() or "0",
        "hsn": str(item.get("hsn", "")).strip(),
        "purity": str(item.get("purity", "")).strip(),
        "gold_silver_rate": to_float(item.get("gold_silver_rate", item.get("rate_per_gram"))),
        "gross_weight": to_float(item.get("gross_weight")),
        "stone_dust_deduction": to_float(item.get("stone_dust_deduction", item.get("diamond_or_stone_weight"))),
        "net_weight": to_float(item.get("net_weight")),
        "rate_per_gram": to_float(item.get("rate_per_gram")),
        "gold_silver_amount": to_float(item.get("gold_silver_amount")),
        "diamond_or_stone_weight": to_float(item.get("diamond_or_stone_weight")),
        "diamond_or_stone_amount": to_float(item.get("diamond_or_stone_amount")),
        "stone_expense": to_float(item.get("stone_expense")),
        "other_charges": to_float(item.get("other_charges")),
        "making_charges": to_float(item.get("making_charges")),
        "making_charges_percent": str(item.get("making_charges_percent", "")).strip(),
        "show_making_percent": to_bool(item.get("show_making_percent", True)),
        "making_baseline": to_float(item.get("making_baseline")),
        "goldsmith_loss": to_float(item.get("goldsmith_loss")),
        "other_expenses": to_float(item.get("other_expenses")),
        "ornament_type": str(item.get("ornament_type", "")).strip(),
        "negotiated_total_amount": to_float(item.get("negotiated_total_amount")),
        "matched_stock_item_id": str(item.get("matched_stock_item_id", "")).strip(),
        "match_status": str(item.get("match_status", "new")).strip() or "new",
        "match_source": str(item.get("match_source", "")).strip(),
        "amount": to_float(item.get("amount")),
    }
    category = classify_hsn_code(normalized.get("hsn"))
    if category in {"silver", "stone", "imitation"}:
        normalized["making_charges_percent"] = ""
        normalized["show_making_percent"] = False
    if category in {"stone", "imitation"}:
        normalized["making_charges"] = 0.0
    return normalized


def has_visible_item_data(item: dict[str, Any]) -> bool:
    visible_keys = (
        "description",
        "stock_no",
        "HUID",
        "quantity",
        "hsn",
        "purity",
        "gross_weight",
        "stone_dust_deduction",
        "net_weight",
        "gold_silver_rate",
        "rate_per_gram",
        "gold_silver_amount",
        "diamond_or_stone_weight",
        "diamond_or_stone_amount",
        "stone_expense",
        "other_charges",
        "making_charges",
        "negotiated_total_amount",
    )
    return any(str(item.get(key, "")).strip() for key in visible_keys)


def get_supabase_client() -> SupabaseRestClient | None:
    return SupabaseRestClient.from_root(BASE_DIR.parents[0])


SETTINGS_ROW_KEY = "bill_gen_frontend"
LAYOUT_SETTING_KEYS = {
    "invoice_item_limit",
    "receipt_item_limit",
    "hallmark_charge_per_item",
    "include_terms_and_conditions",
}
SMART_SETTING_KEYS = {"recommendations_enabled", "back_calculation_enabled", "sync_enabled"}


def fetch_document_settings(*, raise_on_error: bool = False) -> dict[str, Any]:
    client = get_supabase_client()
    if not client:
        return {}
    try:
        rows = client.select_rows(
            "app_settings",
            select="value",
            filters={"key": f"eq.{SETTINGS_ROW_KEY}"},
            limit=1,
        )
    except SupabaseError as exc:
        if raise_on_error:
            raise
        print(f"Could not load document settings from Supabase: {exc}")
        return {}
    value = rows[0].get("value") if rows else {}
    return value if isinstance(value, dict) else {}


def save_document_settings(payload: dict[str, Any]) -> dict[str, Any]:
    client = get_supabase_client()
    if not client:
        raise ValueError("Supabase is not configured; settings were not saved.")
    section = payload.get("section")
    allowed_keys = LAYOUT_SETTING_KEYS if section == "document_layout" else SMART_SETTING_KEYS if section == "smart_features" else set()
    if not allowed_keys:
        raise ValueError("Unknown settings section.")
    incoming = payload.get("settings")
    if not isinstance(incoming, dict):
        raise ValueError("Settings payload is missing.")

    settings = {**DEFAULT_INVOICE_DATA["document_settings"], **fetch_document_settings(raise_on_error=True)}
    for key in allowed_keys:
        if key not in incoming:
            continue
        value = incoming[key]
        if key in {"invoice_item_limit", "receipt_item_limit"}:
            number = to_float(value)
            if number is None or number < 1 or not number.is_integer():
                raise ValueError(f"{key} must be a whole number greater than zero.")
            settings[key] = int(number)
        elif key == "hallmark_charge_per_item":
            number = to_float(value)
            if number is None or number < 0:
                raise ValueError("Hallmark / Misc Per Qty must be zero or greater.")
            settings[key] = number
        else:
            settings[key] = to_bool(value)

    client.upsert_rows(
        "app_settings",
        {"key": SETTINGS_ROW_KEY, "value": settings},
        on_conflict="key",
        returning=False,
    )
    return settings


def normalize_search_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def similarity_score(query: str, candidate: str) -> float:
    normalized_query = normalize_search_text(query)
    normalized_candidate = normalize_search_text(candidate)
    if not normalized_query or not normalized_candidate:
        return 0.0
    if normalized_query == normalized_candidate:
        return 1.0
    if normalized_query in normalized_candidate:
        return 0.94
    return SequenceMatcher(None, normalized_query, normalized_candidate).ratio()


def fetch_customer_suggestions(*, name: str = "", contact: str = "", email: str = "") -> list[dict[str, Any]]:
    """Find customer suggestions by matching against name, contact number, or email."""
    cleaned_name = name.strip()
    cleaned_contact = contact.strip()
    cleaned_email = email.strip().lower()

    # Need at least one usable query with minimum 2 characters
    has_name = len(cleaned_name) >= 2
    has_contact = len(cleaned_contact) >= 3
    has_email = len(cleaned_email) >= 3
    if not has_name and not has_contact and not has_email:
        return []

    client = get_supabase_client()
    if not client:
        return []

    try:
        rows = client.select_rows(
            "customers",
            select="id,full_name,primary_contact,secondary_contact,email,address_line,state_name,state_gst_code,place_of_supply_name,place_of_supply_gst_code,pincode,pan_aadhaar_no,updated_at",
            order="updated_at.desc",
            limit=250,
        )
    except SupabaseError:
        return []

    ranked: list[tuple[float, dict[str, Any]]] = []
    for row in rows:
        best_score = 0.0

        # Match by name
        if has_name:
            full_name = str(row.get("full_name") or "").strip()
            name_score = similarity_score(cleaned_name, full_name)
            best_score = max(best_score, name_score)

        # Match by contact (exact prefix / substring match on digits)
        if has_contact:
            primary = str(row.get("primary_contact") or "").strip()
            secondary = str(row.get("secondary_contact") or "").strip()
            for phone in [primary, secondary]:
                if phone and cleaned_contact in phone:
                    best_score = max(best_score, 0.95 if phone == cleaned_contact else 0.85)

        # Match by email (prefix / substring match)
        if has_email:
            row_email = str(row.get("email") or "").strip().lower()
            if row_email and cleaned_email in row_email:
                best_score = max(best_score, 1.0 if row_email == cleaned_email else 0.88)

        if best_score < 0.6:
            continue
        ranked.append((best_score, row))

    ranked.sort(key=lambda entry: (-entry[0], str(entry[1].get("updated_at") or "")), reverse=False)
    return [
        {
            "id": row.get("id"),
            "full_name": row.get("full_name"),
            "primary_contact": row.get("primary_contact"),
            "secondary_contact": row.get("secondary_contact"),
            "email": row.get("email"),
            "address_line": row.get("address_line"),
            "state_name": row.get("state_name"),
            "state_gst_code": row.get("state_gst_code"),
            "place_of_supply_name": row.get("place_of_supply_name"),
            "place_of_supply_gst_code": row.get("place_of_supply_gst_code"),
            "pincode": row.get("pincode"),
            "pan_aadhaar_no": row.get("pan_aadhaar_no"),
            "score": round(best_score, 2),
        }
        for best_score, row in ranked[:5]
    ]


def fetch_exact_stock_match(*, stock_no: str, huid: str) -> dict[str, Any] | None:
    stock_no = stock_no.strip()
    huid = huid.strip()
    if not stock_no and not huid:
        return None

    client = get_supabase_client()
    if not client:
        return None

    candidates: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    def collect(filters: dict[str, str]) -> None:
        try:
            rows = client.select_rows(
                "stock_items",
                select=STOCK_ITEM_BILLING_SELECT,
                filters=filters,
                limit=3,
            )
        except SupabaseError:
            return

        for row in rows:
            row_id = str(row.get("id") or "")
            if row_id and row_id not in seen_ids:
                seen_ids.add(row_id)
                candidates.append(row)

    if stock_no:
        collect({"stock_no": f"eq.{stock_no}"})
    if huid:
        collect({"huid": f"eq.{huid}"})

    active_statuses = {"in_stock", "reserved", "out_for_jobwork"}
    for row in candidates:
        row_stock = str(row.get("stock_no") or "").strip()
        row_huid = str(row.get("huid") or "").strip()
        row_status = str(row.get("status") or "").strip()
        if row_status not in active_statuses:
            continue
        if stock_no and row_stock != stock_no:
            continue
        if huid and row_huid != huid:
            continue
        category = classify_hsn_code(row.get("hsn_code"))
        net_weight = to_float(row.get("net_weight_g"))
        silver_rate = to_float(row.get("silver_cost_price_per_gm")) if category == "silver" else 0.0
        silver_making_charges = to_float(row.get("silver_cost_total_price")) if category == "silver" else 0.0
        if category == "silver" and silver_rate and net_weight and not silver_making_charges:
            silver_making_charges = round(silver_rate * net_weight, 2)
        stone_customer_amount = to_float(row.get("stone_amount"))
        other_customer_amount = to_float(row.get("other_charges_amount"))
        if category == "stone":
            stone_customer_amount = other_customer_amount or round(to_float(row.get("stone_cost_per_ratti")) * to_float(row.get("weight_ratti")), 2)
            other_customer_amount = 0.0
        elif category == "imitation":
            other_customer_amount = other_customer_amount or to_float(row.get("stone_amount"))
        return {
            "id": row.get("id"),
            "stock_no": row_stock,
            "huid": row_huid,
            "description": row.get("description"),
            "hsn_code": row.get("hsn_code"),
            "ornament_type": row.get("ornament_type"),
            "quantity": row.get("quantity"),
            "purity": row.get("purity"),
            "gross_weight_g": row.get("gross_weight_g"),
            "weight_entry_unit": row.get("weight_entry_unit"),
            "weight_ratti": row.get("weight_ratti"),
            "stone_dust_deduction_g": row.get("stone_dust_deduction_g"),
            "net_weight_g": row.get("net_weight_g"),
            "rate_per_gram": None,
            "gold_silver_amount": None,
            "stone_weight_g": row.get("stone_weight_g"),
            "stone_amount": stone_customer_amount,
            "stone_expense": row.get("stone_expense"),
            "stone_expense_entry_mode": row.get("stone_expense_entry_mode"),
            "stone_expense_per_ratti": row.get("stone_expense_per_ratti"),
            "stone_cost_entry_mode": row.get("stone_cost_entry_mode"),
            "stone_cost_per_ratti": row.get("stone_cost_per_ratti"),
            "other_charges_amount": other_customer_amount,
            "making_charges_amount": silver_making_charges if category == "silver" and silver_making_charges else None,
            "making_charges_percent": row.get("making_charges_percent") if category not in {"silver", "stone", "imitation"} else None,
            "making_baseline": row.get("making_baseline"),
            "goldsmith_loss": row.get("goldsmith_loss"),
            "other_expenses": row.get("other_expenses"),
            "silver_expense_entry_mode": row.get("silver_expense_entry_mode"),
            "silver_expense_price_per_gm": row.get("silver_expense_price_per_gm"),
            "silver_cost_entry_mode": row.get("silver_cost_entry_mode"),
            "silver_cost_price_per_gm": row.get("silver_cost_price_per_gm"),
            "silver_cost_total_price": row.get("silver_cost_total_price"),
            "silver_other_expenses": row.get("silver_other_expenses"),
            "status": row_status,
            "notes": row.get("notes"),
        }
    return None


def format_order_date_display(raw_value: Any) -> str:
    clean_value = str(raw_value or "").strip()
    if not clean_value:
        return ""

    normalized = clean_value.replace("Z", "+00:00")
    for parser in (datetime.fromisoformat,):
        try:
            parsed = parser(normalized)
            if parsed.hour == 0 and parsed.minute == 0 and parsed.second == 0:
                return parsed.strftime("%d/%m/%Y")
            return parsed.strftime("%d/%m/%Y %H:%M")
        except ValueError:
            continue

    for pattern in ("%Y-%m-%d", "%d/%m/%Y", "%d/%m/%Y %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            parsed = datetime.strptime(clean_value, pattern)
            if pattern in ("%Y-%m-%d", "%d/%m/%Y"):
                return parsed.strftime("%d/%m/%Y")
            return parsed.strftime("%d/%m/%Y %H:%M")
        except ValueError:
            continue
    return clean_value


def format_receipt_adjustment_remarks(
    receipt_rows: list[dict[str, Any]], advance_receipt_rows: list[dict[str, Any]]
) -> str:
    """Build the accounting trail shown when an order is loaded into a bill."""

    def describe(rows: list[dict[str, Any]], amount_field: str) -> str:
        return ", ".join(
            f"{str(row.get('receipt_no') or 'Receipt').strip()} ({to_float(row.get(amount_field)):,.2f})"
            for row in rows
            if str(row.get("receipt_no") or "").strip()
        )

    receipt_details = describe(receipt_rows, "amount_received")
    advance_receipt_details = describe(advance_receipt_rows, "amount")
    parts: list[str] = []
    if receipt_details:
        parts.append(f"Receipt(s) {receipt_details}")
    if advance_receipt_details:
        parts.append(f"Advance Receipt(s) {advance_receipt_details}")
    return f"Net amount adjusted with {' and '.join(parts)}." if parts else ""


def build_customer_info_payload(source: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": str(source.get("customer_name") or "").strip(),
        "contact": str(source.get("customer_contact_primary") or "").strip(),
        "contact2": str(source.get("customer_contact_secondary") or "").strip(),
        "email": str(source.get("customer_email") or "").strip(),
        "address": str(source.get("customer_address") or "").strip(),
        "state_name": str(source.get("customer_state_name") or "").strip(),
        "state_gst_code": str(source.get("customer_state_gst_code") or "").strip(),
        "place_of_supply_name": str(source.get("place_of_supply_name") or "").strip(),
        "place_of_supply_gst_code": str(source.get("place_of_supply_gst_code") or "").strip(),
        "pincode": str(source.get("customer_pincode") or "").strip(),
        "pan_aadhaar": str(source.get("customer_pan_aadhaar_no") or "").strip(),
    }


def build_consignee_info_payload(source: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": str(source.get("consignee_name") or "").strip(),
        "contact": str(source.get("consignee_contact_primary") or "").strip(),
        "contact2": str(source.get("consignee_contact_secondary") or "").strip(),
        "email": str(source.get("consignee_email") or "").strip(),
        "address": str(source.get("consignee_address") or "").strip(),
        "state_name": str(source.get("consignee_state_name") or "").strip(),
        "state_gst_code": str(source.get("consignee_state_gst_code") or "").strip(),
        "pincode": str(source.get("consignee_pincode") or "").strip(),
        "pan_aadhaar": str(source.get("consignee_pan_aadhaar_no") or "").strip(),
    }


def fetch_payment_tender_info(
    client: SupabaseRestClient,
    *,
    invoice_id: str | None = None,
    receipt_id: str | None = None,
) -> dict[str, Any]:
    filters: dict[str, str] = {}
    if invoice_id:
        filters["invoice_id"] = f"eq.{invoice_id}"
        filters["source_type"] = "eq.invoice"
    elif receipt_id:
        filters["receipt_id"] = f"eq.{receipt_id}"
        filters["source_type"] = "eq.receipt"
    else:
        return {}

    payment_info: dict[str, Any] = {
        "cash_amount": 0,
        "upi_amount": 0,
        "card_amount": 0,
        "cheque_amount": 0,
        "bank_amount": 0,
        "card_name": "",
        "cheque_bank_name": "",
        "bank_name": "",
        "card_number": "",
        "cheque_number": "",
        "account_number": "",
    }

    try:
        transaction_rows = client.select_rows(
            "payment_transactions",
            select="id,total_amount",
            filters=filters,
            order="transaction_datetime.desc",
            limit=1,
        )
    except SupabaseError:
        transaction_rows = []

    if not transaction_rows:
        return payment_info

    transaction_id = str(transaction_rows[0].get("id") or "").strip()
    if not transaction_id:
        return payment_info

    try:
        tender_rows = client.select_rows(
            "payment_transaction_tenders",
            select="payment_mode,amount,instrument_label,instrument_number,account_number",
            filters={"payment_transaction_id": f"eq.{transaction_id}"},
            limit=25,
        )
    except SupabaseError:
        tender_rows = []

    for tender in tender_rows:
        mode = str(tender.get("payment_mode") or "").strip()
        amount = round(to_float(tender.get("amount")), 2)
        if mode == "cash":
            payment_info["cash_amount"] = amount
        elif mode == "upi":
            payment_info["upi_amount"] = amount
        elif mode == "card":
            payment_info["card_amount"] = amount
            payment_info["card_name"] = str(tender.get("instrument_label") or "").strip()
            payment_info["card_number"] = str(tender.get("instrument_number") or "").strip()
        elif mode == "cheque":
            payment_info["cheque_amount"] = amount
            payment_info["cheque_bank_name"] = str(tender.get("instrument_label") or "").strip()
            payment_info["cheque_number"] = str(tender.get("instrument_number") or "").strip()
        elif mode == "bank_transfer":
            payment_info["bank_amount"] = amount
            payment_info["bank_name"] = str(tender.get("instrument_label") or "").strip()
            payment_info["account_number"] = str(tender.get("account_number") or "").strip()

    return payment_info


def fetch_order_match(order_no: str) -> dict[str, Any] | None:
    cleaned_order_no = str(order_no or "").strip()
    if not cleaned_order_no:
        return None

    client = get_supabase_client()
    if not client:
        return None

    try:
        order_rows = client.select_rows(
            "orders",
            select="id,order_number,customer_id,order_type,order_date,promised_date,status,remarks",
            filters={"order_number": f"eq.{cleaned_order_no}"},
            limit=1,
        )
    except SupabaseError:
        return None

    if not order_rows:
        return None

    order = order_rows[0]
    order_id = str(order.get("id") or "").strip()
    customer_id = str(order.get("customer_id") or "").strip()

    customer: dict[str, Any] = {}
    if customer_id:
        try:
            customer_rows = client.select_rows(
                "customers",
                select="id,full_name,primary_contact,secondary_contact,email,address_line,state_name,state_gst_code,place_of_supply_name,place_of_supply_gst_code,pincode,pan_aadhaar_no",
                filters={"id": f"eq.{customer_id}"},
                limit=1,
            )
        except SupabaseError:
            customer_rows = []
        if customer_rows:
            customer = customer_rows[0]

    try:
        order_items = client.select_rows(
            "order_items",
            select="id,line_no,stock_item_id,description,quantity,approx_weight_g,purity,hsn_code,predetermined_rate_per_gram,predetermined_making_charges_amount,predetermined_making_charges_percent,design_notes,status",
            filters={"order_id": f"eq.{order_id}"},
            order="line_no.asc",
            limit=100,
        )
    except SupabaseError:
        order_items = []

    stock_item_ids = [
        str(item.get("stock_item_id") or "").strip()
        for item in order_items
        if str(item.get("stock_item_id") or "").strip()
    ]
    stock_map: dict[str, dict[str, Any]] = {}
    if stock_item_ids:
        joined_ids = ",".join(stock_item_ids)
        try:
            stock_rows = client.select_rows(
                "stock_items",
                select=STOCK_ITEM_BILLING_SELECT,
                filters={"id": f"in.({joined_ids})"},
                limit=len(stock_item_ids),
            )
        except SupabaseError:
            stock_rows = []
        stock_map = {str(row.get("id") or "").strip(): row for row in stock_rows}

    try:
        advance_rows = client.select_rows(
            "advance_receipts",
            select="id,receipt_no,amount,status,receipt_datetime",
            filters={"order_id": f"eq.{order_id}", "status": "not.eq.cancelled"},
            order="receipt_datetime.asc",
            limit=250,
        )
    except SupabaseError:
        advance_rows = []

    try:
        receipt_rows = client.select_rows(
            "receipts",
            select="id,receipt_no,amount_received,status,receipt_datetime",
            filters={"linked_reference_no": f"eq.{cleaned_order_no}", "status": "not.eq.cancelled"},
            order="receipt_datetime.asc",
            limit=250,
        )
    except SupabaseError:
        receipt_rows = []

    mapped_items: list[dict[str, Any]] = []
    saved_settings = fetch_document_settings()
    default_hallmark_charge = to_float(saved_settings.get("hallmark_charge_per_item"))
    if default_hallmark_charge is None:
        default_hallmark_charge = 53.0
    for item in order_items:
        stock_item = stock_map.get(str(item.get("stock_item_id") or "").strip(), {})
        category = classify_hsn_code(item.get("hsn_code") or stock_item.get("hsn_code"))
        quantity = max(int(to_float(item.get("quantity")) or 1), 1)
        gross_weight = to_float(stock_item.get("gross_weight_g")) or to_float(item.get("approx_weight_g"))
        stone_deduction = to_float(stock_item.get("stone_dust_deduction_g"))
        net_weight = to_float(stock_item.get("net_weight_g")) or max(gross_weight - stone_deduction, 0)
        rate_per_gram = to_float(item.get("predetermined_rate_per_gram")) or (
            to_float(stock_item.get("silver_cost_price_per_gm")) if category == "silver" else 0.0
        )
        uses_metal_amount = category not in {"silver", "stone", "imitation"}
        gold_amount = (
            round(rate_per_gram * net_weight, 2) if rate_per_gram and net_weight else 0.0
        ) if uses_metal_amount else 0.0
        silver_making_charges = 0.0
        if category == "silver":
            silver_making_charges = to_float(stock_item.get("silver_cost_total_price"))
            if not silver_making_charges and rate_per_gram and net_weight:
                silver_making_charges = round(rate_per_gram * net_weight, 2)
        stone_amount = to_float(stock_item.get("stone_amount"))
        stored_other_charges = to_float(stock_item.get("other_charges_amount"))
        other_charges = stored_other_charges if stored_other_charges is not None else (default_hallmark_charge * quantity)
        if category == "stone":
            stone_amount = to_float(stock_item.get("other_charges_amount")) or (
                to_float(stock_item.get("stone_cost_per_ratti")) * to_float(stock_item.get("weight_ratti"))
            )
            other_charges = 0.0
        elif category == "imitation":
            other_charges = to_float(stock_item.get("other_charges_amount"))
        making_percent = to_float(item.get("predetermined_making_charges_percent")) or to_float(stock_item.get("making_charges_percent"))
        if category in {"silver", "stone", "imitation"}:
            making_percent = 0.0
        making_charges = to_float(item.get("predetermined_making_charges_amount")) or silver_making_charges
        if category in {"stone", "imitation"}:
            making_charges = 0.0
        if category != "silver" and not making_charges and making_percent and gold_amount:
            making_charges = round(gold_amount * making_percent / 100, 2)
        total_amount = round(gold_amount + stone_amount + other_charges + making_charges, 2)

        mapped_items.append(
            {
                "description": str(item.get("description") or stock_item.get("description") or "").strip(),
                "stock_no": str(stock_item.get("stock_no") or "").strip(),
                "HUID": str(stock_item.get("huid") or "").strip(),
                "quantity": str(quantity),
                "hsn": str(item.get("hsn_code") or stock_item.get("hsn_code") or "").strip(),
                "purity": str(item.get("purity") or stock_item.get("purity") or "").strip(),
                "gold_silver_rate": rate_per_gram if uses_metal_amount and rate_per_gram else "",
                "gross_weight": gross_weight if gross_weight else "",
                "stone_dust_deduction": stone_deduction if stone_deduction else "",
                "net_weight": net_weight if net_weight else "",
                "rate_per_gram": rate_per_gram if uses_metal_amount and rate_per_gram else "",
                "gold_silver_amount": gold_amount if uses_metal_amount and gold_amount else "",
                "diamond_or_stone_weight": to_float(stock_item.get("stone_weight_g")) or "",
                "diamond_or_stone_amount": stone_amount if stone_amount else "",
                "stone_expense": to_float(stock_item.get("stone_expense")) or "",
                "other_charges": other_charges if other_charges else "",
                "making_charges": making_charges if making_charges else "",
                "making_charges_percent": f"{making_percent:.2f}" if making_percent else "",
                "show_making_percent": category not in {"silver", "stone", "imitation"},
                "making_baseline": to_float(stock_item.get("making_baseline")) or "",
                "goldsmith_loss": to_float(stock_item.get("goldsmith_loss")) or "",
                "other_expenses": to_float(stock_item.get("other_expenses")) or "",
                "ornament_type": str(stock_item.get("ornament_type") or "").strip(),
                "matched_stock_item_id": str(stock_item.get("id") or "").strip(),
                "match_status": "accepted" if stock_item else "new",
                "match_source": "order_link" if stock_item else "",
                "amount": total_amount if total_amount else "",
            }
        )

    return {
        "order_id": order_id,
        "order_number": str(order.get("order_number") or cleaned_order_no).strip(),
        "order_date": format_order_date_display(order.get("order_date")),
        "customer": {
            "id": customer_id,
            "full_name": customer.get("full_name"),
            "primary_contact": customer.get("primary_contact"),
            "secondary_contact": customer.get("secondary_contact"),
            "email": customer.get("email"),
            "address_line": customer.get("address_line"),
            "state_name": customer.get("state_name"),
            "state_gst_code": customer.get("state_gst_code"),
            "place_of_supply_name": customer.get("place_of_supply_name"),
            "place_of_supply_gst_code": customer.get("place_of_supply_gst_code"),
            "pincode": customer.get("pincode"),
            "pan_aadhaar_no": customer.get("pan_aadhaar_no"),
        },
        "items": mapped_items,
        "advance_total": round(sum(to_float(row.get("amount")) for row in advance_rows), 2),
        "receipt_adjustment_remarks": format_receipt_adjustment_remarks(receipt_rows, advance_rows),
    }


def fetch_invoice_match(invoice_no: str) -> dict[str, Any] | None:
    cleaned_invoice_no = str(invoice_no or "").strip()
    if not cleaned_invoice_no:
        return None

    client = get_supabase_client()
    if not client:
        return None

    try:
        invoice_rows = client.select_rows(
            "invoices",
            select=(
                "id,invoice_no,customer_id,linked_reference_no,linked_receipt_id,invoice_datetime,source_order_date,copy_type,"
                "customer_name,customer_contact_primary,customer_contact_secondary,customer_email,customer_address,"
                "customer_state_name,customer_state_gst_code,place_of_supply_name,place_of_supply_gst_code,"
                "customer_pincode,customer_pan_aadhaar_no,consignee_name,consignee_contact_primary,"
                "consignee_contact_secondary,consignee_address,consignee_state_name,"
                "consignee_state_gst_code,consignee_pincode,consignee_pan_aadhaar_no,sgst_percent,cgst_percent,"
                "old_gold_advance_amount,discount_amount,round_off_amount,net_payable_amount,amount_received,"
                "remarks,narration"
            ),
            filters={"invoice_no": f"eq.{cleaned_invoice_no}"},
            limit=1,
        )
    except SupabaseError:
        return None

    if not invoice_rows:
        return None

    invoice = invoice_rows[0]
    invoice_id = str(invoice.get("id") or "").strip()
    linked_receipt_id = str(invoice.get("linked_receipt_id") or "").strip()

    linked_receipt_no = ""
    if linked_receipt_id:
        try:
            linked_receipt_rows = client.select_rows(
                "receipts",
                select="receipt_no",
                filters={"id": f"eq.{linked_receipt_id}"},
                limit=1,
            )
        except SupabaseError:
            linked_receipt_rows = []
        if linked_receipt_rows:
            linked_receipt_no = str(linked_receipt_rows[0].get("receipt_no") or "").strip()

    try:
        item_rows = client.select_rows(
            "invoice_items",
            select=(
                "stock_item_id,line_no,stock_no,huid,description,quantity,hsn_code,purity,gross_weight_g,"
                "stone_dust_deduction_g,net_weight_g,gold_silver_rate,rate_per_gram,gold_silver_amount,"
                "stone_weight_g,stone_amount,other_charges_amount,making_charges_amount,making_charges_percent,"
                "stone_expense,making_baseline,goldsmith_loss,other_expenses,profit_cash_amount,profit_excess_weight_g,"
                "negotiated_total_amount_with_tax,line_total_amount,ornament_type"
            ),
            filters={"invoice_id": f"eq.{invoice_id}"},
            order="line_no.asc",
            limit=200,
        )
    except SupabaseError:
        item_rows = []

    payment_info = fetch_payment_tender_info(client, invoice_id=invoice_id)
    payment_info.update(
        {
            "old_gold_advance": round(to_float(invoice.get("old_gold_advance_amount")), 2),
            "discount": round(to_float(invoice.get("discount_amount")), 2),
            "round_off": round(to_float(invoice.get("round_off_amount")), 2),
            "net_amount": round(to_float(invoice.get("net_payable_amount")), 2),
            "amount_received": round(to_float(invoice.get("amount_received")), 2),
            "remarks": str(invoice.get("remarks") or "").strip(),
            "narration": str(invoice.get("narration") or "").strip(),
        }
    )

    items = []
    for row in item_rows:
        category = classify_hsn_code(row.get("hsn_code"))
        uses_metal_amount = category not in {"silver", "stone", "imitation"}
        items.append({
            "description": str(row.get("description") or "").strip(),
            "stock_no": str(row.get("stock_no") or "").strip(),
            "HUID": str(row.get("huid") or "").strip(),
            "quantity": str(max(int(to_float(row.get("quantity")) or 1), 1)),
            "hsn": str(row.get("hsn_code") or "").strip(),
            "purity": str(row.get("purity") or "").strip(),
            "gold_silver_rate": (to_float(row.get("gold_silver_rate")) or to_float(row.get("rate_per_gram")) or "") if uses_metal_amount else "",
            "gross_weight": to_float(row.get("gross_weight_g")) or "",
            "stone_dust_deduction": to_float(row.get("stone_dust_deduction_g")) or "",
            "net_weight": to_float(row.get("net_weight_g")) or "",
            "rate_per_gram": (to_float(row.get("rate_per_gram")) or to_float(row.get("gold_silver_rate")) or "") if uses_metal_amount else "",
            "gold_silver_amount": (to_float(row.get("gold_silver_amount")) or "") if uses_metal_amount else "",
            "diamond_or_stone_weight": to_float(row.get("stone_weight_g")) or "",
            "diamond_or_stone_amount": to_float(row.get("stone_amount")) or "",
            "stone_expense": to_float(row.get("stone_expense")) or "",
            "other_charges": to_float(row.get("other_charges_amount")) or "",
            "making_charges": (to_float(row.get("making_charges_amount")) or "") if category not in {"stone", "imitation"} else "",
            "making_charges_percent": (to_float(row.get("making_charges_percent")) or "") if category not in {"silver", "stone", "imitation"} else "",
            "show_making_percent": category not in {"silver", "stone", "imitation"},
            "making_baseline": to_float(row.get("making_baseline")) or "",
            "goldsmith_loss": to_float(row.get("goldsmith_loss")) or "",
            "other_expenses": to_float(row.get("other_expenses")) or "",
            "ornament_type": str(row.get("ornament_type") or "").strip(),
            "negotiated_total_amount": to_float(row.get("negotiated_total_amount_with_tax")) or "",
            "matched_stock_item_id": str(row.get("stock_item_id") or "").strip(),
            "match_status": "accepted" if str(row.get("stock_item_id") or "").strip() else "new",
            "match_source": "invoice_match" if str(row.get("stock_item_id") or "").strip() else "",
            "amount": to_float(row.get("line_total_amount")) or "",
        })

    return {
        "document_type": "invoice",
        "document_id": invoice_id,
        "customer_id": str(invoice.get("customer_id") or "").strip(),
        "customer_info": build_customer_info_payload(invoice),
        "consignee_info": build_consignee_info_payload(invoice),
        "invoice_info": {
            "invoice_no": str(invoice.get("invoice_no") or cleaned_invoice_no).strip(),
            "order_no": str(invoice.get("linked_reference_no") or "").strip(),
            "linked_receipt_no": linked_receipt_no,
            "linked_invoice_no": "",
            "order_date": format_order_date_display(invoice.get("source_order_date")),
            "invoice_date": format_order_date_display(invoice.get("invoice_datetime")),
            "copy_type": str(invoice.get("copy_type") or "Original for Buyer").strip(),
        },
        "charges": {
            "sgst_percent": to_float(invoice.get("sgst_percent")),
            "cgst_percent": to_float(invoice.get("cgst_percent")),
        },
        "payment_info": payment_info,
        "items": items,
    }


def fetch_receipt_match(receipt_no: str) -> dict[str, Any] | None:
    cleaned_receipt_no = str(receipt_no or "").strip()
    if not cleaned_receipt_no:
        return None

    client = get_supabase_client()
    if not client:
        return None

    try:
        receipt_rows = client.select_rows(
            "receipts",
            select=(
                "id,receipt_no,customer_id,linked_reference_no,linked_invoice_id,receipt_datetime,copy_type,"
                "customer_name,customer_contact_primary,customer_contact_secondary,customer_email,customer_address,"
                "customer_state_name,customer_state_gst_code,customer_pincode,customer_pan_aadhaar_no,"
                "gross_amount,less_invoice_amount,discount_amount,round_off_amount,net_amount,amount_received,"
                "remarks,narration"
            ),
            filters={"receipt_no": f"eq.{cleaned_receipt_no}"},
            limit=1,
        )
    except SupabaseError:
        return None

    if not receipt_rows:
        return None

    receipt = receipt_rows[0]
    receipt_id = str(receipt.get("id") or "").strip()
    linked_invoice_id = str(receipt.get("linked_invoice_id") or "").strip()

    linked_invoice_no = ""
    linked_order_no = ""
    linked_order_date = ""
    if linked_invoice_id:
        try:
            linked_invoice_rows = client.select_rows(
                "invoices",
                select="invoice_no,linked_reference_no,source_order_date",
                filters={"id": f"eq.{linked_invoice_id}"},
                limit=1,
            )
        except SupabaseError:
            linked_invoice_rows = []
        if linked_invoice_rows:
            linked_invoice = linked_invoice_rows[0]
            linked_invoice_no = str(linked_invoice.get("invoice_no") or "").strip()
            linked_order_no = str(linked_invoice.get("linked_reference_no") or "").strip()
            linked_order_date = format_order_date_display(linked_invoice.get("source_order_date"))

    try:
        item_rows = client.select_rows(
            "receipt_items",
            select="line_no,description,purity,gross_weight_g,net_weight_g,rate_per_gram,line_total_amount",
            filters={"receipt_id": f"eq.{receipt_id}"},
            order="line_no.asc",
            limit=200,
        )
    except SupabaseError:
        item_rows = []

    payment_info = fetch_payment_tender_info(client, receipt_id=receipt_id)
    payment_info.update(
        {
            "less_invoice_amount": round(to_float(receipt.get("less_invoice_amount")), 2),
            "net_amount": round(to_float(receipt.get("net_amount")), 2),
            "amount_received": round(to_float(receipt.get("amount_received")), 2),
            "remarks": str(receipt.get("remarks") or "").strip(),
            "narration": str(receipt.get("narration") or "").strip(),
        }
    )

    items = [
        {
            "description": str(row.get("description") or "").strip(),
            "purity": str(row.get("purity") or "").strip(),
            "gross_weight": to_float(row.get("gross_weight_g")) or "",
            "net_weight": to_float(row.get("net_weight_g")) or "",
            "rate_per_gram": to_float(row.get("rate_per_gram")) or "",
            "amount": to_float(row.get("line_total_amount")) or "",
        }
        for row in item_rows
    ]

    return {
        "document_type": "receipt",
        "document_id": receipt_id,
        "customer_id": str(receipt.get("customer_id") or "").strip(),
        "customer_info": build_customer_info_payload(receipt),
        "invoice_info": {
            "invoice_no": str(receipt.get("receipt_no") or cleaned_receipt_no).strip(),
            "order_no": linked_order_no or str(receipt.get("linked_reference_no") or "").strip(),
            "linked_invoice_no": linked_invoice_no,
            "linked_receipt_no": "",
            "order_date": linked_order_date,
            "invoice_date": format_order_date_display(receipt.get("receipt_datetime")),
            "copy_type": str(receipt.get("copy_type") or "Original for Buyer").strip(),
        },
        "charges": {
            "sgst_percent": 0,
            "cgst_percent": 0,
        },
        "payment_info": payment_info,
        "items": items,
    }


def to_float(value: Any) -> float:
    if value in (None, ""):
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def to_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def compose_exchange_remark(existing: Any, *, document_type: str, linked_number: str) -> str:
    clean_linked_number = str(linked_number or "").strip()
    base_text = str(existing or "").strip()
    if not clean_linked_number:
        return base_text

    target_label = "receipt no" if document_type == "invoice" else "Invoice no"
    note = f"Adjusted with {target_label} {clean_linked_number}"
    if not base_text:
        return note
    if note.lower() in base_text.lower():
        return base_text
    return f"{base_text} | {note}"


def next_document_number(latest_value: str, fallback_prefix: str) -> str:
    clean_value = str(latest_value or "").strip()
    match = re.match(r"^(.*?)(\d+)$", clean_value)
    if not match:
        return f"{fallback_prefix}001"
    prefix, number_part = match.groups()
    return f"{prefix}{int(number_part) + 1:0{len(number_part)}d}"


def fetch_next_document_numbers() -> dict[str, str]:
    defaults = {
        "invoice_no": "INV-001",
        "receipt_no": "REC-001",
    }
    client = get_supabase_client()
    if not client:
        return defaults

    try:
        invoice_rows = client.select_rows(
            "invoices",
            select="invoice_no,created_at",
            order="created_at.desc",
            limit=25,
        )
    except SupabaseError:
        invoice_rows = []

    try:
        receipt_rows = client.select_rows(
            "receipts",
            select="receipt_no,created_at",
            order="created_at.desc",
            limit=25,
        )
    except SupabaseError:
        try:
            receipt_rows = client.select_rows(
                "advance_receipts",
                select="receipt_no,created_at",
                order="created_at.desc",
                limit=25,
            )
        except SupabaseError:
            receipt_rows = []

    latest_invoice = next(
        (str(row.get("invoice_no") or "").strip() for row in invoice_rows if re.search(r"\d+$", str(row.get("invoice_no") or "").strip())),
        "",
    )
    latest_receipt = next(
        (str(row.get("receipt_no") or "").strip() for row in receipt_rows if re.search(r"\d+$", str(row.get("receipt_no") or "").strip())),
        "",
    )

    return {
        "invoice_no": next_document_number(latest_invoice, "INV-") if latest_invoice else defaults["invoice_no"],
        "receipt_no": next_document_number(latest_receipt, "REC-") if latest_receipt else defaults["receipt_no"],
    }


def build_initial_data() -> dict[str, Any]:
    initial_data = deepcopy(DEFAULT_INVOICE_DATA)
    initial_data["document_settings"].update(fetch_document_settings())
    hallmark_charge = to_float(initial_data["document_settings"].get("hallmark_charge_per_item"))
    if hallmark_charge is None:
        hallmark_charge = 53.0
    for item in initial_data.get("items", []):
        if not item.get("other_charges"):
            quantity = max(to_float(item.get("quantity")) or 1, 1)
            item["other_charges"] = round(hallmark_charge * quantity, 2)
    document_numbers = fetch_next_document_numbers()
    initial_data["document_sequence"] = document_numbers
    initial_data["invoice_info"]["invoice_no"] = ""
    initial_data["invoice_info"]["linked_receipt_no"] = ""
    return initial_data


if __name__ == "__main__":
    GENERATED_DIR.mkdir(exist_ok=True)
    DATA_DIR.mkdir(exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 5000), InvoiceRequestHandler)
    print("Server running at http://127.0.0.1:5000")
    server.serve_forever()
