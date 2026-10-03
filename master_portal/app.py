from __future__ import annotations

import json
import mimetypes
import csv
import math
import re
from dataclasses import dataclass
from datetime import date, datetime, timezone
from difflib import SequenceMatcher
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import StringIO
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse
import sys

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from shared.supabase_rest import SupabaseError, SupabaseRestClient

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
TEMPLATES_DIR = BASE_DIR / "templates"


@dataclass(slots=True)
class FieldDef:
    name: str
    label: str
    field_type: str = "text"
    required: bool = False
    options: list[dict[str, str]] | None = None
    lookup: str | None = None
    read_only: bool = False
    textarea_rows: int = 3
    section_label: str | None = None


@dataclass(slots=True)
class EntityDef:
    slug: str
    table: str
    label: str
    nav_label: str
    group: str
    primary_key: str
    order: str
    search_fields: list[str]
    fields: list[FieldDef]
    columns: list[str]
    on_conflict: str | None = None
    limit: int = 500
    nav_hidden: bool = False

    @property
    def select_fields(self) -> str:
        seen: list[str] = []
        for name in [
            self.primary_key,
            *self.columns,
            *(field.name for field in self.fields),
        ]:
            if name not in seen:
                seen.append(name)
        return ",".join(seen)


def enum_options(*values: str) -> list[dict[str, str]]:
    return [
        {"value": value, "label": value.replace("_", " ").title()} for value in values
    ]


HSN_FIELD_OPTIONS = [
    ### --- ALL ITEMS BELOW ATTRACT 1.5% SGST + 1.5% CGST (or 3% IGST) = 3% GST --- ###
    # ── Gold Jewellery ──
    {"value": "71131910", "label": "71131910 · Gold Jewellery Unstudded (Plain)"},
    {"value": "71131920", "label": "71131920 · Gold Jewellery Set with Pearls (Studded)"},
    {"value": "71131930", "label": "71131930 · Gold Jewellery Set with Diamonds (Studded)"},
    {"value": "71131940", "label": "71131940 · Gold Jewellery Set with Other Precious & Semi-Precious Stones (Studded)"},
    {"value": "71131960", "label": "71131960 · Parts (Gold Jewellery)"},
    {"value": "71131990", "label": "71131990 · Others"},
    {"value": "71132000", "label": "71132000 · Gold Jewellery Clad with Precious Metal"},

    # ── Gold Semi-Manufactured ──
    {"value": "71081200", "label": "71081200 · Gold Unwrought (Bars)"},
    {"value": "71081300", "label": "71081300 · Gold (Other Semi-Manufactured Forms)"},
    {"value": "71082000", "label": "71082000 · Gold (Monetary)"},
    {"value": "71090000", "label": "71090000 · Base Metals or Silver Clad with Gold, Not Further Worked than Semi-Manufactured"},

    # ── Gold Articles ──
    {"value": "71141910", "label": "71141910 · Articles of Gold (Whether or Not Plated or Clad with Precious Metal)"},
    {"value": "71141930", "label": "71141930 · Parts (Articles of Gold)"},
    {"value": "71142010", "label": "71142010 · Articles Clad with Base Metal Gold"},
    {"value": "71142020", "label": "71142020 · Other Articles (Base Metal Gold)"},
    {"value": "71142030", "label": "71142030 · Parts (Articles of Base Metal Gold)"},

    # ── Silver Jewellery ──
    {"value": "71131110", "label": "71131110 · Silver Jewellery with Filigree Work"},
    {"value": "71131120", "label": "71131120 · Silver Jewellery Studded with Gems"},
    {"value": "71131130", "label": "71131130 · Other Articles of Silver Jewellery"},
    {"value": "71131190", "label": "71131190 · Parts (Silver Jewellery)"},

    # ── Silver Semi-Manufactured ──
    {"value": "71069100", "label": "71069100 · Silver Unwrought (Bars)"},
    {"value": "71069210", "label": "71069210 · Silver in Semi-Manufactured Form (Sheets, Plates, Strips, Tubes and Pipes)"},
    {"value": "71069290", "label": "71069290 · Silver in Semi-Manufactured Form (Others)"},
    {"value": "71070000", "label": "71070000 · Base Metals Clad with Silver, Not Further Worked than Semi-Manufactured"},

    # ── Silver Articles ──
    {"value": "71141110", "label": "71141110 · Articles of Silver (Whether or Not Plated or Clad with Precious Metal)"},
    {"value": "71141120", "label": "71141120 · Parts of Silver (Whether or Not Plated or Clad with Precious Metal)"},

    # ── Imitation Jewellery ──
    {"value": "71179010", "label": "71179010 · Jewellery Studded with Imitation Pearls or Imitation or Synthetic Stones"},
    {"value": "71171990", "label": "71171990 · Other Imitation Jewellery (Plain)"},
    {"value": "71179090", "label": "71179090 · Other Imitation Jewellery (Studded)"},
    {"value": "71171100", "label": "71171100 · Cuff-Links (Imitation Jewellery)"},
    {"value": "71171910", "label": "71171910 · Bangles (Imitation Jewellery)"},
    {"value": "71171920", "label": "71171920 · German Silver Jewellery (Imitation Jewellery)"},
    
    # ── Pearl / Precious & Semi-Precious Stone Articles ──
    {"value": "71161000", "label": "71161000 · Articles of Pearls (Natural or Cultured)"},
    {"value": "71162000", "label": "71162000 · Articles of Precious or Semi-Precious Stones (Natural, Synthetic or Reconstructed)"},
    
    # ── Pearls ──
    {"value": "71011010", "label": "71011010 · Natural Pearls Unworked"},
    {"value": "71011020", "label": "71011020 · Natural Pearls Worked"},
    {"value": "71012100", "label": "71012100 · Cultured Pearls Unworked"},
    {"value": "71012200", "label": "71012200 · Cultured Pearls Worked"},

    ### --- ALL ITEMS ABOVE ATTRACT 1.5% SGST + 1.5% CGST (or 3% IGST) = 3% GST --- ###

    ### --- ALL ITEMS BELOW ATTRACT 0.125% SGST + 0.125% CGST (or 0.25% IGST) = 0.25% GST --- ###

    # ── Worked Precious / Semi-Precious Stones ──
    {"value": "71039110", "label": "71039110 · Ruby (Worked Precious Stones)"},
    {"value": "71039120", "label": "71039120 · Sapphire (Worked Precious Stones)"},
    {"value": "71039130", "label": "71039130 · Emeralds (Worked Precious Stones)"},
    {"value": "71039911", "label": "71039911 · Yellow / Golden / Pink / Red / Green Beryl (Worked Semi-Precious Stones)"},
    {"value": "71039912", "label": "71039912 · Chrysoberyl (Including Chrysoberyl Cat's Eye) (Worked Semi-Precious Stones)"},
    {"value": "71039913", "label": "71039913 · Alexandrite (Including Alexandrite Cat's Eye) (Worked Semi-Precious Stones)"},
    {"value": "71039919", "label": "71039919 · Others (Worked Semi-Precious Stones)"},
    {"value": "71039921", "label": "71039921 · Moonstone (Worked Semi-Precious Stones)"},
    {"value": "71039929", "label": "71039929 · Others (Worked Semi-Precious Stones)"},
    {"value": "71039931", "label": "71039931 · Garnet (Worked Semi-Precious Stones)"},
    {"value": "71039932", "label": "71039932 · Lapis-Lazuli (Worked Semi-Precious Stones)"},
    {"value": "71039939", "label": "71039939 · Others (Worked Semi-Precious Stones)"},
    {"value": "71039941", "label": "71039941 · Prehnite (Worked Semi-Precious Stones)"},
    {"value": "71039942", "label": "71039942 · Agate (Worked Semi-Precious Stones)"},
    {"value": "71039943", "label": "71039943 · Aventurine (Worked Semi-Precious Stones)"},
    {"value": "71039944", "label": "71039944 · Chalcedony (Worked Semi-Precious Stones)"},
    {"value": "71039949", "label": "71039949 · Other (Worked Semi-Precious Stones)"},
    {"value": "71039951", "label": "71039951 · Tourmaline (Worked Semi-Precious Stones)"},
    {"value": "71039952", "label": "71039952 · Tanzanite (Worked Semi-Precious Stones)"},
    {"value": "71039959", "label": "71039959 · Other (Worked Semi-Precious Stones)"},
    {"value": "71039990", "label": "71039990 · Others (Worked Semi-Precious Stones)"},
     
    ### --- ALL ITEMS ABOVE ATTRACT 0.125% SGST + 0.125% CGST (or 0.25% IGST) = 0.25% GST --- ###
]

PURITY_FIELD_OPTIONS = [
    {
        "value": "22K",
        "label": "22K gold (916) · 91.6% pure, preferred for traditional jewellery and weddings",
    },
    {
        "value": "24K",
        "label": "24K gold (999) · 99.9% pure, mainly used in coins and bars",
    },
    {
        "value": "18K",
        "label": "18K gold (750) · 75% pure, commonly used in diamond-set jewellery",
    },
    {
        "value": "14K",
        "label": "14K gold (585) · 58.5% pure, typically for daily-wear or international designs",
    },
    {
        "value": "9K",
        "label": "9K gold (375) · 37.5% pure, permitted for low-budget or fashion jewellery projects since July 2025",
    },
    {"value": "925", "label": "Silver 925 · Sterling silver"},
    {"value": "999", "label": "Silver 999 · Fine silver"},
    {"value": "990", "label": "Silver 990 · Fine silver"},
    {"value": "970", "label": "Silver 970 · High purity"},
    {"value": "958", "label": "Silver 958 · Britannia silver"},
    {"value": "835", "label": "Silver 835 · European silver"},
    {"value": "800", "label": "Silver 800 · Coin silver"},
]

ORNAMENT_TYPE_OPTIONS = [
    {"value": "ring", "label": "Ring"},
    {"value": "bangle", "label": "Bangle"},
    {"value": "bracelet", "label": "Bracelet"},
    {"value": "chain", "label": "Chain"},
    {"value": "necklace", "label": "Necklace"},
    {"value": "pendant", "label": "Pendant"},
    {"value": "earring", "label": "Earring"},
    {"value": "nose_pin", "label": "Nose Pin"},
    {"value": "mangalsutra", "label": "Mangalsutra"},
    {"value": "coin", "label": "Coin / Bar"},
    {"value": "article", "label": "Article / Pooja Item"},
    {"value": "other", "label": "Other"},
]

ADVANCE_TRANSACTION_OPTIONS = [
    {"value": "cash", "label": "Cash"},
    {"value": "upi", "label": "UPI"},
    {"value": "card", "label": "Card"},
    {"value": "cheque", "label": "Cheque"},
    {"value": "bank_transfer", "label": "Bank Transfer"},
    {"value": "old_ornaments_valuation", "label": "Old Ornaments Valuation"},
]

# Indian states and union territories with their GST codes.
# The GST code is auto-mapped when the admin selects a state name.
INDIAN_STATES: dict[str, str] = {
    # States
    "Andhra Pradesh": "37",
    "Arunachal Pradesh": "12",
    "Assam": "18",
    "Bihar": "10",
    "Chhattisgarh": "22",
    "Goa": "30",
    "Gujarat": "24",
    "Haryana": "06",
    "Himachal Pradesh": "02",
    "Jharkhand": "20",
    "Karnataka": "29",
    "Kerala": "32",
    "Madhya Pradesh": "23",
    "Maharashtra": "27",
    "Manipur": "14",
    "Meghalaya": "17",
    "Mizoram": "15",
    "Nagaland": "13",
    "Odisha": "21",
    "Punjab": "03",
    "Rajasthan": "08",
    "Sikkim": "11",
    "Tamil Nadu": "33",
    "Telangana": "36",
    "Tripura": "16",
    "Uttar Pradesh": "09",
    "Uttarakhand": "05",
    "West Bengal": "19",
    # Union Territories
    "Andaman & Nicobar": "35",
    "Chandigarh": "04",
    "Dadra & Nagar Haveli and Daman & Diu": "26",
    "Delhi": "07",
    "Jammu & Kashmir": "01",
    "Ladakh": "38",
    "Lakshadweep": "31",
    "Puducherry": "34",
}

STATE_NAME_OPTIONS = [
    {"value": name, "label": f"{code} \u00b7 {name}"}
    for name, code in INDIAN_STATES.items()
]


ENTITY_GROUPS = [
    {"id": "masters", "label": "Master Data"},
    {"id": "stock", "label": "Stockbook"},
    {"id": "orders", "label": "Orderbook"},
    {"id": "sales", "label": "Billing And Documents"},
    {"id": "ledger", "label": "Ledger And Files"},
    {"id": "communications", "label": "Reminders"},
]


ENTITY_DEFS: list[EntityDef] = [
    EntityDef(
        slug="raw-metal-purchases",
        table="raw_metal_purchases",
        label="Raw Metal Stock",
        nav_label="Raw Metal Stock",
        group="stock",
        primary_key="id",
        order="purchase_date.desc,created_at.desc",
        search_fields=["metal", "source_name", "purchase_date"],
        columns=["purchase_date", "metal", "source_name", "weight_g", "rate_per_gram"],
        fields=[
            FieldDef("id", "ID", read_only=True),
            FieldDef("purchase_date", "Purchase Date", field_type="date", required=True),
            FieldDef("metal", "Metal", field_type="select", options=enum_options("gold", "silver"), required=True),
            FieldDef("source_name", "Source of Purchase", required=True),
            FieldDef("weight_g", "Weight (g)", field_type="number", required=True),
            FieldDef("rate_per_gram", "Rate per Gram (Rs.)", field_type="number", required=True),
        ],
        limit=10000,
    ),
    EntityDef(
        slug="customers",
        table="customers",
        label="Customers",
        nav_label="Customers",
        group="masters",
        primary_key="id",
        order="updated_at.desc",
        search_fields=[
            "full_name",
            "primary_contact",
            "secondary_contact",
            "email",
            "pan_aadhaar_no",
            "place_of_supply_name",
        ],
        columns=[
            "full_name",
            "primary_contact",
            "secondary_contact",
            "email",
            "place_of_supply_name",
            "marketing_opt_in",
            "updated_at",
        ],
        fields=[
            FieldDef("id", "ID", read_only=True),
            FieldDef("full_name", "Full Name", required=True),
            FieldDef("primary_contact", "Primary Contact", required=True),
            FieldDef("secondary_contact", "Secondary Contact"),
            FieldDef("email", "Email", field_type="email"),
            FieldDef("address_line", "Address", field_type="textarea"),
            FieldDef(
                "state_name",
                "State Name",
                field_type="select",
                options=STATE_NAME_OPTIONS,
                section_label="STATES",
            ),
            FieldDef(
                "state_gst_code",
                "State GST Code",
                read_only=True,
            ),
            FieldDef(
                "place_of_supply_name",
                "Place Of Supply",
                field_type="select",
                options=STATE_NAME_OPTIONS,
                section_label="STATES",
            ),
            FieldDef(
                "place_of_supply_gst_code",
                "Place Of Supply GST Code",
                read_only=True,
            ),
            FieldDef("pincode", "Pincode"),
            FieldDef("pan_aadhaar_no", "PAN / Aadhaar"),
            FieldDef("marketing_opt_in", "Marketing Opt-In", field_type="checkbox"),
            FieldDef("notes", "Notes", field_type="textarea"),
        ],
    ),
    EntityDef(
        slug="artisans",
        table="artisans",
        label="Artisans",
        nav_label="Artisans",
        group="masters",
        primary_key="id",
        order="updated_at.desc",
        search_fields=["name", "description"],
        columns=[
            "name",
            "description",
            "usual_making_charge_percent",
            "usual_cash_charged",
            "updated_at",
        ],
        fields=[
            FieldDef("id", "ID", read_only=True),
            FieldDef("name", "Name", required=True),
            FieldDef("description", "Description", field_type="textarea"),
            FieldDef(
                "usual_making_charge_percent",
                "Usual Making Charge Percent",
                field_type="number",
            ),
            FieldDef("usual_cash_charged", "Usual Cash Charged", field_type="number"),
        ],
    ),
    EntityDef(
        slug="stock-items",
        table="stock_items",
        label="Stock Items",
        nav_label="Stock Items",
        group="stock",
        primary_key="id",
        order="updated_at.desc",
        search_fields=[
            "stock_no",
            "huid",
            "description",
            "hsn_code",
            "purity",
            "goldsmith_name",
            "status",
            "ornament_type",
        ],
        columns=[
            "stock_no",
            "huid",
            "ornament_type",
            "purity",
            "quantity",
            "goldsmith_name",
            "status",
            "gross_weight_g",
            "net_weight_g",
            "updated_at",
        ],
        fields=[
            FieldDef("id", "ID", read_only=True),
            FieldDef("stock_no", "Stock No", required=True),
            FieldDef("huid", "HUID"),
            FieldDef("description", "Description", required=True),
            FieldDef(
                "hsn_code",
                "HSN Code",
                field_type="select",
                required=True,
                options=HSN_FIELD_OPTIONS,
            ),
            FieldDef(
                "ornament_type",
                "Ornament Type",
                field_type="select",
                options=ORNAMENT_TYPE_OPTIONS,
            ),
            FieldDef("quantity", "Quantity", field_type="integer", required=True),
            FieldDef(
                "purity",
                "Purity",
                field_type="select",
                options=PURITY_FIELD_OPTIONS,
            ),
            FieldDef(
                "gross_weight_g", "Gross Weight (g)", field_type="number"
            ),
            FieldDef("weight_entry_unit", "Weight Unit"),
            FieldDef("weight_ratti", "Weight (Ratti)", field_type="number"),
            FieldDef(
                "net_weight_g", "Net Weight (g)", field_type="number"
            ),
            FieldDef(
                "stone_weight_g", "Stone Weight (g)", field_type="number"
            ),
            FieldDef(
                "stone_amount", "Stone Amount", field_type="number"
            ),
            FieldDef("stone_expense", "Stone Expense", field_type="number"),
            FieldDef("stone_expense_entry_mode", "Stone Expense Mode"),
            FieldDef(
                "stone_expense_per_ratti",
                "Stone Expense / Ratti",
                field_type="number",
            ),
            FieldDef("stone_cost_entry_mode", "Stone Cost Mode"),
            FieldDef(
                "stone_cost_per_ratti", "Stone Cost / Ratti", field_type="number"
            ),
            FieldDef(
                "other_charges_amount",
                "Other Charges",
                field_type="number",
            ),
            FieldDef("silver_expense_entry_mode", "Silver Expense Mode"),
            FieldDef(
                "silver_expense_price_per_gm",
                "Silver Expense / gm",
                field_type="number",
            ),
            FieldDef("silver_cost_entry_mode", "Silver Cost Mode"),
            FieldDef(
                "silver_cost_price_per_gm", "Silver Cost / gm", field_type="number"
            ),
            FieldDef(
                "silver_cost_total_price",
                "Making Charges",
                field_type="number",
            ),
            FieldDef(
                "silver_other_expenses", "Silver Other Expenses", field_type="number"
            ),
            FieldDef(
                "making_charges_percent", "Making Charges Percent", field_type="number"
            ),
            FieldDef(
                "making_baseline", "Making Baseline", field_type="number"
            ),
            FieldDef(
                "artisan_id", "Primary Artisan", field_type="lookup", lookup="artisans"
            ),
            FieldDef("goldsmith_name", "Artisans"),
            FieldDef("goldsmith_loss", "Artisan Making", field_type="number"),
            FieldDef("other_expenses", "Other Expenses", field_type="number"),
            FieldDef(
                "profit_cash_amount",
                "Profit Cash Amount",
                field_type="number",
                read_only=True,
            ),
            FieldDef(
                "profit_excess_weight_g",
                "Total Weight Recouped (g)",
                field_type="number",
                read_only=True,
            ),
            FieldDef(
                "profit_calculated_at",
                "Profit Calculated At",
                field_type="datetime",
                read_only=True,
            ),
            FieldDef(
                "status",
                "Status",
                field_type="select",
                # New orders are always created in the lifecycle's Created stage.
                # Status changes are handled exclusively by the transition endpoint.
                required=False,
                options=enum_options(
                    "in_stock",
                    "reserved",
                    "sold",
                    "exchanged",
                    "returned",
                    "out_for_jobwork",
                    "inactive",
                ),
            ),
            FieldDef("notes", "Notes", field_type="textarea"),
        ],
    ),
    EntityDef(
        slug="stock-movements",
        table="stock_movements",
        label="Stock Movements",
        nav_label="Stock Movements",
        group="stock",
        primary_key="id",
        order="movement_at.desc",
        search_fields=["reference_type", "remarks"],
        columns=[
            "stock_item_id",
            "movement_at",
            "previous_status",
            "new_status",
            "quantity_delta",
            "reference_type",
            "reference_id",
        ],
        fields=[
            FieldDef("id", "ID", read_only=True),
            FieldDef(
                "stock_item_id",
                "Stock Item",
                field_type="lookup",
                required=True,
                lookup="stockItems",
            ),
            FieldDef(
                "movement_at", "Movement At", field_type="datetime", required=True
            ),
            FieldDef(
                "previous_status",
                "Previous Status",
                field_type="select",
                options=enum_options(
                    "in_stock",
                    "reserved",
                    "sold",
                    "exchanged",
                    "returned",
                    "out_for_jobwork",
                    "inactive",
                ),
            ),
            FieldDef(
                "new_status",
                "New Status",
                field_type="select",
                required=True,
                options=enum_options(
                    "in_stock",
                    "reserved",
                    "sold",
                    "exchanged",
                    "returned",
                    "out_for_jobwork",
                    "inactive",
                ),
            ),
            FieldDef(
                "quantity_delta", "Quantity Delta", field_type="integer", required=True
            ),
            FieldDef("reference_type", "Reference Type"),
            FieldDef("reference_id", "Reference ID"),
            FieldDef("remarks", "Remarks", field_type="textarea"),
        ],
    ),
    EntityDef(
        slug="orders",
        table="orders",
        label="Orders",
        nav_label="Orders",
        group="orders",
        primary_key="id",
        order="updated_at.desc",
        search_fields=["order_number", "status", "order_type", "remarks"],
        columns=[
            "order_number",
            "customer_id",
            "order_type",
            "order_date",
            "order_datetime",
            "promised_date",
            "status",
            "updated_at",
        ],
        nav_hidden=True,
        fields=[
            FieldDef("id", "ID", read_only=True),
            FieldDef("order_number", "Order Number", required=True),
            FieldDef(
                "customer_id", "Customer", field_type="lookup", lookup="customers"
            ),
            FieldDef(
                "order_type",
                "Order Type",
                field_type="select",
                required=True,
                options=enum_options(
                    "custom_order",
                    "stock_reservation",
                    "repair",
                    "alteration",
                    "special_request",
                ),
            ),
            FieldDef("order_date", "Order Date", field_type="date", required=True),
            FieldDef("order_datetime", "Order Date & Time", field_type="datetime"),
            FieldDef("promised_date", "Promised Date", field_type="date"),
            FieldDef(
                "status",
                "Status",
                field_type="select",
                required=False,
                options=enum_options(
                    "created", "in_progress", "finished", "pending_delivery", "delivered", "cancelled"
                ),
            ),
            FieldDef("remarks", "Remarks", field_type="textarea"),
        ],
    ),
    EntityDef(
        slug="order-items",
        table="order_items",
        label="Order Items",
        nav_label="Order Items",
        group="orders",
        primary_key="id",
        order="created_at.desc",
        search_fields=["description", "purity", "hsn_code", "status"],
        columns=[
            "order_id",
            "line_no",
            "stock_item_id",
            "description",
            "quantity",
            "status",
            "updated_at",
        ],
        nav_hidden=True,
        fields=[
            FieldDef("id", "ID", read_only=True),
            FieldDef(
                "order_id", "Order", field_type="lookup", required=True, lookup="orders"
            ),
            FieldDef(
                "stock_item_id",
                "Stock Number",
                field_type="lookup",
                lookup="stockItems",
            ),
            FieldDef("description", "Description", required=True),
            FieldDef("quantity", "Quantity", field_type="integer"),
            FieldDef("approx_weight_g", "Approx Weight (g)", field_type="number"),
            FieldDef(
                "purity", "Purity", field_type="select", options=PURITY_FIELD_OPTIONS
            ),
            FieldDef(
                "hsn_code", "HSN Code", field_type="select", options=HSN_FIELD_OPTIONS
            ),
            FieldDef(
                "predetermined_rate_per_gram",
                "Predetermined Rate / g",
                field_type="number",
            ),
            FieldDef(
                "predetermined_making_charges_amount",
                "Predetermined Making Charges Amount",
                field_type="number",
            ),
            FieldDef(
                "predetermined_making_charges_percent",
                "Predetermined Making Charges Percent",
                field_type="number",
            ),
            FieldDef("other_charges_amount", "Other Charges", field_type="number"),
            FieldDef("stone_amount", "Stone Amount (Approx.)", field_type="number"),
            FieldDef("status", "Status", required=True),
            FieldDef("design_notes", "Design Notes", field_type="textarea"),
        ],
    ),
    EntityDef(
        slug="advance-receipts",
        table="advance_receipts",
        label="Advance Receipts",
        nav_label="Advance Receipts",
        group="sales",
        primary_key="id",
        order="receipt_datetime.desc",
        search_fields=[
            "receipt_no",
            "customer_name",
            "customer_contact_primary",
            "customer_email",
            "transaction_type",
            "valuation_description",
            "remarks",
        ],
        columns=[
            "receipt_no",
            "order_id",
            "transaction_type",
            "receipt_datetime",
            "amount",
            "updated_at",
        ],
        nav_hidden=True,
        fields=[
            FieldDef("id", "ID", read_only=True),
            FieldDef("receipt_no", "Receipt No", required=True),
            FieldDef(
                "order_id", "Order", field_type="lookup", required=True, lookup="orders"
            ),
            FieldDef(
                "customer_id",
                "Customer",
                field_type="lookup",
                required=True,
                lookup="customers",
            ),
            FieldDef("receipt_id", "Receipt", field_type="lookup", lookup="receipts"),
            FieldDef(
                "receipt_datetime",
                "Receipt Datetime",
                field_type="datetime",
                required=True,
            ),
            FieldDef("customer_name", "Customer Name", required=True),
            FieldDef("customer_contact_primary", "Customer Primary Contact"),
            FieldDef("customer_email", "Customer Email", field_type="email"),
            FieldDef(
                "transaction_type",
                "Transaction Type",
                field_type="select",
                required=True,
                options=ADVANCE_TRANSACTION_OPTIONS,
            ),
            FieldDef("valuation_description", "Description", field_type="textarea"),
            FieldDef("amount", "Amount", field_type="number", required=True),
            FieldDef("remarks", "Remarks", field_type="textarea"),
        ],
    ),
    EntityDef(
        slug="invoices",
        table="invoices",
        label="Invoices",
        nav_label="Invoices",
        group="sales",
        primary_key="id",
        order="invoice_datetime.desc",
        search_fields=[
            "invoice_no",
            "linked_reference_no",
            "customer_name",
            "customer_contact_primary",
            "status",
        ],
        columns=[
            "invoice_no",
            "customer_name",
            "customer_email",
            "invoice_datetime",
            "status",
            "net_payable_amount",
            "balance_due_amount",
            "updated_at",
        ],
        nav_hidden=True,
        fields=[
            FieldDef("id", "ID", read_only=True),
            FieldDef("invoice_no", "Invoice No", required=True),
            FieldDef(
                "customer_id", "Customer", field_type="lookup", lookup="customers"
            ),
            FieldDef("order_id", "Order", field_type="lookup", lookup="orders"),
            FieldDef("linked_reference_no", "Linked Reference No"),
            FieldDef(
                "invoice_datetime",
                "Invoice Datetime",
                field_type="datetime",
                required=True,
            ),
            FieldDef("source_order_date", "Source Order Date", field_type="date"),
            FieldDef("copy_type", "Copy Type"),
            FieldDef(
                "status",
                "Status",
                field_type="select",
                required=True,
                options=enum_options(
                    "draft", "issued", "partially_paid", "paid", "cancelled"
                ),
            ),
            FieldDef("customer_name", "Customer Name", required=True),
            FieldDef("customer_contact_primary", "Customer Primary Contact"),
            FieldDef("customer_contact_secondary", "Customer Secondary Contact"),
            FieldDef("customer_email", "Customer Email", field_type="email"),
            FieldDef("customer_address", "Customer Address", field_type="textarea"),
            FieldDef("customer_state_name", "Customer State Name"),
            FieldDef("customer_state_gst_code", "Customer State GST Code"),
            FieldDef("place_of_supply_name", "Place Of Supply"),
            FieldDef("place_of_supply_gst_code", "Place Of Supply GST Code"),
            FieldDef("customer_pincode", "Customer Pincode"),
            FieldDef("customer_pan_aadhaar_no", "Customer PAN / Aadhaar"),
            FieldDef("consignee_name", "Consignee Name"),
            FieldDef("consignee_contact_primary", "Consignee Primary Contact"),
            FieldDef("consignee_contact_secondary", "Consignee Secondary Contact"),
            FieldDef("consignee_address", "Consignee Address", field_type="textarea"),
            FieldDef("consignee_state_name", "Consignee State Name"),
            FieldDef("consignee_state_gst_code", "Consignee State GST Code"),
            FieldDef("consignee_pincode", "Consignee Pincode"),
            FieldDef("consignee_pan_aadhaar_no", "Consignee PAN / Aadhaar"),
            FieldDef(
                "items_total_amount",
                "Items Total Amount",
                field_type="number",
                read_only=True,
            ),
            FieldDef(
                "discount_amount", "Discount Amount", field_type="number", required=True
            ),
            FieldDef(
                "taxable_amount", "Taxable Amount", field_type="number", read_only=True
            ),
            FieldDef(
                "sgst_percent", "SGST Percent", field_type="number", read_only=True
            ),
            FieldDef("sgst_amount", "SGST Amount", field_type="number", read_only=True),
            FieldDef(
                "cgst_percent", "CGST Percent", field_type="number", read_only=True
            ),
            FieldDef("cgst_amount", "CGST Amount", field_type="number", read_only=True),
            FieldDef(
                "igst_percent", "IGST Percent", field_type="number", read_only=True
            ),
            FieldDef("igst_amount", "IGST Amount", field_type="number", read_only=True),
            FieldDef(
                "total_tax_amount",
                "Total Tax Amount",
                field_type="number",
                read_only=True,
            ),
            FieldDef(
                "gross_invoice_total",
                "Gross Invoice Total",
                field_type="number",
                read_only=True,
            ),
            FieldDef(
                "round_off_amount",
                "Round Off Amount",
                field_type="number",
                read_only=True,
            ),
            FieldDef(
                "old_gold_advance_amount",
                "Old Gold / Advance Amount",
                field_type="number",
                required=True,
            ),
            FieldDef(
                "net_payable_amount",
                "Net Payable Amount",
                field_type="number",
                read_only=True,
            ),
            FieldDef(
                "amount_received", "Amount Received", field_type="number", required=True
            ),
            FieldDef(
                "balance_due_amount",
                "Balance Due Amount",
                field_type="number",
                read_only=True,
            ),
            FieldDef("remarks", "Remarks", field_type="textarea"),
            FieldDef("narration", "Narration", field_type="textarea"),
        ],
    ),
    EntityDef(
        slug="invoice-items",
        table="invoice_items",
        label="Invoice Items",
        nav_label="Invoice Items",
        group="sales",
        primary_key="id",
        order="line_no.asc",
        search_fields=["stock_no", "huid", "description", "purity", "hsn_code"],
        columns=[
            "invoice_id",
            "line_no",
            "stock_no",
            "description",
            "quantity",
            "gold_silver_rate",
            "line_total_amount",
        ],
        nav_hidden=True,
        fields=[
            FieldDef("id", "ID", read_only=True),
            FieldDef(
                "invoice_id",
                "Invoice",
                field_type="lookup",
                required=True,
                lookup="invoices",
            ),
            FieldDef(
                "stock_item_id", "Stock Item", field_type="lookup", lookup="stockItems"
            ),
            FieldDef("line_no", "Line No", field_type="integer", required=True),
            FieldDef("stock_no", "Stock No"),
            FieldDef("huid", "HUID"),
            FieldDef("description", "Description", required=True),
            FieldDef("quantity", "Quantity", field_type="integer", required=True),
            FieldDef(
                "hsn_code", "HSN Code", field_type="select", options=HSN_FIELD_OPTIONS
            ),
            FieldDef(
                "purity", "Purity", field_type="select", options=PURITY_FIELD_OPTIONS
            ),
            FieldDef(
                "gross_weight_g", "Gross Weight (g)", field_type="number", required=True
            ),
            FieldDef(
                "net_weight_g", "Net Weight (g)", field_type="number", required=True
            ),
            FieldDef("gold_silver_rate", "Gold / Silver Rate", field_type="number"),
            FieldDef(
                "rate_per_gram", "Rate Per Gram", field_type="number", required=True
            ),
            FieldDef(
                "gold_silver_amount",
                "Gold / Silver Amount",
                field_type="number",
                required=True,
            ),
            FieldDef(
                "stone_weight_g", "Stone Weight (g)", field_type="number", required=True
            ),
            FieldDef(
                "stone_amount", "Stone Amount", field_type="number", required=True
            ),
            FieldDef("stone_expense", "Stone Expense", field_type="number"),
            FieldDef(
                "other_charges_amount",
                "Other Charges",
                field_type="number",
                required=True,
            ),
            FieldDef(
                "making_charges_amount",
                "Making Charges Amount",
                field_type="number",
                required=True,
            ),
            FieldDef(
                "making_charges_percent", "Making Charges Percent", field_type="number"
            ),
            FieldDef("making_baseline", "Making Baseline", field_type="number"),
            FieldDef("goldsmith_loss", "Artisan Loss", field_type="number"),
            FieldDef("other_expenses", "Other Expenses", field_type="number"),
            FieldDef("profit_cash_amount", "Profit Cash Amount", field_type="number"),
            FieldDef(
                "profit_excess_weight_g",
                "Total Weight Recouped (g)",
                field_type="number",
            ),
            FieldDef(
                "negotiated_total_amount_with_tax",
                "Negotiated Total Amount With Tax",
                field_type="number",
            ),
            FieldDef(
                "line_total_amount",
                "Line Total Amount",
                field_type="number",
                required=True,
            ),
        ],
    ),
    EntityDef(
        slug="receipts",
        table="receipts",
        label="Receipts",
        nav_label="Receipts",
        group="sales",
        primary_key="id",
        order="receipt_datetime.desc",
        search_fields=[
            "receipt_no",
            "linked_reference_no",
            "customer_name",
            "customer_contact_primary",
            "status",
        ],
        columns=[
            "receipt_no",
            "customer_name",
            "customer_email",
            "receipt_datetime",
            "status",
            "net_amount",
            "amount_received",
            "updated_at",
        ],
        nav_hidden=True,
        fields=[
            FieldDef("id", "ID", read_only=True),
            FieldDef("receipt_no", "Receipt No", required=True),
            FieldDef(
                "customer_id", "Customer", field_type="lookup", lookup="customers"
            ),
            FieldDef("linked_reference_no", "Linked Reference No"),
            FieldDef(
                "linked_invoice_id",
                "Linked Invoice",
                field_type="lookup",
                lookup="invoices",
            ),
            FieldDef(
                "receipt_datetime",
                "Receipt Datetime",
                field_type="datetime",
                required=True,
            ),
            FieldDef("copy_type", "Copy Type"),
            FieldDef(
                "status",
                "Status",
                field_type="select",
                required=True,
                options=enum_options(
                    "draft", "issued", "partially_paid", "paid", "cancelled"
                ),
            ),
            FieldDef("customer_name", "Customer Name", required=True),
            FieldDef("customer_contact_primary", "Customer Primary Contact"),
            FieldDef("customer_contact_secondary", "Customer Secondary Contact"),
            FieldDef("customer_email", "Customer Email", field_type="email"),
            FieldDef("customer_address", "Customer Address", field_type="textarea"),
            FieldDef("customer_state_name", "Customer State Name"),
            FieldDef("customer_state_gst_code", "Customer State GST Code"),
            FieldDef("customer_pincode", "Customer Pincode"),
            FieldDef("customer_pan_aadhaar_no", "Customer PAN / Aadhaar"),
            FieldDef(
                "gross_amount", "Gross Amount", field_type="number", required=True
            ),
            FieldDef(
                "less_invoice_amount",
                "Less Invoice Amount",
                field_type="number",
                required=True,
            ),
            FieldDef(
                "discount_amount", "Discount Amount", field_type="number", required=True
            ),
            FieldDef(
                "round_off_amount",
                "Round Off Amount",
                field_type="number",
                required=True,
            ),
            FieldDef("net_amount", "Net Amount", field_type="number", required=True),
            FieldDef(
                "amount_received", "Amount Received", field_type="number", required=True
            ),
            FieldDef("remarks", "Remarks", field_type="textarea"),
            FieldDef("narration", "Narration", field_type="textarea"),
        ],
    ),
    EntityDef(
        slug="receipt-items",
        table="receipt_items",
        label="Receipt Items",
        nav_label="Receipt Items",
        group="sales",
        primary_key="id",
        order="line_no.asc",
        search_fields=["description", "purity"],
        columns=[
            "receipt_id",
            "line_no",
            "description",
            "purity",
            "gross_weight_g",
            "net_weight_g",
            "line_total_amount",
        ],
        nav_hidden=True,
        fields=[
            FieldDef("id", "ID", read_only=True),
            FieldDef(
                "receipt_id",
                "Receipt",
                field_type="lookup",
                required=True,
                lookup="receipts",
            ),
            FieldDef("line_no", "Line No", field_type="integer", required=True),
            FieldDef("description", "Description", required=True),
            FieldDef("purity", "Purity"),
            FieldDef(
                "gross_weight_g", "Gross Weight (g)", field_type="number", required=True
            ),
            FieldDef(
                "net_weight_g", "Net Weight (g)", field_type="number", required=True
            ),
            FieldDef(
                "rate_per_gram", "Rate Per Gram", field_type="number", required=True
            ),
            FieldDef(
                "line_total_amount",
                "Line Total Amount",
                field_type="number",
                required=True,
            ),
        ],
    ),
    EntityDef(
        slug="payment-transactions",
        table="payment_transactions",
        label="Payment Transactions",
        nav_label="Payments",
        group="ledger",
        primary_key="id",
        order="transaction_datetime.desc",
        search_fields=[
            "transaction_number",
            "direction",
            "source_type",
            "reference_no",
            "remarks",
            "linked_document_id",
            "document_type",
            "document_number",
        ],
        columns=[
            "transaction_number",
            "transaction_datetime",
            "direction",
            "source_type",
            "total_amount",
            "reference_no",
            "updated_at",
        ],
        fields=[
            FieldDef("id", "ID", read_only=True),
            FieldDef("transaction_number", "Transaction Number", required=True),
            FieldDef(
                "transaction_datetime",
                "Transaction Datetime",
                field_type="datetime",
                required=True,
            ),
            FieldDef(
                "customer_id", "Customer", field_type="lookup", lookup="customers"
            ),
            FieldDef(
                "direction",
                "Payment Direction",
                field_type="select",
                required=True,
                options=enum_options("in", "out"),
            ),
            FieldDef(
                "source_type",
                "Document Type",
                field_type="select",
                required=True,
                options=enum_options("invoice", "advance_receipt", "receipt", "manual"),
            ),
            FieldDef("invoice_id", "Invoice", field_type="lookup", lookup="invoices"),
            FieldDef(
                "advance_receipt_id",
                "Advance Receipt",
                field_type="lookup",
                lookup="advanceReceipts",
            ),
            FieldDef("receipt_id", "Receipt", field_type="lookup", lookup="receipts"),
            FieldDef(
                "total_amount", "Total Amount", field_type="number", required=True
            ),
            FieldDef("reference_no", "Reference No"),
            FieldDef("remarks", "Remarks", field_type="textarea"),
        ],
    ),
    EntityDef(
        slug="payment-transaction-tenders",
        table="payment_transaction_tenders",
        label="Payment Transaction Tenders",
        nav_label="Tenders",
        group="ledger",
        primary_key="id",
        order="payment_mode.asc",
        search_fields=[
            "payment_mode",
            "instrument_label",
            "instrument_number",
            "account_number",
        ],
        columns=[
            "payment_transaction_id",
            "payment_mode",
            "amount",
            "instrument_label",
            "instrument_number",
            "account_number",
        ],
        nav_hidden=True,
        fields=[
            FieldDef("id", "ID", read_only=True),
            FieldDef(
                "payment_transaction_id",
                "Payment Transaction",
                field_type="lookup",
                required=True,
                lookup="paymentTransactions",
            ),
            FieldDef(
                "payment_mode",
                "Payment Mode",
                field_type="select",
                required=True,
                options=enum_options(
                    "cash", "upi", "card", "cheque", "bank_transfer", "adjustment"
                ),
            ),
            FieldDef("amount", "Amount", field_type="number", required=True),
            FieldDef("instrument_label", "Instrument Label"),
            FieldDef("instrument_number", "Instrument Number"),
            FieldDef("account_number", "Account Number"),
        ],
    ),
    EntityDef(
        slug="document-files",
        table="document_files",
        label="Document Files",
        nav_label="Files",
        group="ledger",
        primary_key="id",
        order="generated_at.desc",
        search_fields=["document_type", "file_name", "file_path", "mime_type", "notes"],
        columns=[
            "document_type",
            "document_id",
            "file_name",
            "file_path",
            "mime_type",
            "generated_at",
        ],
        fields=[
            FieldDef("id", "ID", read_only=True),
            FieldDef("document_type", "Document Type", required=True),
            FieldDef("document_id", "Document ID", required=True),
            FieldDef("file_name", "File Name", required=True),
            FieldDef("file_path", "File Path", required=True),
            FieldDef("mime_type", "Mime Type", required=True),
            FieldDef(
                "generated_at", "Generated At", field_type="datetime", required=True
            ),
            FieldDef("notes", "Notes", field_type="textarea"),
        ],
    ),
    EntityDef(
        slug="notifications",
        table="notifications",
        label="Notifications",
        nav_label="Notifications",
        group="communications",
        primary_key="id",
        order="reminder_at.asc",
        search_fields=[
            "subject",
            "body",
            "status",
            "customer_name",
            "artisan_name",
            "order_number",
            "invoice_no",
            "receipt_no",
        ],
        columns=[
            "subject",
            "status",
            "reminder_at",
            "closed_at",
            "customer_id",
            "artisan_id",
            "order_id",
            "invoice_id",
            "receipt_id",
            "updated_at",
        ],
        fields=[
            FieldDef("id", "ID", read_only=True),
            FieldDef("subject", "Subject", required=True),
            FieldDef("body", "Body", field_type="textarea", textarea_rows=4),
            FieldDef(
                "customer_id", "Customer", field_type="lookup", lookup="customers"
            ),
            FieldDef("artisan_id", "Artisan", field_type="lookup", lookup="artisans"),
            FieldDef("order_id", "Order Number", field_type="lookup", lookup="orders"),
            FieldDef(
                "invoice_id", "Invoice Number", field_type="lookup", lookup="invoices"
            ),
            FieldDef(
                "receipt_id", "Receipt Number", field_type="lookup", lookup="receipts"
            ),
            FieldDef(
                "reminder_at", "Reminder At", field_type="datetime", required=True
            ),
        ],
        limit=1000,
    ),
]

ENTITY_BY_SLUG = {entity.slug: entity for entity in ENTITY_DEFS}
ENTITY_BY_TABLE = {entity.table: entity for entity in ENTITY_DEFS}

LOOKUP_SPECS = {
    "customers": {
        "table": "customers",
        "select": "id,full_name,primary_contact",
        "order": "full_name.asc",
        "value": "id",
        "label_fields": ["full_name", "primary_contact"],
    },
    "artisans": {
        "table": "artisans",
        "select": "id,name,description,usual_cash_charged",
        "order": "name.asc",
        "value": "id",
        "label_fields": ["name", "description"],
    },
    "stockItems": {
        "table": "stock_items",
        "select": "id,stock_no,description",
        "order": "stock_no.asc",
        "value": "id",
        "label_fields": ["stock_no", "description"],
    },
    "orders": {
        "table": "orders",
        "select": "id,order_number",
        "order": "order_number.asc",
        "value": "id",
        "label_fields": ["order_number"],
    },
    "advanceReceipts": {
        "table": "advance_receipts",
        "select": "id,receipt_no",
        "order": "receipt_no.asc",
        "value": "id",
        "label_fields": ["receipt_no"],
    },
    "invoices": {
        "table": "invoices",
        "select": "id,invoice_no,customer_name",
        "order": "invoice_no.asc",
        "value": "id",
        "label_fields": ["invoice_no", "customer_name"],
    },
    "receipts": {
        "table": "receipts",
        "select": "id,receipt_no,customer_name",
        "order": "receipt_no.asc",
        "value": "id",
        "label_fields": ["receipt_no", "customer_name"],
    },
    "paymentTransactions": {
        "table": "payment_transactions",
        "select": "id,transaction_number",
        "order": "transaction_number.asc",
        "value": "id",
        "label_fields": ["transaction_number"],
    },
    "notifications": {
        "table": "notifications",
        "select": "id,subject,reminder_at",
        "order": "reminder_at.asc",
        "value": "id",
        "label_fields": ["subject", "reminder_at"],
    },
}

DELETE_RELATIONSHIPS = {
    "customers": [
        {"table": "orders", "field": "customer_id", "label": "orders"},
        {
            "table": "advance_receipts",
            "field": "customer_id",
            "label": "advance receipts",
        },
        {"table": "invoices", "field": "customer_id", "label": "invoices"},
        {"table": "receipts", "field": "customer_id", "label": "receipts"},
        {
            "table": "payment_transactions",
            "field": "customer_id",
            "label": "payment transactions",
        },
        {"table": "notifications", "field": "customer_id", "label": "notifications"},
    ],
    "artisans": [
        {
            "table": "stock_item_artisans",
            "field": "artisan_id",
            "label": "stock item artisan links",
            "cascade": True,
        },
        {
            "table": "stock_items",
            "field": "artisan_id",
            "label": "primary stock item links",
        },
        {"table": "notifications", "field": "artisan_id", "label": "notifications"},
    ],
    "stock_items": [
        {
            "table": "stock_item_artisans",
            "field": "stock_item_id",
            "label": "artisan links",
            "cascade": True,
        },
        {
            "table": "stock_movements",
            "field": "stock_item_id",
            "label": "stock movements",
            "cascade": True,
        },
        {"table": "order_items", "field": "stock_item_id", "label": "order items"},
        {"table": "invoice_items", "field": "stock_item_id", "label": "invoice items"},
    ],
    "orders": [
        {
            "table": "order_items",
            "field": "order_id",
            "label": "order items",
            "cascade": True,
        },
        {"table": "advance_receipts", "field": "order_id", "label": "advance receipts"},
        {"table": "invoices", "field": "order_id", "label": "invoices"},
        {"table": "notifications", "field": "order_id", "label": "notifications"},
    ],
    "advance_receipts": [
        {"table": "receipts", "field": "receipt_id", "label": "receipts"},
        {
            "table": "payment_transactions",
            "field": "advance_receipt_id",
            "label": "payment transactions",
            "cascade": True,
        },
    ],
    "invoices": [
        {
            "table": "invoice_items",
            "field": "invoice_id",
            "label": "invoice items",
            "cascade": True,
        },
        {
            "table": "payment_transactions",
            "field": "invoice_id",
            "label": "payment transactions",
        },
        {"table": "receipts", "field": "linked_invoice_id", "label": "receipts"},
        {"table": "notifications", "field": "invoice_id", "label": "notifications"},
    ],
    "receipts": [
        {
            "table": "receipt_items",
            "field": "receipt_id",
            "label": "receipt items",
            "cascade": True,
        },
        {
            "table": "payment_transactions",
            "field": "receipt_id",
            "label": "payment transactions",
            "cascade": True,
        },
        {
            "table": "notifications",
            "field": "receipt_id",
            "label": "notifications",
            "cascade": True,
        },
    ],
    "payment_transactions": [
        {
            "table": "payment_transaction_tenders",
            "field": "payment_transaction_id",
            "label": "payment tenders",
            "cascade": True,
        },
    ],
}

# These are the records a user may explicitly remove while deleting a customer.
# The identifier fields are selected separately from the normal entity metadata so
# the delete confirmation can show an unambiguous, human-readable checkbox.
CUSTOMER_LINKED_RECORDS = {
    "orders": {"field": "customer_id", "label": "Order", "select": "id,order_number", "label_field": "order_number"},
    "advance_receipts": {
        "field": "customer_id",
        "label": "Advance receipt",
        "select": "id,receipt_no",
        "label_field": "receipt_no",
    },
    "invoices": {"field": "customer_id", "label": "Invoice", "select": "id,invoice_no", "label_field": "invoice_no"},
    "receipts": {"field": "customer_id", "label": "Receipt", "select": "id,receipt_no", "label_field": "receipt_no"},
    "payment_transactions": {
        "field": "customer_id",
        "label": "Payment transaction",
        "select": "id,transaction_number",
        "label_field": "transaction_number",
    },
    "notifications": {"field": "customer_id", "label": "Notification", "select": "id,subject", "label_field": "subject"},
}


def load_single_row(
    client: SupabaseRestClient,
    table: str,
    *,
    select: str,
    filters: dict[str, str],
) -> dict[str, Any] | None:
    rows = client.select_rows(table, select=select, filters=filters, limit=1)
    return rows[0] if rows else None


def delete_payment_transactions(
    client: SupabaseRestClient,
    *,
    receipt_id: str | None = None,
    advance_receipt_id: str | None = None,
) -> None:
    transaction_ids: set[str] = set()
    if receipt_id:
        rows = client.select_rows(
            "payment_transactions",
            select="id",
            filters={"receipt_id": f"eq.{receipt_id}"},
            limit=500,
        )
        transaction_ids.update(
            str(row.get("id") or "").strip()
            for row in rows
            if str(row.get("id") or "").strip()
        )
    if advance_receipt_id:
        rows = client.select_rows(
            "payment_transactions",
            select="id",
            filters={"advance_receipt_id": f"eq.{advance_receipt_id}"},
            limit=500,
        )
        transaction_ids.update(
            str(row.get("id") or "").strip()
            for row in rows
            if str(row.get("id") or "").strip()
        )
    if not transaction_ids:
        return
    joined_ids = ",".join(sorted(transaction_ids))
    client.delete_rows(
        "payment_transaction_tenders",
        filters={"payment_transaction_id": f"in.({joined_ids})"},
    )
    client.delete_rows("payment_transactions", filters={"id": f"in.({joined_ids})"})


def delete_receipt_dependencies(client: SupabaseRestClient, receipt_id: str) -> None:
    delete_payment_transactions(client, receipt_id=receipt_id)
    client.delete_rows("receipt_items", filters={"receipt_id": f"eq.{receipt_id}"})
    client.delete_rows("notifications", filters={"receipt_id": f"eq.{receipt_id}"})


def delete_advance_receipt_dependencies(
    client: SupabaseRestClient, advance_receipt_id: str
) -> None:
    delete_payment_transactions(client, advance_receipt_id=advance_receipt_id)


def delete_old_ornament_bundle(
    client: SupabaseRestClient,
    *,
    advance_receipt_id: str,
    receipt_id: str,
) -> None:
    delete_payment_transactions(
        client, receipt_id=receipt_id, advance_receipt_id=advance_receipt_id
    )
    client.delete_rows("receipt_items", filters={"receipt_id": f"eq.{receipt_id}"})
    client.delete_rows("notifications", filters={"receipt_id": f"eq.{receipt_id}"})
    client.delete_rows("advance_receipts", filters={"id": f"eq.{advance_receipt_id}"})
    client.delete_rows("receipts", filters={"id": f"eq.{receipt_id}"})


def safe_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def normalize_datetime_local(value: str | None) -> str | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    formats = (
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%d/%m/%Y %H:%M",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y",
        "%Y-%m-%d",
    )
    for fmt in formats:
        try:
            return datetime.strptime(text, fmt).isoformat(timespec="seconds")
        except ValueError:
            continue
    return text


def normalize_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    text = str(value or "").strip().lower()
    return text in {"1", "true", "yes", "on"}


def normalize_number(value: Any, *, integer: bool = False) -> int | float | None:
    text = str(value or "").strip()
    if not text:
        return None
    number = float(text)
    if integer:
        return int(number)
    return number


def normalize_json_value(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    text = str(value or "").strip()
    if not text:
        return {}
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError("Metadata JSON must be an object.")
    return parsed


def normalize_array_value(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value or "").replace("\n", ",")
    return [part.strip() for part in text.split(",") if part.strip()]


def clean_text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def build_payment_transaction_number(
    source_type: str, linked_id: str | None = None
) -> str:
    prefix = {
        "invoice": "TXN-INV",
        "receipt": "TXN-REC",
        "advance_receipt": "TXN-ADV",
        "manual": "TXN-MAN",
    }.get(source_type, "TXN-PAY")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    if linked_id:
        compact = re.sub(r"[^A-Za-z0-9]", "", linked_id)[-6:] or "DOC"
        return f"{prefix}-{compact}-{stamp}"
    return f"{prefix}-{stamp}"


def infer_payment_transaction_customer_id(
    client: SupabaseRestClient,
    source_type: str,
    *,
    invoice_id: str | None = None,
    receipt_id: str | None = None,
    advance_receipt_id: str | None = None,
) -> str | None:
    if source_type == "invoice" and invoice_id:
        invoice = load_single_row(
            client, "invoices", select="customer_id", filters={"id": f"eq.{invoice_id}"}
        )
        return clean_text((invoice or {}).get("customer_id"))
    if source_type == "receipt" and receipt_id:
        receipt = load_single_row(
            client, "receipts", select="customer_id", filters={"id": f"eq.{receipt_id}"}
        )
        return clean_text((receipt or {}).get("customer_id"))
    if source_type == "advance_receipt" and advance_receipt_id:
        advance_receipt = load_single_row(
            client,
            "advance_receipts",
            select="customer_id",
            filters={"id": f"eq.{advance_receipt_id}"},
        )
        return clean_text((advance_receipt or {}).get("customer_id"))
    return None


def prepare_payment_transaction_row(
    client: SupabaseRestClient,
    payload: dict[str, Any],
    row: dict[str, Any],
) -> dict[str, Any]:
    source_type = clean_text(row.get("source_type")) or "manual"
    invoice_id = clean_text(row.get("invoice_id"))
    receipt_id = clean_text(row.get("receipt_id"))
    advance_receipt_id = clean_text(row.get("advance_receipt_id"))

    if source_type == "invoice":
        if not invoice_id:
            raise ValueError("Invoice is required.")
        receipt_id = None
        advance_receipt_id = None
    elif source_type == "receipt":
        if not receipt_id:
            raise ValueError("Receipt is required.")
        invoice_id = None
        advance_receipt_id = None
    elif source_type == "advance_receipt":
        if not advance_receipt_id:
            raise ValueError("Advance Receipt is required.")
        invoice_id = None
        receipt_id = None
    else:
        invoice_id = None
        receipt_id = None
        advance_receipt_id = None

    if invoice_id is not None:
        row["invoice_id"] = invoice_id
    else:
        row.pop("invoice_id", None)
    if receipt_id is not None:
        row["receipt_id"] = receipt_id
    else:
        row.pop("receipt_id", None)
    if advance_receipt_id is not None:
        row["advance_receipt_id"] = advance_receipt_id
    else:
        row.pop("advance_receipt_id", None)

    linked_id = invoice_id or receipt_id or advance_receipt_id
    if not clean_text(row.get("transaction_number")):
        row["transaction_number"] = build_payment_transaction_number(
            source_type, linked_id
        )

    if not clean_text(row.get("customer_id")):
        customer_id = infer_payment_transaction_customer_id(
            client,
            source_type,
            invoice_id=invoice_id,
            receipt_id=receipt_id,
            advance_receipt_id=advance_receipt_id,
        )
        if customer_id:
            row["customer_id"] = customer_id

    return row


def sync_advance_receipt_payment_transaction(
    client: SupabaseRestClient,
    advance_receipt_id: str,
) -> None:
    advance_receipt = load_single_row(
        client,
        "advance_receipts",
        select="id,receipt_no,receipt_datetime,customer_id,amount,transaction_type,valuation_description",
        filters={"id": f"eq.{advance_receipt_id}"},
    )
    if not advance_receipt:
        return

    existing = load_single_row(
        client,
        "payment_transactions",
        select="id,transaction_number,reference_no",
        filters={"advance_receipt_id": f"eq.{advance_receipt_id}"},
    )
    transaction_number = clean_text(
        (existing or {}).get("transaction_number")
    ) or build_payment_transaction_number(
        "advance_receipt",
        clean_text(advance_receipt.get("id")),
    )
    reference_no = clean_text((existing or {}).get("reference_no")) or clean_text(
        advance_receipt.get("receipt_no")
    )
    remarks = clean_text(advance_receipt.get("valuation_description"))
    if advance_receipt.get("transaction_type") == "old_ornaments_valuation":
        remarks = remarks or "Old ornaments valuation"

    payment_transaction_row = {
        "transaction_number": transaction_number,
        "transaction_datetime": advance_receipt.get("receipt_datetime")
        or datetime.now(timezone.utc).isoformat(),
        "customer_id": clean_text(advance_receipt.get("customer_id")),
        "direction": "in",
        "source_type": "advance_receipt",
        "advance_receipt_id": clean_text(advance_receipt.get("id")),
        "total_amount": round(safe_float(advance_receipt.get("amount")), 2),
        "reference_no": reference_no,
        "remarks": remarks,
    }
    existing_id = clean_text((existing or {}).get("id"))
    if existing_id:
        payment_transaction_row["id"] = existing_id

    client.upsert_rows(
        "payment_transactions",
        payment_transaction_row,
        on_conflict="transaction_number",
    )


def decorate_payment_transaction_rows(
    client: SupabaseRestClient,
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    invoice_ids = sorted(
        {
            str(row.get("invoice_id") or "").strip()
            for row in rows
            if str(row.get("invoice_id") or "").strip()
        }
    )
    receipt_ids = sorted(
        {
            str(row.get("receipt_id") or "").strip()
            for row in rows
            if str(row.get("receipt_id") or "").strip()
        }
    )
    advance_receipt_ids = sorted(
        {
            str(row.get("advance_receipt_id") or "").strip()
            for row in rows
            if str(row.get("advance_receipt_id") or "").strip()
        }
    )
    transaction_ids = sorted(
        {
            str(row.get("id") or "").strip()
            for row in rows
            if str(row.get("id") or "").strip()
        }
    )

    invoice_map = (
        rows_by_id(
            client.select_rows(
                "invoices",
                select="id,invoice_no,customer_name,amount_received,net_payable_amount",
                filters={"id": f"in.({','.join(invoice_ids)})"}
                if invoice_ids
                else None,
                limit=max(len(invoice_ids), 1),
            )
        )
        if invoice_ids
        else {}
    )
    receipt_map = (
        rows_by_id(
            client.select_rows(
                "receipts",
                select="id,receipt_no,customer_name,amount_received,net_amount",
                filters={"id": f"in.({','.join(receipt_ids)})"}
                if receipt_ids
                else None,
                limit=max(len(receipt_ids), 1),
            )
        )
        if receipt_ids
        else {}
    )
    advance_receipt_map = (
        rows_by_id(
            client.select_rows(
                "advance_receipts",
                select="id,receipt_no,customer_name,order_id,amount",
                filters={"id": f"in.({','.join(advance_receipt_ids)})"}
                if advance_receipt_ids
                else None,
                limit=max(len(advance_receipt_ids), 1),
            )
        )
        if advance_receipt_ids
        else {}
    )

    tender_rows = (
        client.select_rows(
            "payment_transaction_tenders",
            select=ENTITY_BY_TABLE["payment_transaction_tenders"].select_fields,
            filters={"payment_transaction_id": f"in.({','.join(transaction_ids)})"}
            if transaction_ids
            else None,
            order="payment_mode.asc",
            limit=max(len(transaction_ids) * 10, 1),
        )
        if transaction_ids
        else []
    )
    tenders_by_payment_id: dict[str, list[dict[str, Any]]] = {}
    for tender in tender_rows:
        payment_id = str(tender.get("payment_transaction_id") or "").strip()
        if payment_id:
            tenders_by_payment_id.setdefault(payment_id, []).append(tender)

    decorated: list[dict[str, Any]] = []
    for row in rows:
        source_type = str(row.get("source_type") or "").strip()
        linked_document_id = ""
        document_number = ""
        customer_name = ""
        document_type = source_type.replace("_", " ").title() if source_type else ""
        linked_total_amount = 0.0
        if source_type == "invoice":
            linked_document_id = str(row.get("invoice_id") or "").strip()
            invoice = invoice_map.get(linked_document_id, {})
            document_number = str(invoice.get("invoice_no") or "").strip()
            customer_name = str(invoice.get("customer_name") or "").strip()
            linked_total_amount = safe_float(
                invoice.get("amount_received")
            ) or safe_float(invoice.get("net_payable_amount"))
        elif source_type == "receipt":
            linked_document_id = str(row.get("receipt_id") or "").strip()
            receipt = receipt_map.get(linked_document_id, {})
            document_number = str(receipt.get("receipt_no") or "").strip()
            customer_name = str(receipt.get("customer_name") or "").strip()
            linked_total_amount = safe_float(
                receipt.get("amount_received")
            ) or safe_float(receipt.get("net_amount"))
        elif source_type == "advance_receipt":
            linked_document_id = str(row.get("advance_receipt_id") or "").strip()
            advance_receipt = advance_receipt_map.get(linked_document_id, {})
            document_number = str(advance_receipt.get("receipt_no") or "").strip()
            customer_name = str(advance_receipt.get("customer_name") or "").strip()
            linked_total_amount = safe_float(advance_receipt.get("amount"))

        total_amount = safe_float(row.get("total_amount"))
        if total_amount <= 0 and linked_total_amount > 0:
            total_amount = round(linked_total_amount, 2)

        decorated.append(
            {
                **row,
                "linked_document_id": linked_document_id,
                "document_type": document_type,
                "document_number": document_number,
                "customer_name": customer_name,
                "total_amount": total_amount,
                "advance_order_id": str(
                    (advance_receipt_map.get(linked_document_id, {}) or {}).get(
                        "order_id"
                    )
                    or ""
                ).strip()
                if source_type == "advance_receipt"
                else "",
                "tenders": tenders_by_payment_id.get(
                    str(row.get("id") or "").strip(), []
                ),
            }
        )
    return decorated


def get_client() -> SupabaseRestClient | None:
    return SupabaseRestClient.from_root(ROOT_DIR, use_service_role=True)


def field_to_meta(field: FieldDef) -> dict[str, Any]:
    return {
        "name": field.name,
        "label": field.label,
        "type": field.field_type,
        "required": field.required,
        "options": field.options or [],
        "lookup": field.lookup,
        "readOnly": field.read_only,
        "textareaRows": field.textarea_rows,
        "sectionLabel": field.section_label,
    }


def entity_to_meta(entity: EntityDef) -> dict[str, Any]:
    return {
        "slug": entity.slug,
        "table": entity.table,
        "label": entity.label,
        "navLabel": entity.nav_label,
        "group": entity.group,
        "primaryKey": entity.primary_key,
        "columns": entity.columns,
        "fields": [field_to_meta(field) for field in entity.fields],
        "searchPlaceholder": f"Search {entity.label.lower()}",
        "navHidden": entity.nav_hidden,
    }


def build_meta_payload() -> dict[str, Any]:
    return {
        "groups": ENTITY_GROUPS,
        "entities": [entity_to_meta(entity) for entity in ENTITY_DEFS],
    }


def summarize_record(entity: EntityDef, row: dict[str, Any]) -> str:
    for candidate in (
        "full_name",
        "name",
        "subject",
        "template_name",
        "stock_no",
        "order_number",
        "receipt_no",
        "invoice_no",
        "transaction_number",
        "file_name",
        "recipient_name",
        entity.primary_key,
    ):
        value = str(row.get(candidate) or "").strip()
        if value:
            return value
    return str(row.get(entity.primary_key) or "record")


def match_search(row: dict[str, Any], query: str, fields: list[str]) -> bool:
    text = query.casefold()
    for field in fields:
        raw = row.get(field)
        if raw is None:
            continue
        if isinstance(raw, (dict, list)):
            candidate = json.dumps(raw, ensure_ascii=True)
        else:
            candidate = str(raw)
        if text in candidate.casefold():
            return True
    return False


def stringify_csv_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=True)
    return str(value)


def normalize_field_value(field: FieldDef, payload: dict[str, Any]) -> Any:
    raw = payload.get(field.name)
    if field.read_only and field.name != "id":
        return None
    if field.field_type == "checkbox":
        return normalize_bool(raw)
    if field.field_type == "integer":
        return normalize_number(raw, integer=True)
    if field.field_type == "number":
        return normalize_number(raw)
    if field.field_type == "datetime":
        return normalize_datetime_local(raw)
    if field.field_type == "date":
        return clean_text(raw)
    if field.field_type == "json":
        return normalize_json_value(raw)
    if field.field_type == "array":
        return normalize_array_value(raw)
    return clean_text(raw)


def sanitize_row(entity: EntityDef, payload: dict[str, Any]) -> dict[str, Any]:
    row: dict[str, Any] = {}
    is_old_ornament_advance = (
        entity.slug == "advance-receipts"
        and clean_text(payload.get("transaction_type")) == "old_ornaments_valuation"
    )
    for field in entity.fields:
        if field.read_only:
            continue
        try:
            value = normalize_field_value(field, payload)
        except (TypeError, ValueError):
            if field.field_type in {"integer", "number"}:
                raise ValueError(f"{field.label} must be a valid number.")
            raise ValueError(f"{field.label} has an invalid value.")
        allow_empty_for_receipt_hydration = is_old_ornament_advance and field.name in {
            "amount",
            "valuation_description",
        }
        if (
            field.required
            and not allow_empty_for_receipt_hydration
            and (value is None or value == "" or value == [])
        ):
            raise ValueError(f"{field.label} is required.")
        if value is not None:
            row[field.name] = value
    primary_key_value = clean_text(payload.get(entity.primary_key))
    if primary_key_value:
        row[entity.primary_key] = primary_key_value
    return row


def normalize_huid_list(value: Any) -> str:
    """Store one or more HUIDs in the legacy text field as a tidy token list."""
    if value is None:
        return ""
    # Whitespace is intentionally the delimiter: the stock form documents this
    # and it accepts pasted values with one or many spaces between HUIDs.
    values = re.findall(r"\S+", str(value))
    return " ".join(dict.fromkeys(values))


def _auto_map_customer_gst_codes(row: dict[str, Any]) -> dict[str, Any]:
    """Auto-populate GST codes from state names for customer records."""
    state_name = (row.get("state_name") or "").strip()
    if state_name:
        row["state_gst_code"] = INDIAN_STATES.get(state_name, "")
    else:
        row["state_gst_code"] = ""

    pos_name = (row.get("place_of_supply_name") or "").strip()
    if pos_name:
        row["place_of_supply_gst_code"] = INDIAN_STATES.get(pos_name, "")
    else:
        row["place_of_supply_gst_code"] = ""

    return row


def preserve_linked_receipt_id_for_advance_receipt(
    client: SupabaseRestClient,
    payload: dict[str, Any],
    row: dict[str, Any],
) -> dict[str, Any]:
    if clean_text(payload.get("transaction_type")) != "old_ornaments_valuation":
        return row
    if clean_text(row.get("receipt_id")):
        return row
    advance_receipt_id = clean_text(payload.get("id"))
    if not advance_receipt_id:
        return row
    existing = load_single_row(
        client,
        "advance_receipts",
        select="receipt_id",
        filters={"id": f"eq.{advance_receipt_id}"},
    )
    existing_receipt_id = clean_text((existing or {}).get("receipt_id"))
    if existing_receipt_id:
        row["receipt_id"] = existing_receipt_id
    return row


def normalize_search_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def similarity_score(query: str, candidate: str) -> float:
    nq = normalize_search_text(query)
    nc = normalize_search_text(candidate)
    if not nq or not nc:
        return 0.0
    if nq == nc:
        return 1.0
    if nq in nc:
        return 0.94
    return SequenceMatcher(None, nq, nc).ratio()


def search_customers(client: SupabaseRestClient, query: str) -> list[dict[str, Any]]:
    """Find customers matching a free-text query across all key fields."""
    cleaned = query.strip()
    if len(cleaned) < 2:
        return []

    try:
        rows = client.select_rows(
            "customers",
            select="id,full_name,primary_contact,secondary_contact,email,address_line,state_name,place_of_supply_name,pincode,pan_aadhaar_no,updated_at",
            order="updated_at.desc",
            limit=300,
        )
    except SupabaseError:
        return []

    ranked: list[tuple[float, dict[str, Any]]] = []
    for row in rows:
        best = 0.0

        # Match by name
        full_name = str(row.get("full_name") or "").strip()
        if full_name:
            best = max(best, similarity_score(cleaned, full_name))

        # Match by phone (substring)
        for phone_field in ("primary_contact", "secondary_contact"):
            phone = str(row.get(phone_field) or "").strip()
            if phone and cleaned in phone:
                best = max(best, 0.95 if phone == cleaned else 0.85)

        # Match by email
        email = str(row.get("email") or "").strip().lower()
        if email and cleaned.lower() in email:
            best = max(best, 1.0 if email == cleaned.lower() else 0.88)

        # Match by PAN / Aadhaar
        pan = str(row.get("pan_aadhaar_no") or "").strip()
        if pan:
            pan_lower = pan.lower().replace(" ", "")
            q_clean = cleaned.lower().replace(" ", "")
            if pan_lower == q_clean:
                best = max(best, 1.0)
            elif q_clean in pan_lower:
                best = max(best, 0.90)

        if best < 0.55:
            continue
        ranked.append((best, row))

    ranked.sort(key=lambda e: (-e[0], str(e[1].get("updated_at") or "")))
    return [
        {
            "id": row.get("id"),
            "full_name": row.get("full_name"),
            "primary_contact": row.get("primary_contact"),
            "secondary_contact": row.get("secondary_contact"),
            "email": row.get("email"),
            "address_line": row.get("address_line"),
            "state_name": row.get("state_name"),
            "place_of_supply_name": row.get("place_of_supply_name"),
            "pincode": row.get("pincode"),
            "pan_aadhaar_no": row.get("pan_aadhaar_no"),
            "score": round(score, 2),
        }
        for score, row in ranked[:5]
    ]


def search_artisans(client: SupabaseRestClient, query: str) -> list[dict[str, Any]]:
    cleaned = query.strip()
    if len(cleaned) < 2:
        return []

    try:
        rows = client.select_rows(
            "artisans",
            select="id,name,description,usual_making_charge_percent,usual_cash_charged,updated_at",
            order="updated_at.desc",
            limit=200,
        )
    except SupabaseError:
        return []

    ranked: list[tuple[float, dict[str, Any]]] = []
    for row in rows:
        best = 0.0
        name = str(row.get("name") or "").strip()
        description = str(row.get("description") or "").strip()
        if name:
            best = max(best, similarity_score(cleaned, name))
        if description:
            best = max(best, similarity_score(cleaned, description))
        if best < 0.55:
            continue
        ranked.append((best, row))

    ranked.sort(key=lambda e: (-e[0], str(e[1].get("updated_at") or "")))
    return [
        {
            "id": row.get("id"),
            "name": row.get("name"),
            "description": row.get("description"),
            "usual_making_charge_percent": row.get("usual_making_charge_percent"),
            "usual_cash_charged": row.get("usual_cash_charged"),
            "score": round(score, 2),
        }
        for score, row in ranked[:5]
    ]


def search_stock_items(client: SupabaseRestClient, query: str) -> list[dict[str, Any]]:
    cleaned = query.strip()
    if not cleaned:
        return []

    try:
        rows = client.select_rows(
            "stock_items",
            select="id,stock_no,huid,description,hsn_code,quantity,purity,net_weight_g,making_charges_percent,status,notes,updated_at",
            order="updated_at.desc",
            limit=300,
        )
    except SupabaseError:
        return []

    q_lower = cleaned.lower()
    ranked: list[tuple[float, dict[str, Any]]] = []
    for row in rows:
        stock_no = str(row.get("stock_no") or "").strip()
        if not stock_no:
            continue
        score = 0.0
        stock_lower = stock_no.lower()
        if stock_lower == q_lower:
            score = 1.0
        elif stock_lower.startswith(q_lower):
            score = 0.96
        elif q_lower in stock_lower:
            score = 0.9
        else:
            score = max(score, similarity_score(cleaned, stock_no))
        if score < 0.7:
            continue
        ranked.append((score, row))

    ranked.sort(key=lambda e: (-e[0], str(e[1].get("updated_at") or "")))
    return [
        {
            "id": row.get("id"),
            "stock_no": row.get("stock_no"),
            "huid": row.get("huid"),
            "description": row.get("description"),
            "hsn_code": row.get("hsn_code"),
            "quantity": row.get("quantity"),
            "purity": row.get("purity"),
            "net_weight_g": row.get("net_weight_g"),
            "making_charges_percent": row.get("making_charges_percent"),
            "status": row.get("status"),
            "notes": row.get("notes"),
            "score": round(score, 2),
        }
        for score, row in ranked[:5]
    ]


def search_orders(client: SupabaseRestClient, query: str) -> list[dict[str, Any]]:
    cleaned = query.strip()
    if not cleaned:
        return []

    try:
        rows = client.select_rows(
            "orders",
            select="id,order_number,order_type,status,promised_date,updated_at",
            order="updated_at.desc",
            limit=250,
        )
    except SupabaseError:
        return []

    q_lower = cleaned.lower()
    ranked: list[tuple[float, dict[str, Any]]] = []
    for row in rows:
        order_number = str(row.get("order_number") or "").strip()
        if not order_number:
            continue
        score = 0.0
        order_lower = order_number.lower()
        if order_lower == q_lower:
            score = 1.0
        elif order_lower.startswith(q_lower):
            score = 0.96
        elif q_lower in order_lower:
            score = 0.9
        else:
            score = max(score, similarity_score(cleaned, order_number))
        if score < 0.68:
            continue
        ranked.append((score, row))

    ranked.sort(key=lambda entry: (-entry[0], str(entry[1].get("updated_at") or "")))
    return [
        {
            "id": row.get("id"),
            "order_number": row.get("order_number"),
            "order_type": row.get("order_type"),
            "status": row.get("status"),
            "promised_date": row.get("promised_date"),
            "score": round(score, 2),
        }
        for score, row in ranked[:5]
    ]


def search_invoices(client: SupabaseRestClient, query: str) -> list[dict[str, Any]]:
    cleaned = query.strip()
    if not cleaned:
        return []

    try:
        rows = client.select_rows(
            "invoices",
            select="id,invoice_no,customer_name,status,invoice_datetime,updated_at",
            order="invoice_datetime.desc",
            limit=250,
        )
    except SupabaseError:
        return []

    q_lower = cleaned.lower()
    ranked: list[tuple[float, dict[str, Any]]] = []
    for row in rows:
        invoice_no = str(row.get("invoice_no") or "").strip()
        if not invoice_no:
            continue
        score = 0.0
        invoice_lower = invoice_no.lower()
        if invoice_lower == q_lower:
            score = 1.0
        elif invoice_lower.startswith(q_lower):
            score = 0.96
        elif q_lower in invoice_lower:
            score = 0.9
        else:
            score = max(score, similarity_score(cleaned, invoice_no))
        customer_name = str(row.get("customer_name") or "").strip()
        if customer_name:
            score = max(score, similarity_score(cleaned, customer_name) * 0.92)
        if score < 0.68:
            continue
        ranked.append((score, row))

    ranked.sort(
        key=lambda entry: (-entry[0], str(entry[1].get("invoice_datetime") or ""))
    )
    return [
        {
            "id": row.get("id"),
            "invoice_no": row.get("invoice_no"),
            "customer_name": row.get("customer_name"),
            "status": row.get("status"),
            "invoice_datetime": row.get("invoice_datetime"),
            "score": round(score, 2),
        }
        for score, row in ranked[:5]
    ]


def search_receipts(client: SupabaseRestClient, query: str) -> list[dict[str, Any]]:
    cleaned = query.strip()
    if not cleaned:
        return []

    try:
        rows = client.select_rows(
            "receipts",
            select="id,receipt_no,customer_name,status,receipt_datetime,updated_at",
            order="receipt_datetime.desc",
            limit=250,
        )
    except SupabaseError:
        return []

    q_lower = cleaned.lower()
    ranked: list[tuple[float, dict[str, Any]]] = []
    for row in rows:
        receipt_no = str(row.get("receipt_no") or "").strip()
        if not receipt_no:
            continue
        score = 0.0
        receipt_lower = receipt_no.lower()
        if receipt_lower == q_lower:
            score = 1.0
        elif receipt_lower.startswith(q_lower):
            score = 0.96
        elif q_lower in receipt_lower:
            score = 0.9
        else:
            score = max(score, similarity_score(cleaned, receipt_no))
        customer_name = str(row.get("customer_name") or "").strip()
        if customer_name:
            score = max(score, similarity_score(cleaned, customer_name) * 0.92)
        if score < 0.68:
            continue
        ranked.append((score, row))

    ranked.sort(
        key=lambda entry: (-entry[0], str(entry[1].get("receipt_datetime") or ""))
    )
    return [
        {
            "id": row.get("id"),
            "receipt_no": row.get("receipt_no"),
            "customer_name": row.get("customer_name"),
            "status": row.get("status"),
            "receipt_datetime": row.get("receipt_datetime"),
            "score": round(score, 2),
        }
        for score, row in ranked[:5]
    ]


def parse_datetime_value(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    normalized = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def notification_effective_at(row: dict[str, Any]) -> datetime | None:
    return parse_datetime_value(row.get("reminder_at"))


def decorate_notification_rows(
    client: SupabaseRestClient, rows: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    customer_ids = sorted(
        {
            str(row.get("customer_id") or "").strip()
            for row in rows
            if str(row.get("customer_id") or "").strip()
        }
    )
    artisan_ids = sorted(
        {
            str(row.get("artisan_id") or "").strip()
            for row in rows
            if str(row.get("artisan_id") or "").strip()
        }
    )
    order_ids = sorted(
        {
            str(row.get("order_id") or "").strip()
            for row in rows
            if str(row.get("order_id") or "").strip()
        }
    )
    invoice_ids = sorted(
        {
            str(row.get("invoice_id") or "").strip()
            for row in rows
            if str(row.get("invoice_id") or "").strip()
        }
    )
    receipt_ids = sorted(
        {
            str(row.get("receipt_id") or "").strip()
            for row in rows
            if str(row.get("receipt_id") or "").strip()
        }
    )

    customer_map = (
        rows_by_id(
            client.select_rows(
                "customers",
                select="id,full_name",
                filters={"id": f"in.({','.join(customer_ids)})"}
                if customer_ids
                else None,
                limit=max(len(customer_ids), 1),
            )
        )
        if customer_ids
        else {}
    )
    artisan_map = (
        rows_by_id(
            client.select_rows(
                "artisans",
                select="id,name",
                filters={"id": f"in.({','.join(artisan_ids)})"}
                if artisan_ids
                else None,
                limit=max(len(artisan_ids), 1),
            )
        )
        if artisan_ids
        else {}
    )
    order_map = (
        rows_by_id(
            client.select_rows(
                "orders",
                select="id,order_number",
                filters={"id": f"in.({','.join(order_ids)})"} if order_ids else None,
                limit=max(len(order_ids), 1),
            )
        )
        if order_ids
        else {}
    )
    invoice_map = (
        rows_by_id(
            client.select_rows(
                "invoices",
                select="id,invoice_no,customer_name",
                filters={"id": f"in.({','.join(invoice_ids)})"}
                if invoice_ids
                else None,
                limit=max(len(invoice_ids), 1),
            )
        )
        if invoice_ids
        else {}
    )
    receipt_map = (
        rows_by_id(
            client.select_rows(
                "receipts",
                select="id,receipt_no,customer_name",
                filters={"id": f"in.({','.join(receipt_ids)})"}
                if receipt_ids
                else None,
                limit=max(len(receipt_ids), 1),
            )
        )
        if receipt_ids
        else {}
    )

    prepared: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc)
    for row in rows:
        customer = customer_map.get(str(row.get("customer_id") or ""), {})
        artisan = artisan_map.get(str(row.get("artisan_id") or ""), {})
        order = order_map.get(str(row.get("order_id") or ""), {})
        invoice = invoice_map.get(str(row.get("invoice_id") or ""), {})
        receipt = receipt_map.get(str(row.get("receipt_id") or ""), {})
        effective_at = notification_effective_at(row)
        status = str(row.get("status") or "open").strip() or "open"
        is_due = status != "closed" and effective_at is not None and effective_at <= now
        prepared.append(
            {
                **row,
                "customer_name": customer.get("full_name") or "",
                "artisan_name": artisan.get("name") or "",
                "order_number": order.get("order_number") or "",
                "invoice_no": invoice.get("invoice_no") or "",
                "receipt_no": receipt.get("receipt_no") or "",
                "effective_at": effective_at.isoformat() if effective_at else None,
                "is_due": is_due,
            }
        )
    return prepared


def fetch_notification_rows(
    client: SupabaseRestClient,
    query_params: dict[str, list[str]],
    *,
    query: str = "",
) -> list[dict[str, Any]]:
    filters: dict[str, str] = {}
    for key in (
        "order_id",
        "invoice_id",
        "receipt_id",
        "customer_id",
        "artisan_id",
        "status",
    ):
        value = (query_params.get(key) or [""])[0].strip()
        if value:
            filters[key] = f"eq.{value}"
    rows = client.select_rows(
        "notifications",
        select=ENTITY_BY_TABLE["notifications"].select_fields,
        filters=filters or None,
        order="reminder_at.asc",
        limit=1000,
    )
    decorated = decorate_notification_rows(client, rows)
    if query:
        decorated = [
            row
            for row in decorated
            if match_search(row, query, ENTITY_BY_TABLE["notifications"].search_fields)
        ]
    upcoming_only = (query_params.get("upcoming_only") or [""])[0].strip() == "1"
    due_only = (query_params.get("due_only") or [""])[0].strip() == "1"
    if upcoming_only or due_only:
        now = datetime.now(timezone.utc)
        filtered: list[dict[str, Any]] = []
        for row in decorated:
            effective_at = notification_effective_at(row)
            if not effective_at or str(row.get("status") or "") == "closed":
                continue
            if upcoming_only and effective_at > now:
                filtered.append(row)
            if due_only and effective_at <= now:
                filtered.append(row)
        decorated = filtered
    return decorated


def prepare_notification_row(
    client: SupabaseRestClient,
    payload: dict[str, Any],
) -> dict[str, Any]:
    entity = ENTITY_BY_SLUG["notifications"]
    editable_fields = {
        "subject",
        "body",
        "customer_id",
        "artisan_id",
        "order_id",
        "invoice_id",
        "receipt_id",
        "reminder_at",
    }
    editable_payload = {
        key: value for key, value in payload.items() if key in editable_fields
    }
    row = sanitize_row(entity, editable_payload)
    primary_key_value = clean_text(payload.get(entity.primary_key))
    existing: dict[str, Any] | None = None
    status_in_payload = "status" in payload
    if primary_key_value:
        row[entity.primary_key] = primary_key_value
        existing_rows = client.select_rows(
            entity.table,
            select=entity.select_fields,
            filters={entity.primary_key: f"eq.{primary_key_value}"},
            limit=1,
        )
        existing = existing_rows[0] if existing_rows else None

    requested_status = (
        clean_text(payload.get("status"))
        if status_in_payload
        else (str(existing.get("status") or "").strip() if existing else "open")
    )
    status = requested_status if requested_status in {"open", "closed"} else "open"

    if status == "closed":
        row["status"] = "closed"
        row["closed_at"] = (
            now_iso()
            if status_in_payload
            else (existing.get("closed_at") if existing else now_iso())
        )
    else:
        row["status"] = "open"
        row["closed_at"] = None

    return row


def sample_payload() -> dict[str, Any]:
    return {
        "summary": {
            "customerCount": 0,
            "stockCount": 0,
            "pendingOrders": 0,
            "todaySales": 0.0,
            "receivables": 0.0,
            "openNotifications": 0,
            "supabaseStatus": "connected",
        },
        "dashboard": {
            "customers": [],
            "stock": [],
            "orders": [],
            "documents": [],
            "notifications": [],
        },
    }


def build_dashboard_payload(client: SupabaseRestClient) -> dict[str, Any]:
    today_start = f"{date.today().isoformat()}T00:00:00"
    customers = client.select_rows(
        "customers",
        select="id,full_name,primary_contact,place_of_supply_name,updated_at",
        order="updated_at.desc",
        limit=10,
    )
    stock = client.select_rows(
        "stock_items",
        select="id,stock_no,description,status,gross_weight_g,updated_at",
        order="updated_at.desc",
        limit=10,
    )
    orders = client.select_rows(
        "orders",
        select="id,order_number,order_type,status,promised_date,updated_at",
        order="updated_at.desc",
        limit=10,
    )
    invoices = client.select_rows(
        "invoices",
        select="id,invoice_no,customer_name,invoice_datetime,net_payable_amount",
        order="invoice_datetime.desc",
        limit=10,
    )
    receipts = client.select_rows(
        "receipts",
        select="id,receipt_no,customer_name,receipt_datetime,net_amount",
        order="receipt_datetime.desc",
        limit=10,
    )
    todays_invoices = client.select_rows(
        "invoices",
        select="net_payable_amount",
        filters={"invoice_datetime": f"gte.{today_start}"},
        limit=250,
    )
    invoice_rows = client.select_rows(
        "invoices",
        select="balance_due_amount",
        order="invoice_datetime.desc",
        limit=250,
    )
    summary = {
        "customerCount": client.count_rows("customers"),
        "stockCount": client.count_rows("stock_items"),
        "pendingOrders": client.count_rows(
            "orders", filters={"status": "in.(draft,open,created,in_progress,ready,finished,pending_delivery)"}
        ),
        "todaySales": round(
            sum(safe_float(row.get("net_payable_amount")) for row in todays_invoices), 2
        ),
        "receivables": round(
            sum(safe_float(row.get("balance_due_amount")) for row in invoice_rows), 2
        ),
        "openNotifications": client.count_rows(
            "notifications", filters={"status": "eq.open"}
        ),
        "supabaseStatus": "connected",
    }
    documents = [
        *[
            {
                "id": row["id"],
                "type": "invoice",
                "document_no": row.get("invoice_no"),
                "party": row.get("customer_name"),
                "document_date": row.get("invoice_datetime"),
                "amount": row.get("net_payable_amount"),
            }
            for row in invoices
        ],
        *[
            {
                "id": row["id"],
                "type": "receipt",
                "document_no": row.get("receipt_no"),
                "party": row.get("customer_name"),
                "document_date": row.get("receipt_datetime"),
                "amount": row.get("net_amount"),
            }
            for row in receipts
        ],
    ]
    documents.sort(key=lambda row: row.get("document_date") or "", reverse=True)
    notification_rows = decorate_notification_rows(
        client,
        client.select_rows(
            "notifications",
            select=ENTITY_BY_TABLE["notifications"].select_fields,
            filters={"status": "eq.open"},
            order="reminder_at.asc",
            limit=250,
        ),
    )
    now = datetime.now(timezone.utc)
    upcoming_notifications = [
        row
        for row in notification_rows
        if notification_effective_at(row) is not None
        and notification_effective_at(row) > now
    ]
    upcoming_notifications.sort(key=lambda row: row.get("effective_at") or "")
    return {
        "summary": summary,
        "dashboard": {
            "customers": customers,
            "stock": stock,
            "orders": orders,
            "documents": documents[:10],
            "notifications": upcoming_notifications[:10],
        },
    }


def build_lookups(client: SupabaseRestClient | None) -> dict[str, list[dict[str, Any]]]:
    payload = {key: [] for key in LOOKUP_SPECS}
    if not client:
        return payload
    for key, spec in LOOKUP_SPECS.items():
        try:
            rows = client.select_rows(
                spec["table"], select=spec["select"], order=spec["order"], limit=500
            )
        except SupabaseError:
            rows = []
        prepared: list[dict[str, Any]] = []
        for row in rows:
            label_parts = [
                str(row.get(name) or "").strip() for name in spec["label_fields"]
            ]
            prepared.append(
                {
                    "value": row.get(spec["value"]),
                    "label": " - ".join(part for part in label_parts if part)
                    or str(row.get(spec["value"]) or ""),
                }
            )
        payload[key] = prepared
    return payload


def rows_by_id(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(row.get("id")): row for row in rows if row.get("id")}


# Keep these category sets aligned with the HSN dropdown above and the frontend
# stock-item form. Pearl HSNs are handled as stone-category items, but only the
# codes in STONE_HSN_CODES receive the reduced 0.25% GST rate.
GOLD_HSN_CODES = {
    "71131910",
    "71131920",
    "71131930",
    "71131940",
    "71131960",
    "71131990",
    "71132000",
}
GOLD_SEMI_MANUFACTURED_CODES = {"71081200", "71081300", "71082000", "71090000"}
GOLD_ARTICLES_CODES = {"71141910", "71141930", "71142010", "71142020", "71142030"}
SILVER_HSN_CODES = {"71131110", "71131120", "71131130", "71131190"}
SILVER_SEMI_MANUFACTURED_CODES = {"71069100", "71069210", "71069290", "71070000"}
SILVER_ARTICLES_CODES = {"71141110", "71141120"}
IMITATION_HSN_CODES = {
    "71179010",
    "71171990",
    "71179090",
    "71171100",
    "71171910",
    "71171920",
}
PEARL_ARTICLES_HSN_CODES = {"71161000", "71162000"}
PEARL_LOOSE_HSN_CODES = {"71011010", "71011020", "71012100", "71012200"}
STONE_HSN_CODES = {
    "71039110",
    "71039120",
    "71039130",
    "71039911",
    "71039912",
    "71039913",
    "71039919",
    "71039921",
    "71039929",
    "71039931",
    "71039932",
    "71039939",
    "71039941",
    "71039942",
    "71039943",
    "71039944",
    "71039949",
    "71039951",
    "71039952",
    "71039959",
    "71039990",
}

ALL_GOLD_HSN_CODES = (
    GOLD_HSN_CODES | GOLD_SEMI_MANUFACTURED_CODES | GOLD_ARTICLES_CODES
)
ALL_SILVER_HSN_CODES = (
    SILVER_HSN_CODES | SILVER_SEMI_MANUFACTURED_CODES | SILVER_ARTICLES_CODES
)
ALL_STONE_CATEGORY_HSN_CODES = (
    STONE_HSN_CODES | PEARL_ARTICLES_HSN_CODES | PEARL_LOOSE_HSN_CODES
)


GOLD_PURITY_BASELINE_MAP = {
    "22K": 0.92,
    "18K": 0.75,
    "14K": 0.583,
    "9K": 0.375,
    "24K": 1.00,
}


def default_making_baseline(hsn_code: Any, purity: Any = None) -> float:
    code = str(hsn_code or "").strip()
    if code in ALL_SILVER_HSN_CODES:
        return 0.925
    if code in ALL_GOLD_HSN_CODES and purity:
        p = str(purity or "").strip().upper()
        return GOLD_PURITY_BASELINE_MAP.get(p, 0.92)
    return 0.92


def detect_stock_item_category(hsn_code: Any) -> str:
    code = str(hsn_code or "").strip()
    if code in ALL_GOLD_HSN_CODES:
        return "gold"
    if code in ALL_SILVER_HSN_CODES:
        return "silver"
    if code in IMITATION_HSN_CODES:
        return "imitation"
    if code in ALL_STONE_CATEGORY_HSN_CODES:
        return "stone"
    return "gold"


NUMBER_PREFIXES = {
    "gold": "GLD",
    "silver": "SL",
    "stone": "STN",
    "imitation": "IMI",
    "order": "ORD",
}


def fiscal_year_for(day: date | None = None) -> str:
    """Return the Indian financial year containing ``day`` (April–March)."""
    current = day or date.today()
    start_year = current.year if current.month >= 4 else current.year - 1
    return f"{start_year % 100:02d}-{(start_year + 1) % 100:02d}"


def next_serialized_number(existing_numbers: list[Any], prefix: str) -> int:
    """Find the next five-digit serial, retaining continuity after deletions."""
    # Purity itself can contain digits (for example GLD22K or SL925), so the
    # serial is always the trailing five-digit group after the type prefix.
    matcher = re.compile(rf"^{re.escape(prefix)}.*?(\d{{5}})$", re.IGNORECASE)
    highest = 0
    for number in existing_numbers:
        match = matcher.match(str(number or "").strip())
        if match:
            highest = max(highest, int(match.group(1)))
    next_number = highest + 1
    if next_number > 99999:
        raise ValueError(f"The five-digit sequence for {prefix} is exhausted.")
    return next_number


def build_number_recommendation(
    client: SupabaseRestClient, *, kind: str, hsn_code: Any = None, purity: Any = None
) -> dict[str, str]:
    """Build a suggestion only; callers deliberately do not enforce its use."""
    fiscal_year = fiscal_year_for()
    if kind == "order":
        code = NUMBER_PREFIXES["order"]
        rows = client.select_rows(
            "orders", select="order_number", filters={"order_number": f"like.{fiscal_year}/{code}%"}, limit=10000
        )
        serial = next_serialized_number(
            [row.get("order_number") for row in rows], f"{fiscal_year}/{code}"
        )
        return {"number": f"{fiscal_year}/{code}{serial:05d}", "fiscal_year": fiscal_year}

    hsn = str(hsn_code or "").strip()
    recognised_codes = (
        ALL_GOLD_HSN_CODES | ALL_SILVER_HSN_CODES | IMITATION_HSN_CODES | ALL_STONE_CATEGORY_HSN_CODES
    )
    if hsn not in recognised_codes:
        raise ValueError("Choose a recognised HSN code before generating a stock number.")
    category = detect_stock_item_category(hsn)
    normalized_purity = str(purity or "").strip().upper()
    if category in {"gold", "silver"} and not normalized_purity:
        raise ValueError("Choose a purity before generating a stock number.")

    code = NUMBER_PREFIXES[category]
    rows = client.select_rows(
        "stock_items", select="stock_no", filters={"stock_no": f"like.{fiscal_year}/{code}%"}, limit=10000
    )
    serial = next_serialized_number(
        [row.get("stock_no") for row in rows], f"{fiscal_year}/{code}"
    )
    purity_part = normalized_purity if category in {"gold", "silver"} else ""
    return {
        "number": f"{fiscal_year}/{code}{purity_part}{serial:05d}",
        "fiscal_year": fiscal_year,
        "category": category,
    }


def numeric_or_zero(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def invoice_hsn_tax_percent(hsn_code: Any) -> float:
    """Return the GST rate for an invoice line's HSN code.

    The reduced rate is intentionally limited to STONE_HSN_CODES. Pearl HSNs
    are stone-category stock items, but remain taxed at the standard 3% rate.
    """
    return 0.25 if str(hsn_code or "").strip() in STONE_HSN_CODES else 3.0


def round_to_nearest_rupee(amount: float) -> float:
    """Match the project's invoice rounding rule: 50 paise rounds upward."""
    return float(math.floor(amount + 0.5))


def calculate_invoice_totals(
    invoice: dict[str, Any], invoice_items: list[dict[str, Any]]
) -> dict[str, float]:
    """Calculate the complete invoice summary from its line items.

    A discount is apportioned across lines before tax so a mixed-rate invoice
    is taxed correctly. Header percentage fields contain the effective,
    taxable-value-weighted rate because the current schema stores one header
    rate even when the invoice has multiple HSN rates.
    """
    line_totals = [
        max(numeric_or_zero(item.get("line_total_amount")), 0.0)
        for item in invoice_items
    ]
    items_total = round(sum(line_totals), 2)
    discount_amount = min(
        max(numeric_or_zero(invoice.get("discount_amount")), 0.0), items_total
    )
    taxable_amount = round(items_total - discount_amount, 2)
    is_igst = str(invoice.get("place_of_supply_gst_code") or "").strip() not in {"", "19"}

    taxable_by_rate: dict[float, float] = {}
    for item, line_total in zip(invoice_items, line_totals):
        line_discount = discount_amount * line_total / items_total if items_total else 0.0
        line_taxable_amount = max(line_total - line_discount, 0.0)
        tax_percent = invoice_hsn_tax_percent(item.get("hsn_code"))
        taxable_by_rate[tax_percent] = (
            taxable_by_rate.get(tax_percent, 0.0) + line_taxable_amount
        )

    # GST must be rounded after combining taxable value within each rate group.
    # Rounding each 0.25%-GST stone line separately can otherwise make the
    # portal differ by paise from the invoice preview/PDF for the same sale.
    sgst_amount = 0.0
    cgst_amount = 0.0
    igst_amount = 0.0
    for tax_percent, grouped_taxable_amount in taxable_by_rate.items():
        grouped_taxable_amount = round(grouped_taxable_amount, 2)
        if is_igst:
            igst_amount += round(grouped_taxable_amount * tax_percent / 100, 2)
        else:
            component_tax = round(
                grouped_taxable_amount * (tax_percent / 2) / 100, 2
            )
            sgst_amount += component_tax
            cgst_amount += component_tax

    sgst_amount = round(sgst_amount, 2)
    cgst_amount = round(cgst_amount, 2)
    igst_amount = round(igst_amount, 2)
    total_tax_amount = round(sgst_amount + cgst_amount + igst_amount, 2)
    total_before_rounding = round(taxable_amount + total_tax_amount, 2)
    gross_invoice_total = round_to_nearest_rupee(total_before_rounding)
    round_off_amount = round(gross_invoice_total - total_before_rounding, 2)
    old_gold_advance_amount = max(
        numeric_or_zero(invoice.get("old_gold_advance_amount")), 0.0
    )
    net_payable_amount = max(round(gross_invoice_total - old_gold_advance_amount, 2), 0.0)
    amount_received = max(numeric_or_zero(invoice.get("amount_received")), 0.0)

    sgst_percent = (
        round(sgst_amount * 100 / taxable_amount, 2)
        if taxable_amount and not is_igst
        else 0.0
    )
    cgst_percent = (
        round(cgst_amount * 100 / taxable_amount, 2)
        if taxable_amount and not is_igst
        else 0.0
    )
    igst_percent = (
        round(igst_amount * 100 / taxable_amount, 2)
        if taxable_amount and is_igst
        else 0.0
    )
    return {
        "items_total_amount": items_total,
        "discount_amount": round(discount_amount, 2),
        "taxable_amount": taxable_amount,
        "sgst_percent": sgst_percent,
        "sgst_amount": sgst_amount,
        "cgst_percent": cgst_percent,
        "cgst_amount": cgst_amount,
        "igst_percent": igst_percent,
        "igst_amount": igst_amount,
        "total_tax_amount": total_tax_amount,
        "gross_invoice_total": gross_invoice_total,
        "round_off_amount": round_off_amount,
        "old_gold_advance_amount": round(old_gold_advance_amount, 2),
        "net_payable_amount": net_payable_amount,
        "amount_received": round(amount_received, 2),
        "balance_due_amount": max(round(net_payable_amount - amount_received, 2), 0.0),
    }


def recalculate_invoice_totals(
    client: SupabaseRestClient, invoice_id: Any
) -> dict[str, Any] | None:
    """Persist the authoritative invoice calculations after any relevant edit."""
    invoice_id = str(invoice_id or "").strip()
    if not invoice_id:
        return None
    invoice = load_single_row(
        client,
        "invoices",
        select=(
            "id,discount_amount,old_gold_advance_amount,amount_received,"
            "place_of_supply_gst_code"
        ),
        filters={"id": f"eq.{invoice_id}"},
    )
    if not invoice:
        return None
    invoice_items = client.select_rows(
        "invoice_items",
        select="hsn_code,line_total_amount",
        filters={"invoice_id": f"eq.{invoice_id}"},
        order="line_no.asc",
        limit=3000,
    )
    calculated = calculate_invoice_totals(invoice, invoice_items)
    rows = client.update_rows("invoices", calculated, filters={"id": f"eq.{invoice_id}"})
    return rows[0] if rows else {**invoice, **calculated}


def prepare_stock_item_row(row: dict[str, Any]) -> dict[str, Any]:
    category = detect_stock_item_category(row.get("hsn_code"))

    if category in {"gold", "silver"} and not row.get("purity"):
        raise ValueError("Purity is required.")
    if category in {"stone", "imitation"} and not row.get("purity"):
        row["purity"] = "N/A"

    if row.get("quantity") is None:
        row["quantity"] = 1

    if category == "stone":
        weight_unit = str(row.get("weight_entry_unit") or "g").strip() or "g"
        row["weight_entry_unit"] = weight_unit
        gross_weight = numeric_or_zero(row.get("gross_weight_g"))
        row["gross_weight_g"] = gross_weight
        row["net_weight_g"] = gross_weight
        row["stone_weight_g"] = 0

        weight_ratti = numeric_or_zero(row.get("weight_ratti"))
        if row.get("stone_expense_entry_mode") == "per_ratti":
            row["other_expenses"] = numeric_or_zero(
                row.get("stone_expense_per_ratti")
            ) * weight_ratti
        if row.get("stone_cost_entry_mode") == "per_ratti":
            row["other_charges_amount"] = numeric_or_zero(
                row.get("stone_cost_per_ratti")
            ) * weight_ratti
    elif category == "imitation":
        row["gross_weight_g"] = numeric_or_zero(row.get("gross_weight_g"))
        row["net_weight_g"] = numeric_or_zero(row.get("net_weight_g"))
        row["stone_weight_g"] = numeric_or_zero(row.get("stone_weight_g"))
    else:
        if row.get("gross_weight_g") is None:
            row["gross_weight_g"] = 0
        if row.get("net_weight_g") is None:
            row["net_weight_g"] = numeric_or_zero(row.get("gross_weight_g"))

        # The modal allows net weight to be entered independently. If gross
        # weight was left blank, use the known net weight so the row satisfies
        # stock_items' net_weight_g <= gross_weight_g constraint.
        gross_weight = numeric_or_zero(row.get("gross_weight_g"))
        net_weight = numeric_or_zero(row.get("net_weight_g"))
        if gross_weight == 0 and net_weight > 0:
            row["gross_weight_g"] = net_weight

    if category == "silver":
        net_weight = numeric_or_zero(row.get("net_weight_g"))
        if row.get("silver_expense_entry_mode") == "per_gm":
            row["other_expenses"] = numeric_or_zero(
                row.get("silver_expense_price_per_gm")
            ) * net_weight
        if row.get("silver_cost_entry_mode") == "per_gm":
            row["silver_cost_total_price"] = numeric_or_zero(
                row.get("silver_cost_price_per_gm")
            ) * net_weight

    for field_name in (
        "stone_weight_g",
        "stone_amount",
        "stone_expense",
        "other_charges_amount",
        "goldsmith_loss",
        "other_expenses",
    ):
        if row.get(field_name) is None:
            row[field_name] = 0

    if row.get("making_baseline") is None:
        row["making_baseline"] = default_making_baseline(
            row.get("hsn_code"), row.get("purity")
        )

    return row


def fetch_stock_item_artisan_links(
    client: SupabaseRestClient,
    *,
    stock_item_ids: list[str] | None = None,
    artisan_ids: list[str] | None = None,
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, list[dict[str, Any]]]]:
    filters: dict[str, str] = {}
    if stock_item_ids:
        filters["stock_item_id"] = f"in.({','.join(stock_item_ids)})"
    if artisan_ids:
        filters["artisan_id"] = f"in.({','.join(artisan_ids)})"
    if not filters:
        return {}, {}

    link_rows = client.select_rows(
        "stock_item_artisans",
        select="id,stock_item_id,artisan_id,created_at,updated_at",
        filters=filters,
        order="created_at.asc",
        limit=max(len(stock_item_ids or []) * 10, len(artisan_ids or []) * 10, 1),
    )
    linked_artisan_ids = sorted(
        {
            str(row.get("artisan_id") or "").strip()
            for row in link_rows
            if str(row.get("artisan_id") or "").strip()
        }
    )
    artisan_map = (
        rows_by_id(
            client.select_rows(
                "artisans",
                select="id,name,description,usual_making_charge_percent,usual_cash_charged,updated_at",
                filters={"id": f"in.({','.join(linked_artisan_ids)})"}
                if linked_artisan_ids
                else None,
                limit=max(len(linked_artisan_ids), 1),
            )
        )
        if linked_artisan_ids
        else {}
    )

    by_stock_item: dict[str, list[dict[str, Any]]] = {}
    by_artisan: dict[str, list[dict[str, Any]]] = {}
    for row in link_rows:
        stock_item_id = str(row.get("stock_item_id") or "").strip()
        artisan_id = str(row.get("artisan_id") or "").strip()
        artisan = artisan_map.get(artisan_id, {})
        linked = {
            **row,
            "artisan": artisan,
            "artisan_name": artisan.get("name") or "",
        }
        if stock_item_id:
            by_stock_item.setdefault(stock_item_id, []).append(linked)
        if artisan_id:
            by_artisan.setdefault(artisan_id, []).append(linked)
    return by_stock_item, by_artisan


def decorate_stock_item_rows(
    client: SupabaseRestClient, rows: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    stock_item_ids = [
        str(row.get("id") or "").strip()
        for row in rows
        if str(row.get("id") or "").strip()
    ]
    if not stock_item_ids:
        return rows
    by_stock_item, _ = fetch_stock_item_artisan_links(
        client, stock_item_ids=stock_item_ids
    )
    prepared: list[dict[str, Any]] = []
    for row in rows:
        stock_item_id = str(row.get("id") or "").strip()
        links = by_stock_item.get(stock_item_id, [])
        artisans = [link.get("artisan") or {} for link in links if link.get("artisan")]
        artisan_names = [
            str(artisan.get("name") or "").strip()
            for artisan in artisans
            if str(artisan.get("name") or "").strip()
        ]
        primary_artisan = artisans[0] if artisans else {}
        prepared.append(
            {
                **row,
                "artisan_links": links,
                "artisans": artisans,
                "artisan_names": artisan_names,
                "goldsmith_name": ", ".join(artisan_names)
                or str(row.get("goldsmith_name") or "").strip(),
                "artisan_id": primary_artisan.get("id") or row.get("artisan_id"),
                "artisan_name": primary_artisan.get("name") or "",
                "making_baseline": row.get("making_baseline")
                if row.get("making_baseline") is not None
                else default_making_baseline(row.get("hsn_code"), row.get("purity")),
            }
        )
    return prepared


def sync_stock_item_artisans(
    client: SupabaseRestClient, stock_item_id: str, artisan_ids: list[str]
) -> None:
    current_rows = client.select_rows(
        "stock_item_artisans",
        select="id,artisan_id",
        filters={"stock_item_id": f"eq.{stock_item_id}"},
        limit=500,
    )
    current_map = {
        str(row.get("artisan_id") or "").strip(): str(row.get("id") or "").strip()
        for row in current_rows
        if str(row.get("artisan_id") or "").strip()
    }
    desired = []
    seen: set[str] = set()
    for artisan_id in artisan_ids:
        clean_id = str(artisan_id or "").strip()
        if clean_id and clean_id not in seen:
            desired.append(clean_id)
            seen.add(clean_id)

    for artisan_id in desired:
        if artisan_id in current_map:
            continue
        client.insert_rows(
            "stock_item_artisans",
            {
                "stock_item_id": stock_item_id,
                "artisan_id": artisan_id,
            },
            returning=False,
        )

    for artisan_id, link_id in current_map.items():
        if artisan_id not in seen and link_id:
            client.delete_rows("stock_item_artisans", filters={"id": f"eq.{link_id}"})

    primary_artisan_id = desired[0] if desired else None
    primary_artisan_name = ""
    if primary_artisan_id:
        artisan_rows = client.select_rows(
            "artisans",
            select="id,name",
            filters={"id": f"eq.{primary_artisan_id}"},
            limit=1,
        )
        if artisan_rows:
            primary_artisan_name = str(artisan_rows[0].get("name") or "").strip()
    client.update_rows(
        "stock_items",
        {
            "artisan_id": primary_artisan_id,
            "goldsmith_name": primary_artisan_name or None,
        },
        filters={"id": f"eq.{stock_item_id}"},
        returning=False,
    )


def apply_query_match(
    rows: list[dict[str, Any]], query: str, fields: list[str]
) -> list[dict[str, Any]]:
    clean_query = query.strip()
    if not clean_query:
        return rows
    return [row for row in rows if match_search(row, clean_query, fields)]


def fetch_orderbook_items(
    client: SupabaseRestClient, *, filters: dict[str, str] | None = None, limit: int
) -> list[dict[str, Any]]:
    """Keep the portal readable while a rolling database migration is pending."""
    select = ENTITY_BY_TABLE["order_items"].select_fields
    try:
        return client.select_rows("order_items", select=select, filters=filters, order="order_id.asc,line_no.asc", limit=limit)
    except SupabaseError as exc:
        missing_columns = {"other_charges_amount", "stone_amount"}
        if not any(column in str(exc) for column in missing_columns):
            raise
        legacy_select = ",".join(field for field in select.split(",") if field not in missing_columns)
        return client.select_rows("order_items", select=legacy_select, filters=filters, order="order_id.asc,line_no.asc", limit=limit)


def fetch_optional_order_lifecycle_rows(
    client: SupabaseRestClient, table: str, select: str, order_id: str, order: str
) -> list[dict[str, Any]]:
    try:
        return client.select_rows(table, select=select, filters={"order_id": f"eq.{order_id}"}, order=order, limit=500)
    except SupabaseError as exc:
        # The lifecycle tables are introduced together with the new modal. Do not
        # make the established Orderbook unavailable while that migration is queued.
        message = str(exc)
        if "does not exist" in message or "schema cache" in message:
            return []
        if table == "order_artisan_assignments" and "order_item_id" in message:
            legacy_select = ",".join(field for field in select.split(",") if field != "order_item_id")
            return client.select_rows(table, select=legacy_select, filters={"order_id": f"eq.{order_id}"}, order=order, limit=500)
        raise


def next_order_item_line_no(client: SupabaseRestClient, order_id: str) -> int:
    """Use insertion order for invoice lines; the number is never user-entered."""
    rows = client.select_rows(
        "order_items",
        select="line_no",
        filters={"order_id": f"eq.{order_id}"},
        order="line_no.desc",
        limit=1,
    )
    return int(rows[0].get("line_no") or 0) + 1 if rows else 1


def record_order_lifecycle_event(client: SupabaseRestClient, row: dict[str, Any]) -> None:
    """Lifecycle history is optional until the corresponding migration is applied."""
    try:
        client.insert_rows("order_lifecycle_events", row, returning=False)
    except SupabaseError as exc:
        if "does not exist" not in str(exc) and "schema cache" not in str(exc):
            raise


def build_orderbook_payload(
    client: SupabaseRestClient, query: str = "", order_id: str = ""
) -> dict[str, Any]:
    order_filters = {"id": f"eq.{order_id}"} if order_id else None
    orders = client.select_rows(
        "orders",
        select=ENTITY_BY_TABLE["orders"].select_fields,
        filters=order_filters,
        order="updated_at.desc",
        limit=1 if order_id else 500,
    )
    customer_ids = sorted(
        {
            str(row.get("customer_id") or "").strip()
            for row in orders
            if str(row.get("customer_id") or "").strip()
        }
    )
    customer_filters = (
        {"id": f"in.({','.join(customer_ids)})"} if customer_ids else None
    )
    if order_id and not customer_ids:
        customers = []
    else:
        customers = client.select_rows(
            "customers",
            select="id,full_name,primary_contact,secondary_contact,email,address_line,state_name,state_gst_code,place_of_supply_name,place_of_supply_gst_code,pincode,pan_aadhaar_no",
            filters=customer_filters,
            order="full_name.asc",
            limit=max(len(customer_ids), 1) if order_id else 500,
        )
    if order_id:
        order_items = fetch_orderbook_items(client, filters={"order_id": f"eq.{order_id}"}, limit=500)
        advance_receipts = client.select_rows(
            "advance_receipts",
            select=ENTITY_BY_TABLE["advance_receipts"].select_fields,
            filters={"order_id": f"eq.{order_id}"},
            order="receipt_datetime.desc",
            limit=500,
        )
        notifications = fetch_notification_rows(client, {"order_id": [order_id]})
        lifecycle_events = fetch_optional_order_lifecycle_rows(client, "order_lifecycle_events", "id,event_type,from_status,to_status,details,occurred_at", order_id, "occurred_at.asc")
        assignments = fetch_optional_order_lifecycle_rows(client, "order_artisan_assignments", "id,order_id,order_item_id,artisan_id,assigned_at,returned_at,remarks", order_id, "assigned_at.desc")
    else:
        order_items = fetch_orderbook_items(client, limit=2000)
        advance_receipts = client.select_rows(
            "advance_receipts",
            select=ENTITY_BY_TABLE["advance_receipts"].select_fields,
            order="receipt_datetime.desc",
            limit=2000,
        )
        notifications = []
        lifecycle_events = []
        assignments = []
    receipt_ids = sorted(
        {
            str(row.get("receipt_id") or "").strip()
            for row in advance_receipts
            if str(row.get("receipt_id") or "").strip()
        }
    )
    receipt_map: dict[str, dict[str, Any]] = {}
    if receipt_ids:
        receipt_rows = client.select_rows(
            "receipts",
            select="id,receipt_no,receipt_datetime",
            filters={"id": f"in.({','.join(receipt_ids)})"},
            limit=len(receipt_ids),
        )
        receipt_map = rows_by_id(receipt_rows)

    customer_map = rows_by_id(customers)
    items_by_order: dict[str, list[dict[str, Any]]] = {}
    for row in order_items:
        items_by_order.setdefault(str(row.get("order_id") or ""), []).append(row)

    receipts_by_order: dict[str, list[dict[str, Any]]] = {}
    for row in advance_receipts:
        receipts_by_order.setdefault(str(row.get("order_id") or ""), []).append(row)
    notifications_by_order: dict[str, list[dict[str, Any]]] = {}
    for row in notifications:
        notifications_by_order.setdefault(str(row.get("order_id") or ""), []).append(
            row
        )

    prepared_orders: list[dict[str, Any]] = []
    for order in orders:
        customer = customer_map.get(str(order.get("customer_id") or ""), {})
        order_id = str(order.get("id") or "")
        related_items = items_by_order.get(order_id, [])
        related_receipts = receipts_by_order.get(order_id, [])
        prepared_orders.append(
            {
                **order,
                "customer_name": customer.get("full_name")
                or order.get("customer_name")
                or "",
                "customer_contact": customer.get("primary_contact") or "",
                "customer_contact_secondary": customer.get("secondary_contact") or "",
                "customer_email": customer.get("email") or "",
                "customer_address": customer.get("address_line") or "",
                "customer_state_name": customer.get("state_name") or "",
                "customer_state_gst_code": customer.get("state_gst_code") or "",
                "place_of_supply_name": customer.get("place_of_supply_name") or "",
                "place_of_supply_gst_code": customer.get("place_of_supply_gst_code")
                or "",
                "customer_pincode": customer.get("pincode") or "",
                "customer_pan_aadhaar_no": customer.get("pan_aadhaar_no") or "",
                "item_count": len(related_items),
                "advance_total": round(
                    sum(safe_float(row.get("amount")) for row in related_receipts), 2
                ),
                "order_items": related_items,
                "advance_receipts": [
                    {
                        **receipt,
                        "order_number": order.get("order_number"),
                        "order_date": order.get("order_date"),
                        "amount": receipt.get("amount")
                        or receipt.get("amount_received")
                        or receipt.get("net_amount")
                        or receipt.get("gross_amount"),
                        "linked_receipt_no": receipt_map.get(
                            str(receipt.get("receipt_id") or ""), {}
                        ).get("receipt_no")
                        or "",
                    }
                    for receipt in related_receipts
                ],
                "notifications": notifications_by_order.get(order_id, []),
                "lifecycle_events": lifecycle_events if order_id else [],
                "artisan_assignments": assignments if order_id else [],
            }
        )

    prepared_orders = apply_query_match(
        prepared_orders,
        query,
        [
            "order_number",
            "order_type",
            "status",
            "remarks",
            "customer_name",
            "customer_contact",
        ],
    )
    return {"orders": prepared_orders}


def build_billing_payload(
    client: SupabaseRestClient, query: str = "", document_id: str = ""
) -> dict[str, Any]:
    invoice_filters = {"id": f"eq.{document_id}"} if document_id else None
    receipt_filters = {"id": f"eq.{document_id}"} if document_id else None
    invoices = client.select_rows(
        "invoices",
        select=ENTITY_BY_TABLE["invoices"].select_fields,
        filters=invoice_filters,
        order="invoice_datetime.desc",
        limit=1 if document_id else 500,
    )
    invoice_ids = {
        str(row.get("id") or "").strip()
        for row in invoices
        if str(row.get("id") or "").strip()
    }
    invoice_item_filters = (
        {"invoice_id": f"in.({','.join(sorted(invoice_ids))})"}
        if invoice_ids and document_id
        else None
    )
    if document_id and not invoice_ids:
        invoice_items = []
    else:
        invoice_items = client.select_rows(
            "invoice_items",
            select=ENTITY_BY_TABLE["invoice_items"].select_fields,
            filters=invoice_item_filters,
            order="invoice_id.asc,line_no.asc",
            limit=3000,
        )
    receipts = client.select_rows(
        "receipts",
        select=ENTITY_BY_TABLE["receipts"].select_fields,
        filters=receipt_filters,
        order="receipt_datetime.desc",
        limit=1 if document_id else 500,
    )
    receipt_ids = {
        str(row.get("id") or "").strip()
        for row in receipts
        if str(row.get("id") or "").strip()
    }
    receipt_item_filters = (
        {"receipt_id": f"in.({','.join(sorted(receipt_ids))})"}
        if receipt_ids and document_id
        else None
    )
    if document_id and not receipt_ids:
        receipt_items = []
    else:
        receipt_items = client.select_rows(
            "receipt_items",
            select=ENTITY_BY_TABLE["receipt_items"].select_fields,
            filters=receipt_item_filters,
            order="receipt_id.asc,line_no.asc",
            limit=3000,
        )
    advance_receipt_filters = (
        {"receipt_id": f"in.({','.join(sorted(receipt_ids))})"}
        if receipt_ids and document_id
        else None
    )
    if document_id and not receipt_ids:
        advance_receipts = []
    else:
        advance_receipts = client.select_rows(
            "advance_receipts",
            select="id,receipt_id,order_id,receipt_no,receipt_datetime,transaction_type,amount,valuation_description",
            filters=advance_receipt_filters,
            order="receipt_datetime.desc",
            limit=3000,
        )
    order_ids = sorted(
        {
            str(row.get("order_id") or "").strip()
            for row in advance_receipts
            if str(row.get("order_id") or "").strip()
        }
    )
    order_map: dict[str, dict[str, Any]] = {}
    if order_ids:
        order_rows = client.select_rows(
            "orders",
            select="id,order_number",
            filters={"id": f"in.({','.join(order_ids)})"},
            limit=len(order_ids),
        )
        order_map = rows_by_id(order_rows)

    invoice_items_by_id: dict[str, list[dict[str, Any]]] = {}
    for row in invoice_items:
        invoice_items_by_id.setdefault(str(row.get("invoice_id") or ""), []).append(row)

    receipt_items_by_id: dict[str, list[dict[str, Any]]] = {}
    for row in receipt_items:
        receipt_items_by_id.setdefault(str(row.get("receipt_id") or ""), []).append(row)
    advance_receipts_by_receipt_id: dict[str, list[dict[str, Any]]] = {}
    for row in advance_receipts:
        receipt_id = str(row.get("receipt_id") or "").strip()
        if not receipt_id:
            continue
        advance_receipts_by_receipt_id.setdefault(receipt_id, []).append(
            {
                **row,
                "order_number": order_map.get(str(row.get("order_id") or ""), {}).get(
                    "order_number"
                )
                or "",
            }
        )

    documents: list[dict[str, Any]] = []
    for row in invoices:
        documents.append(
            {
                **row,
                "document_type": "invoice",
                "document_no": row.get("invoice_no"),
                "document_datetime": row.get("invoice_datetime"),
                "document_amount": row.get("net_payable_amount"),
                "line_items": invoice_items_by_id.get(str(row.get("id") or ""), []),
            }
        )
    for row in receipts:
        documents.append(
            {
                **row,
                "document_type": "receipt",
                "document_no": row.get("receipt_no"),
                "document_datetime": row.get("receipt_datetime"),
                "document_amount": row.get("net_amount"),
                "line_items": receipt_items_by_id.get(str(row.get("id") or ""), []),
                "linked_advance_receipts": advance_receipts_by_receipt_id.get(
                    str(row.get("id") or ""), []
                ),
            }
        )

    documents.sort(key=lambda row: row.get("document_datetime") or "", reverse=True)
    documents = apply_query_match(
        documents,
        query,
        [
            "document_type",
            "document_no",
            "customer_name",
            "customer_contact_primary",
            "status",
            "remarks",
        ],
    )
    return {"documents": documents}


def build_customer_related_payload(
    client: SupabaseRestClient, customer_id: str
) -> dict[str, Any]:
    orders = client.select_rows(
        "orders",
        select="id,order_number,order_type,order_date,promised_date,status,updated_at",
        filters={"customer_id": f"eq.{customer_id}"},
        order="order_date.desc",
        limit=200,
    )
    invoices = client.select_rows(
        "invoices",
        select="id,invoice_no,customer_name,invoice_datetime,status,net_payable_amount,balance_due_amount,updated_at",
        filters={"customer_id": f"eq.{customer_id}"},
        order="invoice_datetime.desc",
        limit=200,
    )
    receipts = client.select_rows(
        "receipts",
        select="id,receipt_no,customer_name,receipt_datetime,status,net_amount,amount_received,updated_at",
        filters={"customer_id": f"eq.{customer_id}"},
        order="receipt_datetime.desc",
        limit=200,
    )
    return {
        "orders": orders,
        "invoices": invoices,
        "receipts": receipts,
    }


def build_artisan_related_payload(
    client: SupabaseRestClient, artisan_id: str
) -> dict[str, Any]:
    _, by_artisan = fetch_stock_item_artisan_links(client, artisan_ids=[artisan_id])
    links_for_artisan = by_artisan.get(artisan_id, [])
    stock_item_ids = [
        str(link.get("stock_item_id") or "").strip()
        for link in links_for_artisan
        if str(link.get("stock_item_id") or "").strip()
    ]
    # Build a map of stock_item_id → linked_at (created_at from the link table)
    linked_at_map: dict[str, str] = {}
    for link in links_for_artisan:
        sid = str(link.get("stock_item_id") or "").strip()
        if sid and sid not in linked_at_map:
            linked_at_map[sid] = str(link.get("created_at") or "")
    stock_items = decorate_stock_item_rows(
        client,
        client.select_rows(
            "stock_items",
            select="id,stock_no,description,purity,quantity,status,gross_weight_g,created_at,updated_at,hsn_code,ornament_type,net_weight_g,weight_ratti,stone_weight_g,stone_amount,stone_expense,stone_expense_entry_mode,stone_expense_per_ratti,stone_cost_entry_mode,stone_cost_per_ratti,other_charges_amount,silver_expense_entry_mode,silver_expense_price_per_gm,silver_cost_entry_mode,silver_cost_price_per_gm,silver_cost_total_price,silver_other_expenses,making_charges_percent,making_baseline,goldsmith_loss,other_expenses,profit_cash_amount,profit_excess_weight_g,profit_calculated_at",
            filters={"id": f"in.({','.join(stock_item_ids)})"}
            if stock_item_ids
            else {"id": "in.()"},
            order="created_at.desc",
            limit=max(len(stock_item_ids), 1),
        )
        if stock_item_ids
        else [],
    )
    # Inject linked_at into each stock item
    for item in stock_items:
        item_id = str(item.get("id") or "").strip()
        item["linked_at"] = (
            linked_at_map.get(item_id)
            or item.get("created_at")
            or item.get("updated_at")
            or ""
        )
    return {"stock_items": stock_items}


def build_stock_item_related_payload(
    client: SupabaseRestClient, stock_item_id: str
) -> dict[str, Any]:
    by_stock_item, _ = fetch_stock_item_artisan_links(
        client, stock_item_ids=[stock_item_id]
    )
    artisans = [
        link.get("artisan")
        for link in by_stock_item.get(stock_item_id, [])
        if link.get("artisan")
    ]
    movements = client.select_rows(
        "stock_movements",
        select="id,movement_at,previous_status,new_status,quantity_delta,reference_type,reference_id,remarks",
        filters={"stock_item_id": f"eq.{stock_item_id}"},
        order="movement_at.desc",
        limit=50,
    )
    order_items = client.select_rows(
        "order_items",
        select="id,order_id,line_no,description,quantity,status,purity,hsn_code",
        filters={"stock_item_id": f"eq.{stock_item_id}"},
        order="created_at.desc",
        limit=50,
    )
    # Resolve order numbers for display
    order_ids = list(
        {str(item.get("order_id", "")) for item in order_items if item.get("order_id")}
    )
    order_map: dict[str, str] = {}
    if order_ids:
        orders = client.select_rows(
            "orders",
            select="id,order_number,status",
            filters={"id": f"in.({','.join(order_ids)})"},
            limit=100,
        )
        order_map = {str(o["id"]): o for o in orders}
    for item in order_items:
        order = order_map.get(str(item.get("order_id", "")))
        item["order_number"] = order.get("order_number", "") if order else ""
        item["order_status"] = order.get("status", "") if order else ""
    invoice_items = client.select_rows(
        "invoice_items",
        select="id,invoice_id,line_no,stock_no,huid,description,quantity,purity,gross_weight_g,net_weight_g,line_total_amount",
        filters={"stock_item_id": f"eq.{stock_item_id}"},
        order="line_no.asc",
        limit=50,
    )
    # Resolve invoice numbers for display
    invoice_ids = list(
        {
            str(item.get("invoice_id", ""))
            for item in invoice_items
            if item.get("invoice_id")
        }
    )
    invoice_map: dict[str, dict] = {}
    if invoice_ids:
        invoices = client.select_rows(
            "invoices",
            select="id,invoice_no,status,customer_name,invoice_datetime",
            filters={"id": f"in.({','.join(invoice_ids)})"},
            limit=100,
        )
        invoice_map = {str(inv["id"]): inv for inv in invoices}
    for item in invoice_items:
        inv = invoice_map.get(str(item.get("invoice_id", "")))
        item["invoice_no"] = inv.get("invoice_no", "") if inv else ""
        item["invoice_status"] = inv.get("status", "") if inv else ""
        item["customer_name"] = inv.get("customer_name", "") if inv else ""
        item["invoice_datetime"] = inv.get("invoice_datetime", "") if inv else ""
    return {
        "artisans": artisans,
        "movements": movements,
        "order_items": order_items,
        "invoice_items": invoice_items,
    }


class MasterPortalHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/":
            self.serve_index()
            return
        if path == "/api/health":
            self.send_json({"ok": True})
            return
        if path == "/api/portal":
            self.handle_portal()
            return
        if path == "/api/lookups":
            self.handle_lookups()
            return
        if path == "/api/orderbook":
            self.handle_orderbook(parse_qs(parsed.query))
            return
        if path == "/api/billing":
            self.handle_billing(parse_qs(parsed.query))
            return
        if path == "/api/admin/meta":
            self.send_json(build_meta_payload())
            return
        if path == "/api/admin/number-recommendation":
            self.handle_number_recommendation(parse_qs(parsed.query))
            return
        if path == "/api/admin/customers/related":
            self.handle_customer_related(parse_qs(parsed.query))
            return
        if path == "/api/admin/artisans/related":
            self.handle_artisan_related(parse_qs(parsed.query))
            return
        if path == "/api/admin/stock-items/related":
            self.handle_stock_item_related(parse_qs(parsed.query))
            return
        if path == "/api/admin/customers/search":
            self.handle_customer_search(parse_qs(parsed.query))
            return
        if path == "/api/admin/artisans/search":
            self.handle_artisan_search(parse_qs(parsed.query))
            return
        if path == "/api/admin/stock-items/search":
            self.handle_stock_item_search(parse_qs(parsed.query))
            return
        if path == "/api/admin/orders/search":
            self.handle_order_search(parse_qs(parsed.query))
            return
        if path == "/api/admin/invoices/search":
            self.handle_invoice_search(parse_qs(parsed.query))
            return
        if path == "/api/admin/receipts/search":
            self.handle_receipt_search(parse_qs(parsed.query))
            return
        if path.startswith("/api/admin/") and path.endswith("/export.csv"):
            self.handle_admin_export(
                path.removeprefix("/api/admin/").removesuffix("/export.csv"),
                parse_qs(parsed.query),
            )
            return
        if path.startswith("/api/admin/") and path.endswith("/delete-check"):
            self.handle_delete_check(
                path.removeprefix("/api/admin/").removesuffix("/delete-check"),
                parse_qs(parsed.query),
            )
            return
        if path.startswith("/api/admin/"):
            self.handle_admin_list(
                path.removeprefix("/api/admin/"), parse_qs(parsed.query)
            )
            return
        if path.startswith("/static/"):
            self.serve_file(STATIC_DIR / path.removeprefix("/static/"))
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        lifecycle_match = re.fullmatch(r"/api/orders/([0-9a-f-]+)/transition", path)
        if lifecycle_match:
            self.handle_order_transition(lifecycle_match.group(1))
            return
        artisan_assignment_match = re.fullmatch(r"/api/orders/([0-9a-f-]+)/items/([0-9a-f-]+)/artisans", path)
        if artisan_assignment_match:
            self.handle_order_item_artisan_assignment(*artisan_assignment_match.groups())
            return
        if path.startswith("/api/admin/"):
            self.handle_admin_upsert(path.removeprefix("/api/admin/"))
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        if path := parsed.path:
            if path.startswith("/api/admin/"):
                self.handle_admin_delete(
                    path.removeprefix("/api/admin/"), parse_qs(parsed.query)
                )
                return
        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

    def resolve_entity(self, slug: str) -> EntityDef | None:
        return ENTITY_BY_SLUG.get(slug)

    def handle_portal(self) -> None:
        client = get_client()
        if not client:
            self.send_json(sample_payload())
            return
        try:
            self.send_json(build_dashboard_payload(client))
        except SupabaseError as exc:
            payload = sample_payload()
            payload["summary"]["supabaseStatus"] = f"fallback ({exc})"
            self.send_json(payload)

    def handle_lookups(self) -> None:
        client = get_client()
        try:
            self.send_json(build_lookups(client))
        except SupabaseError as exc:
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_GATEWAY)

    def handle_number_recommendation(self, query_params: dict[str, list[str]]) -> None:
        kind = (query_params.get("kind") or [""])[0].strip().lower()
        if kind not in {"stock", "order"}:
            self.send_json({"error": "A valid number type is required."}, status=HTTPStatus.BAD_REQUEST)
            return
        client = get_client()
        if not client:
            self.send_json({"error": "Supabase client is not configured."}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        try:
            self.send_json(build_number_recommendation(
                client,
                kind="order" if kind == "order" else "stock",
                hsn_code=(query_params.get("hsn_code") or [""])[0],
                purity=(query_params.get("purity") or [""])[0],
            ))
        except ValueError as exc:
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
        except SupabaseError as exc:
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_GATEWAY)

    def handle_orderbook(self, query_params: dict[str, list[str]]) -> None:
        client = get_client()
        if not client:
            self.send_json({"orders": []})
            return
        try:
            query = (query_params.get("q") or [""])[0]
            order_id = (query_params.get("order_id") or [""])[0].strip()
            self.send_json(build_orderbook_payload(client, query, order_id))
        except SupabaseError as exc:
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_GATEWAY)

    def handle_customer_related(self, query_params: dict[str, list[str]]) -> None:
        customer_id = (query_params.get("id") or [""])[0].strip()
        if not customer_id:
            self.send_json({"error": "Missing id"}, status=HTTPStatus.BAD_REQUEST)
            return
        client = get_client()
        if not client:
            self.send_json({"orders": [], "invoices": [], "receipts": []})
            return
        try:
            self.send_json(build_customer_related_payload(client, customer_id))
        except SupabaseError as exc:
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_GATEWAY)

    def handle_artisan_related(self, query_params: dict[str, list[str]]) -> None:
        artisan_id = (query_params.get("id") or [""])[0].strip()
        if not artisan_id:
            self.send_json({"error": "Missing id"}, status=HTTPStatus.BAD_REQUEST)
            return
        client = get_client()
        if not client:
            self.send_json({"stock_items": []})
            return
        try:
            self.send_json(build_artisan_related_payload(client, artisan_id))
        except SupabaseError as exc:
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_GATEWAY)

    def handle_stock_item_related(self, query_params: dict[str, list[str]]) -> None:
        stock_item_id = (query_params.get("id") or [""])[0].strip()
        if not stock_item_id:
            self.send_json({"error": "Missing id"}, status=HTTPStatus.BAD_REQUEST)
            return
        client = get_client()
        if not client:
            self.send_json({"artisan": None})
            return
        try:
            self.send_json(build_stock_item_related_payload(client, stock_item_id))
        except SupabaseError as exc:
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_GATEWAY)

    def handle_customer_search(self, query_params: dict[str, list[str]]) -> None:
        query = (query_params.get("q") or [""])[0].strip()
        if len(query) < 2:
            self.send_json({"suggestions": []})
            return
        client = get_client()
        if not client:
            self.send_json({"suggestions": []})
            return
        try:
            self.send_json({"suggestions": search_customers(client, query)})
        except SupabaseError as exc:
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_GATEWAY)

    def handle_artisan_search(self, query_params: dict[str, list[str]]) -> None:
        query = (query_params.get("q") or [""])[0].strip()
        if len(query) < 2:
            self.send_json({"suggestions": []})
            return
        client = get_client()
        if not client:
            self.send_json({"suggestions": []})
            return
        try:
            self.send_json({"suggestions": search_artisans(client, query)})
        except SupabaseError as exc:
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_GATEWAY)

    def handle_stock_item_search(self, query_params: dict[str, list[str]]) -> None:
        query = (query_params.get("q") or [""])[0].strip()
        if not query:
            self.send_json({"suggestions": []})
            return
        client = get_client()
        if not client:
            self.send_json({"suggestions": []})
            return
        try:
            self.send_json({"suggestions": search_stock_items(client, query)})
        except SupabaseError as exc:
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_GATEWAY)

    def handle_order_search(self, query_params: dict[str, list[str]]) -> None:
        query = (query_params.get("q") or [""])[0].strip()
        if not query:
            self.send_json({"suggestions": []})
            return
        client = get_client()
        if not client:
            self.send_json({"suggestions": []})
            return
        try:
            self.send_json({"suggestions": search_orders(client, query)})
        except SupabaseError as exc:
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_GATEWAY)

    def handle_invoice_search(self, query_params: dict[str, list[str]]) -> None:
        query = (query_params.get("q") or [""])[0].strip()
        if not query:
            self.send_json({"suggestions": []})
            return
        client = get_client()
        if not client:
            self.send_json({"suggestions": []})
            return
        try:
            self.send_json({"suggestions": search_invoices(client, query)})
        except SupabaseError as exc:
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_GATEWAY)

    def handle_receipt_search(self, query_params: dict[str, list[str]]) -> None:
        query = (query_params.get("q") or [""])[0].strip()
        if not query:
            self.send_json({"suggestions": []})
            return
        client = get_client()
        if not client:
            self.send_json({"suggestions": []})
            return
        try:
            self.send_json({"suggestions": search_receipts(client, query)})
        except SupabaseError as exc:
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_GATEWAY)

    def handle_billing(self, query_params: dict[str, list[str]]) -> None:
        client = get_client()
        if not client:
            self.send_json({"documents": []})
            return
        try:
            query = (query_params.get("q") or [""])[0]
            document_id = (query_params.get("document_id") or [""])[0].strip()
            self.send_json(build_billing_payload(client, query, document_id))
        except SupabaseError as exc:
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_GATEWAY)

    def handle_admin_list(self, slug: str, query_params: dict[str, list[str]]) -> None:
        entity = self.resolve_entity(slug)
        if not entity:
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return
        client = get_client()
        if not client:
            self.send_json({"rows": []})
            return
        try:
            rows = self.fetch_entity_rows(client, entity, query_params)
            response_payload: dict[str, Any] = {"rows": rows, "entity": entity_to_meta(entity)}
            if entity.slug == "raw-metal-purchases":
                purchases = client.select_rows(
                    entity.table,
                    select="metal,weight_g",
                    order=entity.order,
                    limit=10000,
                )
                totals = {"gold": 0.0, "silver": 0.0}
                for purchase in purchases:
                    metal = str(purchase.get("metal") or "").lower()
                    if metal in totals:
                        totals[metal] += numeric_or_zero(purchase.get("weight_g"))
                response_payload["stockTotals"] = totals
        except SupabaseError as exc:
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_GATEWAY)
            return
        self.send_json(response_payload)

    def fetch_entity_rows(
        self,
        client: SupabaseRestClient,
        entity: EntityDef,
        query_params: dict[str, list[str]],
    ) -> list[dict[str, Any]]:
        query = (query_params.get("q") or [""])[0].strip()
        if entity.slug == "notifications":
            return fetch_notification_rows(client, query_params, query=query)
        rows = client.select_rows(
            entity.table,
            select=entity.select_fields,
            order=entity.order,
            limit=entity.limit,
        )
        if entity.slug == "stock-items":
            rows = decorate_stock_item_rows(client, rows)
        if entity.slug == "payment-transactions":
            rows = decorate_payment_transaction_rows(client, rows)
        if query:
            rows = [
                row for row in rows if match_search(row, query, entity.search_fields)
            ]
        return rows

    def handle_admin_export(
        self, slug: str, query_params: dict[str, list[str]]
    ) -> None:
        entity = self.resolve_entity(slug)
        if not entity:
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return
        client = get_client()
        if not client:
            self.send_json(
                {"error": "Supabase client is not configured."},
                status=HTTPStatus.INTERNAL_SERVER_ERROR,
            )
            return
        try:
            rows = self.fetch_entity_rows(client, entity, query_params)
        except SupabaseError as exc:
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_GATEWAY)
            return

        output = StringIO()
        writer = csv.writer(output)
        headers = [
            entity.primary_key,
            *(
                field.name
                for field in entity.fields
                if field.name != entity.primary_key
            ),
        ]
        writer.writerow(headers)
        for row in rows:
            writer.writerow(
                [stringify_csv_value(row.get(header)) for header in headers]
            )
        csv_text = output.getvalue()
        filename = f"{entity.slug}-{date.today().isoformat()}.csv"
        self.send_text(
            csv_text,
            content_type="text/csv; charset=utf-8",
            status=HTTPStatus.OK,
            extra_headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )

    def handle_admin_upsert(self, slug: str) -> None:
        entity = self.resolve_entity(slug)
        if not entity:
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return
        client = get_client()
        if not client:
            self.send_json(
                {"error": "Supabase client is not configured."},
                status=HTTPStatus.INTERNAL_SERVER_ERROR,
            )
            return
        try:
            payload = self.read_json_body()
            if entity.slug == "notifications":
                row = prepare_notification_row(client, payload)
            elif entity.slug == "payment-transactions":
                row = prepare_payment_transaction_row(
                    client, payload, sanitize_row(entity, payload)
                )
            elif entity.slug == "stock-items":
                row = sanitize_row(entity, payload)
                if "huid" in row:
                    row["huid"] = normalize_huid_list(row["huid"])
                row = prepare_stock_item_row(row)
                artisan_ids = normalize_array_value(payload.get("artisan_ids"))
            else:
                row = sanitize_row(entity, payload)
                if entity.slug == "raw-metal-purchases":
                    if row.get("metal") not in {"gold", "silver"}:
                        raise ValueError("Choose gold or silver.")
                    if not row.get("purchase_date"):
                        raise ValueError("Purchase date is required.")
                    if not str(row.get("source_name") or "").strip():
                        raise ValueError("Source of purchase is required.")
                    if numeric_or_zero(row.get("weight_g")) <= 0:
                        raise ValueError("Weight must be greater than zero.")
                    if numeric_or_zero(row.get("rate_per_gram")) <= 0:
                        raise ValueError("Rate per gram must be greater than zero.")
                    row["source_name"] = str(row["source_name"]).strip()
                if entity.slug == "orders" and not row.get("id"):
                    # Existing installations still have the legacy enum. The UI
                    # maps `open` to Created until the lifecycle migration lands.
                    row["status"] = "open"
                if entity.slug == "customers":
                    row = _auto_map_customer_gst_codes(row)
                if entity.slug == "advance-receipts":
                    row = preserve_linked_receipt_id_for_advance_receipt(
                        client, payload, row
                    )
                if entity.slug == "order-items" and not row.get("id"):
                    order_id = str(row.get("order_id") or "").strip()
                    if not order_id:
                        raise ValueError("Choose the order before adding an item.")
                    row["line_no"] = next_order_item_line_no(client, order_id)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        except json.JSONDecodeError:
            self.send_json(
                {"error": "Invalid JSON payload."}, status=HTTPStatus.BAD_REQUEST
            )
            return

        try:
            primary_value = row.get(entity.primary_key)
            if entity.slug == "order-items" and primary_value:
                # Line numbers are assigned internally and intentionally omitted
                # from the modal. Preserve them when final stock details replace a
                # rough item, rather than sending NULL through the generic upsert.
                existing_items = client.select_rows(
                    "order_items",
                    select="id,order_id,line_no",
                    filters={"id": f"eq.{primary_value}"},
                    limit=1,
                )
                if not existing_items:
                    raise ValueError("The order item could not be found. Refresh the order and try again.")
                row["order_id"] = existing_items[0]["order_id"]
                row["line_no"] = existing_items[0]["line_no"]
            conflict_key = entity.on_conflict or entity.primary_key
            if entity.slug == "order-items" and primary_value:
                # Final details amend the existing rough item. PATCH is safer than
                # an INSERT ... ON CONFLICT here: it cannot create a partial row
                # if a required internal field is absent from the browser payload.
                update_row = {key: value for key, value in row.items() if key != entity.primary_key}
                rows = client.update_rows(
                    entity.table,
                    update_row,
                    filters={entity.primary_key: f"eq.{primary_value}"},
                )
            elif primary_value:
                rows = client.upsert_rows(entity.table, row, on_conflict=conflict_key)
            else:
                rows = client.insert_rows(entity.table, row)
            if entity.slug == "stock-items" and rows:
                stock_item_id = str(
                    rows[0].get("id") or row.get(entity.primary_key) or ""
                ).strip()
                if stock_item_id:
                    sync_stock_item_artisans(client, stock_item_id, artisan_ids)
            if entity.slug == "invoices" and rows:
                recalculated = recalculate_invoice_totals(client, rows[0].get("id"))
                if recalculated:
                    rows = [recalculated]
            if entity.slug == "invoice-items" and rows:
                recalculate_invoice_totals(client, rows[0].get("invoice_id"))
            if entity.slug == "advance-receipts" and rows:
                advance_receipt_id = str(rows[0].get("id") or "").strip()
                if advance_receipt_id:
                    sync_advance_receipt_payment_transaction(client, advance_receipt_id)
                    if rows[0].get("order_id"):
                        record_order_lifecycle_event(client, {
                            "order_id": rows[0]["order_id"],
                            "event_type": "advance_receipt_added" if not primary_value else "advance_receipt_updated",
                            "details": {
                                "receipt_no": rows[0].get("receipt_no") or row.get("receipt_no") or "",
                                "amount": rows[0].get("amount") or row.get("amount") or 0,
                                "transaction_type": rows[0].get("transaction_type") or row.get("transaction_type") or "",
                            },
                        })
            if entity.slug == "orders" and rows and not primary_value:
                record_order_lifecycle_event(client, {"order_id": rows[0]["id"], "event_type": "created", "to_status": "created", "details": {"order_number": rows[0].get("order_number") or ""}})
            elif entity.slug == "orders" and rows:
                record_order_lifecycle_event(client, {"order_id": rows[0]["id"], "event_type": "order_details_updated", "details": {"order_number": rows[0].get("order_number") or ""}})
            if entity.slug == "order-items" and rows:
                item = rows[0]
                record_order_lifecycle_event(client, {
                    "order_id": item["order_id"],
                    "event_type": "final_details_linked" if item.get("stock_item_id") else ("order_item_updated" if primary_value else "order_item_added"),
                    "details": {"item_id": item.get("id"), "description": item.get("description"), "stock_item_id": item.get("stock_item_id")},
                })
        except ValueError as exc:
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return
        except SupabaseError as exc:
            # PostgreSQL check violations are invalid form data, not an
            # upstream gateway failure. Keep other Supabase errors as 502s.
            error_message = str(exc)
            status = (
                HTTPStatus.BAD_REQUEST
                if "23514" in error_message or "violates check constraint" in error_message
                else HTTPStatus.BAD_GATEWAY
            )
            self.send_json({"error": error_message}, status=status)
            return
        except Exception:
            # Keep a handler bug from silently closing the browser connection.
            self.send_json(
                {"error": "The item could not be saved due to an unexpected portal error. Refresh the order and try again."},
                status=HTTPStatus.INTERNAL_SERVER_ERROR,
            )
            return
        self.send_json({"row": rows[0] if rows else row})

    def handle_order_transition(self, order_id: str) -> None:
        """Apply a lifecycle move and record it; the UI never writes status directly."""
        client = get_client()
        if not client:
            self.send_json({"error": "Supabase client is not configured."}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        try:
            payload = self.read_json_body()
            target = str(payload.get("status") or "").strip()
            allowed = {"created", "in_progress", "finished", "pending_delivery", "delivered", "cancelled"}
            if target not in allowed:
                raise ValueError("Invalid lifecycle status.")
            order_rows = client.select_rows("orders", select="id,status,order_number", filters={"id": f"eq.{order_id}"}, limit=1)
            if not order_rows:
                self.send_json({"error": "Order not found."}, status=HTTPStatus.NOT_FOUND)
                return
            order = order_rows[0]
            current = {"draft": "created", "open": "created", "ready": "finished"}.get(str(order.get("status") or "created"), str(order.get("status") or "created"))
            if target == "in_progress":
                items = client.select_rows("order_items", select="id", filters={"order_id": f"eq.{order_id}"}, limit=500)
                if not items:
                    raise ValueError("Add at least one item before handing the order to artisans.")
                assignments = client.select_rows("order_artisan_assignments", select="order_item_id", filters={"order_id": f"eq.{order_id}"}, limit=2000)
                assigned_item_ids = {str(assignment.get("order_item_id") or "") for assignment in assignments}
                if any(str(item.get("id")) not in assigned_item_ids for item in items):
                    raise ValueError("Assign at least one artisan to every item before starting manufacture.")
            if target == "pending_delivery":
                items = client.select_rows("order_items", select="id,stock_item_id", filters={"order_id": f"eq.{order_id}"}, limit=500)
                if not items or any(not item.get("stock_item_id") for item in items):
                    raise ValueError("Link a stock number for every item before Pending Delivery.")
            if target == "delivered":
                receipts = client.select_rows("receipts", select="id", filters={"linked_reference_no": f"eq.{order.get('order_number')}"}, limit=1)
                invoices = client.select_rows("invoices", select="id", filters={"order_id": f"eq.{order_id}"}, limit=1)
                if not receipts and not invoices:
                    raise ValueError("Delivered is set only after a bill or receipt bearing this order number is generated.")
            updated = client.update_rows("orders", {"status": target}, filters={"id": f"eq.{order_id}"})
            event_type = "cancelled" if target == "cancelled" else "delivered" if target == "delivered" else "status_changed"
            record_order_lifecycle_event(client, {"order_id": order_id, "event_type": event_type, "from_status": current, "to_status": target, "details": {"remarks": payload.get("remarks") or ""}})
            self.send_json({"row": updated[0] if updated else order})
        except (ValueError, SupabaseError) as exc:
            message = str(exc)
            if isinstance(exc, SupabaseError) and "order_item_id" in message:
                message = "The artisan-assignment database update has not been applied yet. Apply the Order Lifecycle migration, then try again."
            self.send_json({"error": message}, status=HTTPStatus.BAD_REQUEST if isinstance(exc, ValueError) else HTTPStatus.BAD_GATEWAY)

    def handle_order_item_artisan_assignment(self, order_id: str, item_id: str) -> None:
        """Attach an artisan to one item; several artisans may be attached to it."""
        client = get_client()
        if not client:
            self.send_json({"error": "Supabase client is not configured."}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        try:
            payload = self.read_json_body()
            artisan_id = str(payload.get("artisan_id") or "").strip()
            if not artisan_id:
                raise ValueError("Choose an artisan for this item.")
            items = client.select_rows("order_items", select="id,description", filters={"id": f"eq.{item_id}", "order_id": f"eq.{order_id}"}, limit=1)
            if not items:
                raise ValueError("That item does not belong to this order.")
            client.insert_rows("order_artisan_assignments", {
                "order_id": order_id,
                "order_item_id": item_id,
                "artisan_id": artisan_id,
                "remarks": clean_text(payload.get("remarks")) or None,
            })
            artisan_rows = client.select_rows("artisans", select="id,name", filters={"id": f"eq.{artisan_id}"}, limit=1)
            record_order_lifecycle_event(client, {
                "order_id": order_id,
                "event_type": "artisan_assigned",
                "details": {"item_id": item_id, "description": items[0].get("description") or "", "artisan_id": artisan_id, "artisan_name": artisan_rows[0].get("name") if artisan_rows else ""},
            })
            self.send_json({"ok": True})
        except ValueError as exc:
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
        except SupabaseError as exc:
            message = str(exc)
            if "order_item_id" in message:
                message = "The artisan-assignment database update has not been applied yet. Apply the Order Lifecycle migration, then try again."
            self.send_json({"error": message}, status=HTTPStatus.BAD_GATEWAY)

    def handle_admin_delete(
        self, slug: str, query_params: dict[str, list[str]]
    ) -> None:
        entity = self.resolve_entity(slug)
        if not entity:
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return
        record_id = (query_params.get("id") or [""])[0].strip()
        if not record_id:
            self.send_json({"error": "Missing id"}, status=HTTPStatus.BAD_REQUEST)
            return
        client = get_client()
        if not client:
            self.send_json(
                {"error": "Supabase client is not configured."},
                status=HTTPStatus.INTERNAL_SERVER_ERROR,
            )
            return
        try:
            if entity.table == "customers":
                customer = load_single_row(
                    client,
                    "customers",
                    select="id,full_name",
                    filters={"id": f"eq.{record_id}"},
                )
                if not customer:
                    self.send_json(
                        {"error": "Customer not found."}, status=HTTPStatus.NOT_FOUND
                    )
                    return
                confirmation = (query_params.get("confirm_name") or [""])[0].strip()
                customer_name = str(customer.get("full_name") or "").strip()
                if confirmation != customer_name:
                    self.send_json(
                        {"error": "Type the customer's full name exactly to confirm deletion."},
                        status=HTTPStatus.BAD_REQUEST,
                    )
                    return
                requested_records = query_params.get("linked_record") or []
                # Retain support for the original all-linked-records checkbox in
                # case an already-open browser tab submits the previous UI.
                delete_all_linked = (
                    (query_params.get("delete_linked") or [""])[0].lower() == "true"
                )
                selected_by_table: dict[str, set[str]] = {
                    table: set() for table in CUSTOMER_LINKED_RECORDS
                }
                for encoded_record in requested_records:
                    table, separator, linked_id = encoded_record.partition(":")
                    if separator and table in CUSTOMER_LINKED_RECORDS and linked_id:
                        selected_by_table[table].add(linked_id)

                # Never trust record IDs supplied by the browser: retain only
                # records that are directly linked to this customer.
                linked_rows: dict[str, list[dict[str, Any]]] = {}
                for table, definition in CUSTOMER_LINKED_RECORDS.items():
                    rows = client.select_rows(
                        table,
                        select=definition["select"],
                        filters={definition["field"]: f"eq.{record_id}"},
                        limit=500,
                    )
                    linked_rows[table] = rows
                    allowed_ids = {
                        str(linked_row.get("id") or "").strip()
                        for linked_row in rows
                        if str(linked_row.get("id") or "").strip()
                    }
                    if delete_all_linked:
                        selected_by_table[table] = allowed_ids
                    else:
                        selected_by_table[table].intersection_update(allowed_ids)

                # Delete selected records using the same cleanup rules as their
                # individual delete buttons. Unselected records remain and their
                # customer_id is cleared by the database constraint below.
                transaction_ids = selected_by_table["payment_transactions"]
                if transaction_ids:
                    joined_ids = ",".join(sorted(transaction_ids))
                    client.delete_rows(
                        "payment_transaction_tenders",
                        filters={"payment_transaction_id": f"in.({joined_ids})"},
                    )
                    client.delete_rows(
                        "payment_transactions", filters={"id": f"in.({joined_ids})"}
                    )
                notification_ids = selected_by_table["notifications"]
                if notification_ids:
                    client.delete_rows(
                        "notifications",
                        filters={"id": f"in.({','.join(sorted(notification_ids))})"},
                    )
                for linked_id in selected_by_table["advance_receipts"]:
                    advance_row = load_single_row(
                        client,
                        "advance_receipts",
                        select="id,receipt_id,transaction_type",
                        filters={"id": f"eq.{linked_id}"},
                    )
                    if not advance_row:
                        continue
                    linked_receipt_id = str(advance_row.get("receipt_id") or "").strip()
                    if (
                        str(advance_row.get("transaction_type") or "").strip()
                        == "old_ornaments_valuation"
                        and linked_receipt_id
                    ):
                        delete_old_ornament_bundle(
                            client,
                            advance_receipt_id=linked_id,
                            receipt_id=linked_receipt_id,
                        )
                    else:
                        delete_advance_receipt_dependencies(client, linked_id)
                        client.delete_rows("advance_receipts", filters={"id": f"eq.{linked_id}"})
                for linked_id in selected_by_table["receipts"]:
                    # An old-ornament receipt may already have been removed with
                    # its selected advance receipt above.
                    receipt = load_single_row(
                        client, "receipts", select="id", filters={"id": f"eq.{linked_id}"}
                    )
                    if not receipt:
                        continue
                    delete_receipt_dependencies(client, linked_id)
                    client.delete_rows("receipts", filters={"id": f"eq.{linked_id}"})
                invoice_ids = selected_by_table["invoices"]
                if invoice_ids:
                    client.delete_rows(
                        "invoices", filters={"id": f"in.({','.join(sorted(invoice_ids))})"}
                    )
                order_ids = selected_by_table["orders"]
                if order_ids:
                    client.delete_rows(
                        "orders", filters={"id": f"in.({','.join(sorted(order_ids))})"}
                    )
                client.delete_rows("customers", filters={"id": f"eq.{record_id}"})
            elif entity.table == "invoice_items":
                invoice_item = load_single_row(
                    client,
                    "invoice_items",
                    select="invoice_id",
                    filters={"id": f"eq.{record_id}"},
                )
                client.delete_rows(
                    entity.table, filters={entity.primary_key: f"eq.{record_id}"}
                )
                if invoice_item:
                    recalculate_invoice_totals(client, invoice_item.get("invoice_id"))
            elif entity.table == "advance_receipts":
                record = load_single_row(
                    client,
                    "advance_receipts",
                    select="id,receipt_id,transaction_type,order_id,receipt_no,amount",
                    filters={"id": f"eq.{record_id}"},
                )
                if not record:
                    self.send_json(
                        {"error": "Record not found."}, status=HTTPStatus.NOT_FOUND
                    )
                    return
                if record.get("order_id"):
                    record_order_lifecycle_event(client, {
                        "order_id": record["order_id"],
                        "event_type": "advance_receipt_deleted",
                        "details": {"receipt_no": record.get("receipt_no") or "", "amount": record.get("amount") or 0},
                    })
                receipt_id = str(record.get("receipt_id") or "").strip()
                transaction_type = str(record.get("transaction_type") or "").strip()
                if transaction_type == "old_ornaments_valuation" and receipt_id:
                    delete_old_ornament_bundle(
                        client, advance_receipt_id=record_id, receipt_id=receipt_id
                    )
                else:
                    delete_advance_receipt_dependencies(client, record_id)
                    client.delete_rows(
                        entity.table, filters={entity.primary_key: f"eq.{record_id}"}
                    )
            elif entity.table == "receipts":
                advance_row = load_single_row(
                    client,
                    "advance_receipts",
                    select="id,transaction_type",
                    filters={
                        "receipt_id": f"eq.{record_id}",
                        "transaction_type": "eq.old_ornaments_valuation",
                    },
                )
                if advance_row:
                    delete_old_ornament_bundle(
                        client,
                        advance_receipt_id=str(advance_row.get("id") or "").strip(),
                        receipt_id=record_id,
                    )
                else:
                    delete_receipt_dependencies(client, record_id)
                    client.delete_rows(
                        entity.table, filters={entity.primary_key: f"eq.{record_id}"}
                    )
            elif entity.table == "order_items":
                item = load_single_row(
                    client,
                    "order_items",
                    select="id,order_id,description",
                    filters={"id": f"eq.{record_id}"},
                )
                if item and item.get("order_id"):
                    record_order_lifecycle_event(client, {
                        "order_id": item["order_id"],
                        "event_type": "order_item_deleted",
                        "details": {"description": item.get("description") or ""},
                    })
                client.delete_rows(entity.table, filters={entity.primary_key: f"eq.{record_id}"})
            elif entity.table == "payment_transactions":
                transaction_id = record_id
                client.delete_rows(
                    "payment_transaction_tenders",
                    filters={"payment_transaction_id": f"eq.{transaction_id}"},
                )
                client.delete_rows(
                    entity.table, filters={entity.primary_key: f"eq.{record_id}"}
                )
            else:
                client.delete_rows(
                    entity.table, filters={entity.primary_key: f"eq.{record_id}"}
                )
        except SupabaseError as exc:
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_GATEWAY)
            return
        self.send_json({"ok": True})

    def handle_delete_check(
        self, slug: str, query_params: dict[str, list[str]]
    ) -> None:
        entity = self.resolve_entity(slug)
        if not entity:
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return
        record_id = (query_params.get("id") or [""])[0].strip()
        if not record_id:
            self.send_json({"error": "Missing id"}, status=HTTPStatus.BAD_REQUEST)
            return
        client = get_client()
        if not client:
            self.send_json(
                {"error": "Supabase client is not configured."},
                status=HTTPStatus.INTERNAL_SERVER_ERROR,
            )
            return
        try:
            rows = client.select_rows(
                entity.table,
                select=entity.select_fields,
                filters={entity.primary_key: f"eq.{record_id}"},
                limit=1,
            )
            if not rows:
                self.send_json(
                    {"error": "Record not found."}, status=HTTPStatus.NOT_FOUND
                )
                return
            record = rows[0]
            dependents: list[dict[str, Any]] = []
            linked_records: list[dict[str, str]] = []
            total = 0
            for relation in DELETE_RELATIONSHIPS.get(entity.table, []):
                count = client.count_rows(
                    relation["table"], filters={relation["field"]: f"eq.{record_id}"}
                )
                if count:
                    total += count
                    dependents.append(
                        {
                            "label": relation["label"],
                            "table": relation["table"],
                            "count": count,
                            "cascade": bool(relation.get("cascade")),
                        }
                    )
                    if entity.table == "customers":
                        definition = CUSTOMER_LINKED_RECORDS.get(relation["table"])
                        if definition:
                            for linked_row in client.select_rows(
                                relation["table"],
                                select=definition["select"],
                                filters={relation["field"]: f"eq.{record_id}"},
                                limit=500,
                            ):
                                linked_id = str(linked_row.get("id") or "").strip()
                                if linked_id:
                                    linked_records.append(
                                        {
                                            "id": linked_id,
                                            "table": relation["table"],
                                            "label": str(definition["label"]),
                                            "recordNo": str(
                                                linked_row.get(definition["label_field"])
                                                or linked_id
                                            ),
                                        }
                                    )
        except SupabaseError as exc:
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_GATEWAY)
            return
        self.send_json(
            {
                "recordId": record_id,
                "recordLabel": summarize_record(entity, record),
                "entityLabel": entity.label,
                "dependentCount": total,
                "dependents": dependents,
                "linkedRecords": linked_records,
            }
        )

    def read_json_body(self) -> dict[str, Any]:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length else b"{}"
        return json.loads(raw_body.decode("utf-8"))

    def serve_index(self) -> None:
        html = (TEMPLATES_DIR / "index.html").read_text(encoding="utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(html.encode("utf-8"))

    def serve_file(self, path: Path) -> None:
        safe_path = path.resolve()
        if (
            not str(safe_path).startswith(str(STATIC_DIR.resolve()))
            or not safe_path.exists()
        ):
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return
        content_type, _encoding = mimetypes.guess_type(str(safe_path))
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.end_headers()
        self.wfile.write(safe_path.read_bytes())

    def send_json(self, payload: dict[str, Any], status: int = HTTPStatus.OK) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def send_text(
        self,
        payload: str,
        *,
        content_type: str,
        status: int = HTTPStatus.OK,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        raw = payload.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, format: str, *args: Any) -> None:
        return


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 5051), MasterPortalHandler)
    print("Master portal running at http://127.0.0.1:5051")
    server.serve_forever()
