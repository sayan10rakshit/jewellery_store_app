"""
Tax Invoice Generator
"""

from datetime import datetime
from functools import lru_cache
import os
from pathlib import Path
import subprocess
import tempfile
from typing import Any
from tax_calculations import classify_hsn_code, resolve_item_total, tax_groups

def format_indian_number(value, decimals=2):
    """Format number with Indian comma separators."""
    if value is None or value == "":
        return f"0.{'0'*decimals}"
        
    try:
        val_str = f"{float(value):.{decimals}f}"
    except (ValueError, TypeError):
        return str(value)
        
    if "." in val_str:
        integer_part, decimal_part = val_str.split(".")
    else:
        integer_part, decimal_part = val_str, ""
        
    is_negative = False
    if integer_part.startswith("-"):
        is_negative = True
        integer_part = integer_part[1:]
        
    if len(integer_part) > 3:
        last_3 = integer_part[-3:]
        other = integer_part[:-3]
        
        groups = []
        while other:
            groups.append(other[-2:])
            other = other[:-2]
            
        groups.reverse()
        groups.append(last_3)
        formatted_integer = ",".join(groups)
    else:
        formatted_integer = integer_part
        
    if is_negative:
        formatted_integer = "-" + formatted_integer
        
    if decimal_part:
        return f"{formatted_integer}.{decimal_part}"
    return formatted_integer


def format_amount(amount):
    """Format amount with 2 decimal places and Indian comma separators."""
    return format_indian_number(amount, 2)


def format_amount_or_dash(amount):
    """Render zero-like exchange balances as a dash for cleaner display."""
    try:
        return "-" if float(amount) <= 0 else format_amount(amount)
    except (ValueError, TypeError):
        return format_amount(amount)


def format_weight(weight):
    """Format weight with 3 decimal places."""
    return format_indian_number(weight, 3)


def amount_to_words_indian(amount):
    """Convert amount to Indian English words."""
    try:
        rupees = int(amount)
        paise = int(round((amount - rupees) * 100))

        if rupees == 0:
            words = "Zero Rupees"
        else:
            words = f"{number_to_indian_words(rupees)} Rupees"

        if paise > 0:
            words += f" And {number_to_indian_words(paise)} Paise"

        return words + " Only"
    except Exception:
        return "Amount conversion error"


ONES = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
]

TENS = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
]


def two_digit_words(number: int) -> str:
    if number < 20:
        return ONES[number]
    tens, ones = divmod(number, 10)
    return f"{TENS[tens]} {ONES[ones]}".strip()


def three_digit_words(number: int) -> str:
    hundreds, remainder = divmod(number, 100)
    parts = []
    if hundreds:
        parts.append(f"{ONES[hundreds]} Hundred")
    if remainder:
        parts.append(two_digit_words(remainder))
    return " ".join(parts).strip()


def number_to_indian_words(number: int) -> str:
    if number == 0:
        return "Zero"

    parts = []
    crore, number = divmod(number, 10_000_000)
    lakh, number = divmod(number, 100_000)
    thousand, number = divmod(number, 1_000)
    hundred_block = number

    if crore:
        parts.append(f"{number_to_indian_words(crore)} Crore")
    if lakh:
        parts.append(f"{number_to_indian_words(lakh)} Lakh")
    if thousand:
        parts.append(f"{number_to_indian_words(thousand)} Thousand")
    if hundred_block:
        parts.append(three_digit_words(hundred_block))

    return " ".join(part for part in parts if part).strip()


def format_optional_weight(value: float, show_blank_for_zero: bool = False) -> str:
    numeric = float(value or 0)
    if show_blank_for_zero and numeric == 0:
        return "-"
    return format_weight(numeric)


def format_optional_amount(value: float, show_blank_for_zero: bool = False) -> str:
    numeric = float(value or 0)
    if show_blank_for_zero and numeric == 0:
        return "-"
    return format_amount(numeric)


def to_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text == "":
        return default
    return text in {"1", "true", "yes", "on"}


def contact_email_line(person: dict[str, Any]) -> str:
    contact = str(person.get("contact", "")).strip()
    contact2 = str(person.get("contact2", "")).strip()
    email = str(person.get("email", "")).strip()
    contact_value = contact
    if contact2:
        contact_value = f"{contact_value} / {contact2}" if contact_value else contact2
    if email:
        return f"CONTACT NO: {contact_value}    EMAIL: {email}"
    return f"CONTACT NO: {contact_value}"


def nil_safe_amount_words(amount: float) -> str:
    return "NIL" if amount <= 0 else amount_to_words_indian(amount)


def get_document_settings(invoice_data: dict[str, Any]) -> dict[str, Any]:
    return invoice_data.get("document_settings", {}) or {}


def render_receipt_html(
    invoice_data: dict[str, Any],
    include_terms_and_conditions: bool = False,
    include_preview_ids: bool = False,
) -> str:
    customer = invoice_data.get("customer_info", {})
    invoice = invoice_data.get("invoice_info", {})
    items = invoice_data.get("items", [])
    payment = invoice_data.get("payment_info", {})
    settings = get_document_settings(invoice_data)
    exchange_mode = bool(settings.get("exchange_mode"))
    is_duplicate = str(invoice.get("copy_type", "")).strip().lower() == "duplicate"

    logo_svg, name_svg, bis_logo_svg, _invoice_terms_svg, receipt_terms_svg, footer_svg, company_address_svg = load_svg_assets()

    total_gross_weight = 0.0
    total_deduction_weight = 0.0
    total_net_weight = 0.0
    total_amount = 0.0
    normalized_items: list[dict[str, Any]] = []

    for item in items:
        gross_weight = float(item.get("gross_weight", 0))
        deduction_weight = float(item.get("stone_dust_deduction", item.get("diamond_or_stone_weight", 0)))
        net_weight = float(item.get("net_weight", 0))
        rate_per_gram = float(item.get("rate_per_gram", 0))
        amount = float(item.get("amount", 0))

        total_gross_weight += gross_weight
        total_deduction_weight += deduction_weight
        total_net_weight += net_weight
        total_amount += amount

        normalized_items.append(
            {
                **item,
                "gross_weight": gross_weight,
                "stone_dust_deduction": deduction_weight,
                "net_weight": net_weight,
                "rate_per_gram": rate_per_gram,
                "amount": amount,
            }
        )

    less_invoice_amount = float(payment.get("less_invoice_amount", 0) or 0) if exchange_mode else 0.0
    net_amount = max(total_amount - less_invoice_amount, 0.0)
    amount_in_words = nil_safe_amount_words(net_amount if exchange_mode else total_amount)
    payment_total = sum(float(payment.get(key, 0)) for key in ("cash_amount", "cheque_amount", "bank_amount"))
    amount_paid = float(payment.get("amount_received", 0)) or payment_total

    _wm_text = "RAKSHIT &amp; CO. JOHUREE"
    watermark_lines_html = ""
    _sep = "&nbsp;&nbsp;&nbsp;&nbsp;"
    for _i in range(80):
        _repeated = (_wm_text + _sep) * 12
        watermark_lines_html += f'            <div class="watermark-text-line">{_repeated}</div>\n'

    items_per_page = max(int(float(settings.get("receipt_item_limit", 4) or 4)), 1)
    page_chunks = [normalized_items[i:i + items_per_page] for i in range(0, len(normalized_items), items_per_page)] or [[]]
    total_pages = len(page_chunks)

    html_content: str = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Receipt - {invoice.get('invoice_no', '')}</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: Arial, sans-serif;
            font-size: 10px;
            line-height: 1.35;
            padding: 0;
            background: #fff;
            color: #000;
        }}

        @page {{
            size: A4;
            margin: 0;
        }}

        @media print {{
            body {{
                padding: 0;
                background: #fff;
            }}
            .invoice-container {{
                margin: 0;
                box-shadow: none;
            }}
            .items-table > thead > tr:nth-child(2) > th {{
                border-top: none;
            }}
            .watermark-logo,
            .watermark-text {{
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }}
            .page-break {{
                page-break-after: always;
            }}
        }}
        
        .invoice-container {{
            width: 100%;
            max-width: 200mm;
            min-height: calc(297mm - 6mm);
            margin: 0 auto;
            background: white;
            border: 1px solid #000;
            padding: 0;
            position: relative;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }}

        .invoice-page-shell {{
            width: 210mm;
            min-height: 297mm;
            margin: 0 auto;
            padding: 3mm;
            background: #fff;
            overflow: hidden;
        }}

        .terms-page {{
            width: 210mm;
            height: 297mm;
            margin: 0 auto;
            overflow: hidden;
            background: #fff;
            display: flex;
            align-items: stretch;
            justify-content: stretch;
        }}

        .terms-page svg,
        .terms-page img {{
            width: 210mm;
            height: 297mm;
            display: block;
            flex: 1 1 auto;
        }}

        .footer-strip-svg svg {{
            width: 100%;
            height: auto;
            display: block;
        }}
        
        .header {{
            border-bottom: none;
            padding: 10px 14px 4px;
            position: relative;
            background: white;
        }}
        
        .header-top {{
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            padding: 3px 0;
        }}
        
        .logo-section {{
            flex: 0 0 100px;
        }}
        
        .logo-section svg {{
            width: 80px;
            height: auto;
        }}
        
        .company-name {{
            text-align: center;
            flex: 1;
            padding: 0 8px;
        }}
        
        .company-name .name-svg {{
            display: block;
            margin: 0 auto 3px;
        }}
        
        .company-name .name-svg svg {{
            width: 100%;
            max-width: 440px;
            height: auto;
        }}
        
        .company-address {{
            font-size: 9px;
            text-align: center;
            line-height: 1.25;
        }}
        
        .company-address svg {{
            width: 100%;
            max-width: 380px;
            height: auto;
            margin: 0 auto;
        }}
        
        .certification-badges {{
            flex: 0 0 120px;
            text-align: right;
        }}
        
        .certification-badges .bis-svg {{
            display: inline-block;
        }}
        
        .certification-badges .bis-svg svg {{
            width: 100px;
            height: auto;
        }}
        
        .original-label {{
            font-size: 9px;
            font-weight: bold;
            margin-bottom: 3px;
        }}
        
        .gstin-line {{
            font-weight: bold;
            padding: 3px 0;
        }}
        
        .invoice-title {{
            text-align: center;
            font-size: 11px;
            font-weight: bold;
            padding: 4px;
            border-top: 1px solid #000;
            border-bottom: 1px solid #000;
        }}
        
        .customer-title {{
            font-weight: bold;
            margin-bottom: 4px;
            font-size: 10px;
        }}
        
        .customer-name {{
            font-weight: bold;
            font-size: 11px;
            margin-bottom: 3px;
        }}

        .items-table {{
            width: 100%;
            margin: 0;
            table-layout: fixed;
            font-weight: bold;
        }}

        table {{
            width: 100%;
            border-collapse: collapse;
        }}
        
        table th {{
            background: rgba(242, 242, 242, 0.25);
            border-left: 1px solid #000;
            border-right: 1px solid #000;
            border-top: 1px solid #000;
            border-bottom: 1px solid #000;
            padding: 4px 2px;
            text-align: center;
            font-size: 9px;
            font-weight: bold;
        }}
        
        table td {{
            border-left: 1px solid #000;
            border-right: 1px solid #000;
            border-top: none;
            border-bottom: none;
            padding: 3px 3px;
            font-size: 11px;
        }}
        
        .items-table > tbody > tr:not(.total-row) > td {{
            vertical-align: top;
        }}
        
        .items-table > thead > tr > th:first-child,
        .items-table > tbody > tr > td:first-child {{
            border-left: none;
        }}

        .items-table > thead > tr > th:last-child,
        .items-table > tbody > tr > td:last-child {{
            border-right: none;
        }}
        
        .text-center {{
            text-align: center;
        }}
        
        .text-right {{
            text-align: right;
        }}
        
        .total-row {{
            font-weight: bold;
            background: rgba(242, 242, 242, 0.25);
            height: 1px;
        }}
        
        .total-row td {{
            border-top: 1px solid #000 !important;
            border-bottom: 1px solid #000 !important;
        }}
        
        .item-description {{
            font-size: 11px;
            line-height: 1.25;
            word-break: break-all;
            overflow-wrap: break-word;
        }}
        
        .amount-words {{
            padding: 4px 8px;
            border-bottom: 1px solid #000;
            font-weight: bold;
            font-style: italic;
            flex-shrink: 0;
        }}
        
        .watermark-logo {{
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 2;
            pointer-events: none;
            opacity: 0.125;
        }}
        
        .watermark-logo svg {{
            width: 350px;
            height: auto;
        }}
        
        .invoice-body-watermark {{
            position: relative;
            overflow: hidden;
            flex: 1;
            display: flex;
            flex-direction: column;
        }}
        
        .invoice-body-watermark > *:not(.watermark-text):not(.watermark-logo) {{
            position: relative;
            z-index: 3;
        }}
        
        .items-table-wrapper {{
            flex: 1;
            display: flex;
            flex-direction: column;
            min-height: 0;
        }}
        
        .items-table-wrapper .items-table {{
            flex: 1;
            margin-bottom: 12px;
        }}
        
        .watermark-text {{
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 1;
            pointer-events: none;
            overflow: hidden;
        }}
        
        .watermark-text-line {{
            white-space: nowrap;
            font-size: 9px;
            font-weight: 700;
            font-family: Arial, Helvetica, sans-serif;
            color: rgba(210, 190, 50, 0.35);
            letter-spacing: 0.5px;
            line-height: 14px;
            overflow: hidden;
        }}
        
        .page-break {{
            page-break-after: always;
        }}
        
        .page-indicator {{
            font-size: 8px;
            font-weight: bold;
            margin-top: 2px;
        }}

        /* ── Duplicate / Ink-saving mode ────────────── */
        body.duplicate-mode .watermark-logo {{
            display: none !important;
        }}
        body.duplicate-mode .watermark-text {{
            display: none !important;
        }}
        body.duplicate-mode .invoice-container,
        body.duplicate-mode .invoice-page-shell,
        body.duplicate-mode .terms-page {{
            -webkit-filter: grayscale(100%);
            filter: grayscale(100%);
        }}
        body.duplicate-mode .logo-section svg {{
            -webkit-filter: grayscale(100%);
            filter: grayscale(100%);
        }}
        body.duplicate-mode .watermark-text-line {{
            color: transparent !important;
        }}
        @media print {{
            body.duplicate-mode .watermark-logo,
            body.duplicate-mode .watermark-text {{
                display: none !important;
            }}
            body.duplicate-mode .invoice-container,
            body.duplicate-mode .invoice-page-shell,
            body.duplicate-mode .terms-page {{
                -webkit-filter: grayscale(100%) !important;
                filter: grayscale(100%) !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }}
        }}
    </style>
</head>
<body{' class="duplicate-mode"' if is_duplicate else ''}>
"""

    for page_idx, page_items in enumerate(page_chunks):
        is_last_page = page_idx == total_pages - 1
        page_label = f"Page {page_idx + 1} of {total_pages}" if total_pages > 1 else ""
        page_break_class = ' class="page-break"' if include_terms_and_conditions or not is_last_page else ""
        page_start_serial = page_idx * items_per_page + 1

        html_content += f"""
    <div{page_break_class}>
    <div class="invoice-page-shell">
    <div class="invoice-container" id="preview-page-{page_idx + 1}" data-preview-page="{page_idx + 1}">
        <div class="watermark-logo">
            {logo_svg}
        </div>
        <div class="header">
            <div class="header-top">
                <div class="logo-section">
                    {logo_svg}
                    <div class="gstin-line">
                        GSTIN : 19AADFR8171Q1ZC
                    </div>
                </div>
                <div class="company-name">
                    <div class="original-label">{invoice.get('copy_type', 'Original for Buyer')}</div>
                    <div class="name-svg">{name_svg}</div>
                    <div class="company-address">
                        {company_address_svg}
                    </div>
                </div>
                <div class="certification-badges">
                    <div class="bis-svg">{bis_logo_svg}</div>
                    {f'<div class="page-indicator">{page_label}</div>' if page_label else ''}
                </div>
            </div>
        </div>
        
        <div class="invoice-body-watermark">
        <div class="watermark-text">
{watermark_lines_html}        </div>
        
        <div class="invoice-title" {'id="preview-top"' if include_preview_ids and page_idx == 0 else ''}>RECEIPT</div>
        
        <div style="display: flex; border-bottom: 1px solid #000; padding: 10px;">
            <div style="flex: 1;">
                <div style="margin-bottom: 3px;">
                    <strong>RECEIPT NO :</strong> {invoice.get('invoice_no', '')}
                </div>
                {f'''<div><strong>LINKED INVOICE NO :</strong> {invoice.get('linked_invoice_no', '')}</div>''' if exchange_mode and invoice.get('linked_invoice_no', '') else ''}
            </div>
            <div style="flex: 1;">
                <div style="margin-bottom: 3px;">
                    <strong>LINKED ORDER NO :</strong> {invoice.get('order_no', '')}
                </div>
                <div>
                    <strong>ORDER DATE &amp; TIME :</strong> {invoice.get('order_date', '')}
                </div>
            </div>
            <div style="flex: 1;">
                <div style="margin-bottom: 3px;">
                    <strong>DATE &amp; TIME :</strong> {invoice.get('invoice_date', datetime.now().strftime('%d/%m/%Y %H:%M:%S'))}
                </div>
            </div>
        </div>
        
        <div style="border-bottom: 1px solid #000; padding: 8px 10px;" {'id="preview-customer"' if include_preview_ids and page_idx == 0 else ''}>
            <div class="customer-title">Details of Customer / Seller :</div>
            <div class="customer-name">{customer.get('name', '').upper()}</div>
            <div>{customer.get('address', '')}</div>
            <div>{contact_email_line(customer)}</div>
            <div>STATE NAME: {customer.get('state_name', '')}{', CODE: ' + customer.get('state_gst_code', '') if customer.get('state_gst_code') else ''}</div>
            <div>PINCODE: {customer.get('pincode', '')}</div>
            <div>PAN / AADHAAR NO: {customer.get('pan_aadhaar', '')}</div>
        </div>
        
        <div class="items-table-wrapper" {'id="preview-items-page-' + str(page_idx + 1) + '"' if include_preview_ids else ''}>
        <table class="items-table">
            <colgroup>
                <col style="width: 5%;">
                <col style="width: 31%;">
                <col style="width: 8%;">
                <col style="width: 11%;">
                <col style="width: 13%;">
                <col style="width: 11%;">
                <col style="width: 21%;">
            </colgroup>
            <thead>
                <tr>
                    <th style="width: 5%;">S<br>L<br>N<br>O</th>
                    <th style="width: 31%;">DESCRIPTION</th>
                    <th style="width: 8%;">P<br>u<br>r<br>i<br>t<br>y</th>
                    <th style="width: 11%;">Gross<br>Wt<br>(g)</th>
                    <th style="width: 13%;">Net<br>Wt<br>(g)</th>
                    <th style="width: 11%;">Rate/g<br>(Rs.)</th>
                    <th style="width: 21%;">TOTAL<br>AMOUNT<br>(Rs.)</th>
                </tr>
            </thead>
            <tbody>
"""

        for local_idx, item in enumerate(page_items):
            idx = page_start_serial + local_idx
            is_amount_only = (
                item.get("gross_weight", 0) == 0
                and item.get("stone_dust_deduction", 0) == 0
                and item.get("net_weight", 0) == 0
                and item.get("rate_per_gram", 0) == 0
            )
            html_content += f"""                <tr>
                    <td class="text-center">{idx}</td>
                    <td class="item-description">{item.get('description', '')}</td>
                    <td class="text-center">{item.get('purity', '')}</td>
                    <td class="text-right">{format_optional_weight(item.get('gross_weight', 0), is_amount_only)}</td>
                    <td class="text-right">{format_optional_weight(item.get('net_weight', 0), is_amount_only)}</td>
                    <td class="text-right">{format_optional_amount(item.get('rate_per_gram', 0), is_amount_only)}</td>
                    <td class="text-right">{format_amount(item.get('amount', 0))}</td>
                </tr>
"""

        if is_last_page:
            html_content += f"""                <tr class="total-row">
                    <td></td>
                    <td class="text-center">TOTAL</td>
                    <td></td>
                    <td class="text-center">{format_weight(total_gross_weight)}</td>
                    <td class="text-center">{format_weight(total_net_weight)}</td>
                    <td></td>
                    <td class="text-center">{format_amount(total_amount)}</td>
                </tr>
"""
        else:
            html_content += """                <tr class="total-row">
                    <td></td>
                    <td class="text-center">TOTAL</td>
                    <td></td>
                    <td class="text-center">-</td>
                    <td class="text-center">-</td>
                    <td></td>
                    <td class="text-center">-</td>
                </tr>
"""

        html_content += f"""            </tbody>
        </table>
        
        <div class="amount-words">
            {'Rupees ' + amount_in_words.replace(' Rupees', '') if is_last_page and amount_in_words != 'NIL' else amount_in_words if is_last_page else ''}
        </div>
        </div>
        </div>
        
        <div style="padding: 0;" {'id="preview-payment"' if include_preview_ids and is_last_page else ''}>
            <div style="display: flex; gap: 0; border-bottom: 1px solid #000; border-top: none;">
                <div style="flex: 1; border-right: 1px solid #000; display: flex; flex-direction: column;">
                    <div style="padding: 0 6px 4px; flex: 1;">
                        <table style="border-collapse: collapse; font-size: 9px; width: 100%;">
                            <tr>
                                <td style="border: none; padding: 4px 6px; font-weight: bold; width: 25%;">MODE OF PAYMENT</td>
                                <td style="border: none; padding: 4px 6px; font-weight: bold; width: 25%;">BANK NAME</td>
                                <td style="border: none; padding: 4px 6px; font-weight: bold; width: 25%;">ACC/CHEQUE NO.</td>
                                <td style="border: none; padding: 4px 6px; font-weight: bold; width: 25%; text-align: right;">AMOUNT</td>
                            </tr>
                            <tr>
                                <td style="border: none; padding: 4px 6px;">CASH</td>
                                <td style="border: none; padding: 4px 6px;">-</td>
                                <td style="border: none; padding: 4px 6px;">-</td>
                                <td style="border: none; padding: 4px 6px; text-align: right;">{format_amount(payment.get('cash_amount', 0))}</td>
                            </tr>
                            <tr>
                                <td style="border: none; padding: 4px 6px;">CHEQUE</td>
                                <td style="border: none; padding: 4px 6px;">{payment.get('cheque_bank_name', '')}</td>
                                <td style="border: none; padding: 4px 6px;">{payment.get('cheque_number', '')}</td>
                                <td style="border: none; padding: 4px 6px; text-align: right;">{format_amount(payment.get('cheque_amount', 0))}</td>
                            </tr>
                            <tr>
                                <td style="border: none; padding: 4px 6px;">BANK</td>
                                <td style="border: none; padding: 4px 6px;">{payment.get('bank_name', 'N/A') if payment.get('bank_amount', 0) > 0 else '-'}</td>
                                <td style="border: none; padding: 4px 6px;">{payment.get('account_number', '-') if payment.get('bank_amount', 0) > 0 else '-'}</td>
                                <td style="border: none; padding: 4px 6px; text-align: right;">{format_amount(payment.get('bank_amount', 0))}</td>
                            </tr>
                        </table>
                    </div>
                    {f'''<div style="padding: 5px 12px; display: flex; align-items: flex-start; font-size: 9px; box-sizing: border-box;">
                        <strong style="min-width: 25%; flex-shrink: 0;">Remarks</strong>
                        <span style="font-style: italic; flex: 1; word-break: break-word; overflow-wrap: break-word;">{payment.get('remarks', '')}</span>
                    </div>''' if payment.get('remarks', '').strip() else ''}
                </div>
                
                <div style="display: flex; flex-direction: column; min-width: 220px;">
                    {f'''<div style="margin-top: auto;">
                        <table style="border-collapse: collapse; font-size: 9px; min-width: 220px;">
                            <tr>
                                <td style="border: none; border-bottom: 1px solid #ddd; text-align: right; padding: 4px 6px; font-weight: bold;">TOTAL AMOUNT</td>
                                <td style="border: none; border-bottom: 1px solid #ddd; text-align: right; padding: 4px 6px; font-weight: bold;">{format_amount(total_amount)}</td>
                            </tr>
                            <tr>
                                <td style="border: none; border-bottom: 1px solid #ddd; text-align: right; padding: 4px 6px; font-weight: bold;">LESS INVOICE AMOUNT</td>
                                <td style="border: none; border-bottom: 1px solid #ddd; text-align: right; padding: 4px 6px;">{format_amount(less_invoice_amount)}</td>
                            </tr>
                            <tr>
                                <td style="border: none; text-align: right; padding: 4px 6px; font-weight: bold;">NET AMOUNT</td>
                                <td style="border: none; text-align: right; padding: 4px 6px; font-weight: bold; background: #e8f4f8;">{format_amount_or_dash(net_amount)}</td>
                            </tr>
                        </table>
                    </div>''' if exchange_mode else f'''<div style="flex: 1; display: flex; align-items: center; justify-content: center; font-weight: bold;">
                        <div style="text-align: center;">
                            <div style="font-size: 9px; margin-bottom: 4px;">TOTAL AMOUNT</div>
                            <div style="font-size: 16px;">{format_amount(total_amount)}</div>
                        </div>
                    </div>'''}
                    <div style="display: flex; border-top: 1px solid #000; height: 38px; box-sizing: border-box;">
                        <div style="padding: 5px 8px; font-weight: bold; text-align: center; border-right: 1px solid #000; min-width: 110px;">
                            <div style="font-size: 9px; margin-bottom: 2px;">AMOUNT RECEIVED</div>
                            <div style="font-size: 13px;">{format_amount(amount_paid)}</div>
                        </div>
                        <div style="padding: 5px 8px; font-weight: bold; text-align: center; min-width: 110px;">
                            <div style="font-size: 9px; margin-bottom: 2px;">BALANCE AMOUNT</div>
                            <div style="font-size: 13px;">{format_amount(max((net_amount if exchange_mode else total_amount) - amount_paid, 0))}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <div style="padding: 6px 14px 6px;">
            <div style="display: flex; justify-content: space-between; font-size: 10px;">
                <div><strong>Narration :</strong> {payment.get('narration', '')}</div>
                <div style="text-align: right;">
                    <div style="font-weight: bold; margin-bottom: 2px;">FOR RAKSHIT & CO. JOHUREE</div>
                </div>
            </div>
            
            <div style="height: 28px;"></div>
            
            <div style="font-size: 9px; margin-bottom: 8px;">
                I agree that this Transaction took place as mutually agreed upon specific "Terms and Conditions" furnished overleaf.
            </div>
            
            <div style="font-size: 10px; text-align: center; margin-bottom: 8px;">
                <strong>All jewellery items are breakable, please handle with care.</strong>
            </div>
        </div>

        <div style="margin: 0; padding: 6px 0; font-size: 11px; text-align: center; font-weight: bold; background: #f9f9f9; border-top: 1px solid #000;">
            <div class="footer-strip-svg">{footer_svg}</div>
        </div>
    </div>
    </div>
    </div>
"""

        if include_terms_and_conditions:
            terms_break_class = ' class="page-break"' if page_idx != total_pages - 1 else ""
            html_content += f"""
    <div{terms_break_class}>
    <div class="terms-page" aria-label="Terms and Conditions page {page_idx + 1}">
        {receipt_terms_svg}
    </div>
    </div><!-- end terms page wrapper -->
"""

    html_content += """
</body>
</html>"""
    return html_content


def render_invoice_html(
    invoice_data,
    include_terms_and_conditions: bool = False,
    include_preview_ids: bool = False,
):
    """
    Render invoice HTML matching the bill format.

    Args:
        invoice_data: Dictionary containing invoice details with keys:
            - customer_info: Customer details (name, address, contact, etc.)
            - invoice_info: Invoice number, date, order details
            - items: List of items with description, HSN, weight, rate, etc.
            - payment_info: Payment details (mode, amounts)
            - charges: Other charges (hallmark charges, conch shell charges, etc.)

    Returns:
        Rendered HTML as a string
    """

    if invoice_data.get("document_type") == "receipt":
        return render_receipt_html(
            invoice_data,
            include_terms_and_conditions=include_terms_and_conditions,
            include_preview_ids=include_preview_ids,
        )

    # Extract data
    customer = invoice_data.get("customer_info", {})
    consignee = invoice_data.get("consignee_info", {})
    invoice = invoice_data.get("invoice_info", {})
    items = invoice_data.get("items", [])
    payment = invoice_data.get("payment_info", {})
    charges = invoice_data.get("charges", {})
    document_type = invoice_data.get("document_type", "invoice")
    settings = get_document_settings(invoice_data)
    exchange_mode = bool(settings.get("exchange_mode"))
    show_making_percent = bool(settings.get("show_making_percent", True))
    is_duplicate = str(invoice.get("copy_type", "")).strip().lower() == "duplicate"

    # Derive display labels based on document type
    is_receipt = document_type == "receipt"
    doc_title = "TAX RECEIPT" if is_receipt else "TAX INVOICE"
    doc_no_label = "RECEIPT NO" if is_receipt else "INVOICE NO"

    # Read SVG assets for header and PDF-only terms page
    logo_svg, name_svg, bis_logo_svg, terms_svg, _receipt_terms_svg, footer_svg, company_address_svg = load_svg_assets()

    # Calculate totals
    total_gross_weight = 0.0
    total_net_weight = 0.0
    total_amount = 0.0
    total_others = 0.0
    total_diamond_or_stone_weight = 0.0
    total_diamond_or_stone_amount = 0.0
    total_making_charges = 0.0
    total_gold_silver_amount = 0.0
    total_quantity = 0
    for item in items:
        category = classify_hsn_code(item.get("hsn"))
        gross_wt = float(item.get("gross_weight", 0))
        net_wt = float(item.get("net_weight", 0))
        other_charges = float(item.get("other_charges", 0))
        diamond_or_stone_wt = float(item.get("diamond_or_stone_weight", 0))
        diamond_or_stone_amt = float(item.get("diamond_or_stone_amount", 0))
        making_charges = 0.0 if category in {"stone", "imitation"} else float(item.get("making_charges", 0))
        gold_silver_amt = float(item.get("gold_silver_amount", 0))

        # A negotiated total is tax-inclusive and must be reversed using this
        # line's HSN rate, rather than a single invoice-wide rate.
        item_total = resolve_item_total(item)
        item["amount"] = item_total  # Update the item's amount field

        qty = (
            int(item.get("quantity", 0))
            if str(item.get("quantity", 0)).isdigit()
            else 0
        )

        total_gross_weight += gross_wt
        total_net_weight += net_wt
        total_amount += item_total
        total_others += other_charges
        total_diamond_or_stone_weight += diamond_or_stone_wt
        total_diamond_or_stone_amount += diamond_or_stone_amt
        total_making_charges += making_charges
        total_quantity += qty
        total_gold_silver_amount += gold_silver_amt

    # Calculate tax and final amounts
    discount_amount = float(payment.get("discount", 0))
    taxable_amount = max(total_amount - discount_amount, 0)
    # Determine tax type based on Place of Supply
    pos_gst_code = str(customer.get("place_of_supply_gst_code", "19")).strip()
    is_igst = pos_gst_code != "" and pos_gst_code != "19"

    gst_groups = tax_groups(items, discount_amount, is_igst=is_igst)
    if is_igst:
        igst_amount = sum(group["igst"] for group in gst_groups)
        total_tax = igst_amount
    else:
        sgst_amount = sum(group["sgst"] for group in gst_groups)
        cgst_amount = sum(group["cgst"] for group in gst_groups)
        total_tax = sgst_amount + cgst_amount

    old_gold_value = float(payment.get("old_gold_advance", 0))

    total_before_old_gold = taxable_amount + total_tax

    import math

    decimal_part = total_before_old_gold - math.floor(total_before_old_gold)
    if decimal_part >= 0.50:
        rounded_total = math.ceil(total_before_old_gold)
    else:
        rounded_total = math.floor(total_before_old_gold)

    round_off_display = round(rounded_total - total_before_old_gold, 2)
    net_amount = max(rounded_total - old_gold_value, 0)

    amount_received = float(payment.get("amount_received", 0))
    balance = max(round(net_amount - amount_received, 2), 0)
    if balance == 0:
        balance = 0.0  # Normalize -0.0 to 0.0
    # Convert amounts to words
    amount_in_words = nil_safe_amount_words(net_amount)

    # A single rate keeps the familiar two-line intra-state breakup. With
    # multiple rates each row represents that rate's combined CGST + SGST.
    if is_igst:
        tax_rows_html = "".join(
            f'''                        <tr>
                            <td style="border: none; border-bottom: 1px solid #ddd; text-align: right; padding: 4px 6px; font-weight: bold;">IGST {group["rate"]:g}%</td>
                            <td style="border: none; border-bottom: 1px solid #ddd; text-align: right; padding: 4px 6px;">{format_amount(group["igst"])}</td>
                        </tr>'''
            for group in gst_groups
        )
    elif len(gst_groups) == 1:
        group = gst_groups[0] if gst_groups else {"rate": 3.0, "sgst": 0.0, "cgst": 0.0}
        component_rate = group["rate"] / 2
        tax_rows_html = f"""                        <tr>
                            <td style="border: none; border-bottom: 1px solid #ddd; text-align: right; padding: 4px 6px; font-weight: bold;">SGST {component_rate:g}%</td>
                            <td style="border: none; border-bottom: 1px solid #ddd; text-align: right; padding: 4px 6px;">{format_amount(group["sgst"])}</td>
                        </tr>
                        <tr>
                            <td style="border: none; border-bottom: 1px solid #ddd; text-align: right; padding: 4px 6px; font-weight: bold;">CGST {component_rate:g}%</td>
                            <td style="border: none; border-bottom: 1px solid #ddd; text-align: right; padding: 4px 6px;">{format_amount(group["cgst"])}</td>
                        </tr>"""
    else:
        tax_rows_html = "".join(
            f'''                        <tr>
                            <td style="border: none; border-bottom: 1px solid #ddd; text-align: right; padding: 4px 6px; font-weight: bold;">SGST {group["rate"] / 2:g}% + CGST {group["rate"] / 2:g}%</td>
                            <td style="border: none; border-bottom: 1px solid #ddd; text-align: right; padding: 4px 6px;">{format_amount(group["sgst"] + group["cgst"])}</td>
                        </tr>'''
            for group in gst_groups
        )

    # Generate watermark text pattern (repeating horizontal text) – light yellow
    _wm_text = "RAKSHIT &amp; CO. JOHUREE"
    watermark_lines_html = ""
    _sep = "&nbsp;&nbsp;&nbsp;&nbsp;"
    for _i in range(80):
        _repeated = (_wm_text + _sep) * 12
        watermark_lines_html += (
            f'            <div class="watermark-text-line">{_repeated}</div>\n'
        )

    # Split items into pages of max 3 items each
    items_per_page = max(int(float(settings.get("invoice_item_limit", 3) or 3)), 1)
    page_chunks = []
    if len(items) == 0:
        page_chunks = [[]]
    else:
        for i in range(0, len(items), items_per_page):
            page_chunks.append(items[i:i + items_per_page])
    total_pages = len(page_chunks)

    # Generate HTML
    html_content: str = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tax Invoice - {invoice.get('invoice_no', '')}</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: Arial, sans-serif;
            font-size: 10px;
            line-height: 1.35;
            padding: 0;
            background: #fff;
            color: #000;
        }}

        @page {{
            size: A4;
            margin: 0;
        }}

        @media print {{
            body {{
                padding: 0;
                background: #fff;
            }}
            .invoice-container {{
                margin: 0;
                box-shadow: none;
            }}
            .items-table > thead > tr:nth-child(2) > th {{
                border-top: none;
            }}
        }}
        
        .invoice-container {{
            width: 100%;
            max-width: 200mm;
            height: calc(297mm - 6mm);
            max-height: calc(297mm - 6mm);
            margin: 0 auto;
            background: white;
            border: 1px solid #000;
            padding: 0;
            position: relative;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }}

        .invoice-page-shell {{
            width: 210mm;
            height: 297mm;
            max-height: 297mm;
            margin: 0 auto;
            padding: 3mm;
            background: #fff;
            overflow: hidden;
        }}

        .terms-page {{
            width: 210mm;
            height: 297mm;
            margin: 0 auto;
            overflow: hidden;
            background: #fff;
            page-break-after: always;
            break-after: page;
            display: flex;
            align-items: stretch;
            justify-content: stretch;
        }}

        .terms-page svg,
        .terms-page img {{
            width: 210mm;
            height: 297mm;
            display: block;
            flex: 1 1 auto;
        }}

        .footer-strip-svg svg {{
            width: 100%;
            height: auto;
            display: block;
        }}
        
        /* Header with logo and company info */
        .header {{
            border-bottom: none;
            padding: 10px 14px 4px;
            position: relative;
            background: white;
        }}
        
        .header-top {{
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            padding: 3px 0;
        }}
        
        .logo-section {{
            flex: 0 0 100px;
        }}
        
        .logo-section svg {{
            width: 80px;
            height: auto;
        }}
        
        .company-name {{
            text-align: center;
            flex: 1;
            padding: 0 8px;
        }}
        
        .company-name .name-svg {{
            display: block;
            margin: 0 auto 3px;
        }}
        
        .company-name .name-svg svg {{
            width: 100%;
            max-width: 440px;
            height: auto;
        }}
        
        .company-address {{
            font-size: 9px;
            text-align: center;
            line-height: 1.25;
        }}
        
        .company-address svg {{
            width: 100%;
            max-width: 380px;
            height: auto;
            margin: 0 auto;
        }}
        
        .certification-badges {{
            flex: 0 0 120px;
            text-align: right;
        }}
        
        .certification-badges .bis-svg {{
            display: inline-block;
        }}
        
        .certification-badges .bis-svg svg {{
            width: 100px;
            height: auto;
        }}
        
        .original-label {{
            font-size: 9px;
            font-weight: bold;
            margin-bottom: 3px;
        }}
        
        .gstin-line {{
            font-weight: bold;
            padding: 3px 0;
        }}
        
        /* Invoice Title and Details */
        .invoice-title {{
            text-align: center;
            font-size: 11px;
            font-weight: bold;
            padding: 4px;
            border-top: 1px solid #000;
            border-bottom: 1px solid #000;
        }}
        
        .invoice-details {{
            display: flex;
            border-bottom: 1px solid #000;
        }}
        
        .invoice-left {{
            flex: 1;
            padding: 8px;
            border-right: 1px solid #000;
        }}
        
        .invoice-right {{
            flex: 1;
            padding: 8px;
        }}
        
        .detail-row {{
            display: flex;
            margin-bottom: 4px;
        }}
        
        .detail-label {{
            font-weight: bold;
            width: 130px;
        }}
        
        .detail-value {{
            flex: 1;
        }}
        
        /* Customer Details */
        .customer-section {{
            padding: 8px 10px;
            border-bottom: 1px solid #000;
        }}
        
        .customer-title {{
            font-weight: bold;
            margin-bottom: 4px;
            font-size: 10px;
        }}
        
        .customer-name {{
            font-weight: bold;
            font-size: 11px;
            margin-bottom: 3px;
        }}

        /* Items Table */
        .items-table {{
            width: 100%;
            margin: 0;
            table-layout: fixed;
            font-weight: bold;
        }}

        table {{
            width: 100%;
            border-collapse: collapse;
        }}
        
        table th {{
            background: rgba(242, 242, 242, 0.25);
            border-left: 1px solid #000;
            border-right: 1px solid #000;
            border-top: 1px solid #000;
            border-bottom: 1px solid #000;
            padding: 4px 2px;
            text-align: center;
            font-size: 9px;
            font-weight: bold;
        }}
        
        table td {{
            border-left: 1px solid #000;
            border-right: 1px solid #000;
            border-top: none;
            border-bottom: none;
            padding: 3px 3px;
            font-size: 11px;
        }}
        
        .items-table > tbody > tr:not(.total-row) > td {{
            vertical-align: top;
        }}
        
        .items-table > thead > tr > th:first-child,
        .items-table > tbody > tr > td:first-child {{
            border-left: none;
        }}
        .items-table > thead > tr > th:last-child,
        .items-table > tbody > tr > td:last-child {{
            border-right: none;
        }}
        
        .text-center {{
            text-align: center;
        }}
        
        .text-right {{
            text-align: right;
        }}
        
        .total-row {{
            font-weight: bold;
            background: rgba(242, 242, 242, 0.25);
            height: 1px;
        }}
        
        .total-row td {{
            border-top: 1px solid #000 !important;
            border-bottom: 1px solid #000 !important;
        }}
        
        .item-description {{
            font-size: 11px;
            line-height: 1.25;
            word-break: break-all;
            overflow-wrap: break-word;
        }}
        
        /* Amount in Words */
        .amount-words {{
            padding: 4px 8px;
            border-bottom: 1px solid #000;
            font-weight: bold;
            font-style: italic;
            flex-shrink: 0;
        }}
        
        /* Payment Section */
        .payment-section {{
            padding: 12px 8px;
            border-bottom: 1px solid #000;
        }}
        
        .payment-table {{
            margin-left: 0px;
        }}
        
        .payment-table td {{
            padding: 3px 7px;
        }}
        
        /* Footer */
        .footer {{
            padding: 8px;
            font-size: 8px;
        }}
        
        .narration {{
            margin-bottom: 10px;
        }}
        
        .footer-note {{
            text-align: center;
            font-weight: bold;
            margin-top: 10px;
            padding: 5px;
            background: #f0f0f0;
        }}
        
        .no-border {{
            border: none !important;
        }}
        
        .colspan-header {{
            background: rgba(224, 224, 224, 0.25);
            text-align: center;
            font-weight: bold;
        }}
        
        /* Watermark: centered logo */
        .watermark-logo {{
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 2;
            pointer-events: none;
            opacity: 0.125;
        }}
        
        .watermark-logo svg {{
            width: 350px;
            height: auto;
        }}
        
        /* Invoice body wrapper for scoped watermark */
        .invoice-body-watermark {{
            position: relative;
            overflow: hidden;
            flex: 1;
            display: flex;
            flex-direction: column;
        }}
        
        /* Ensure all content sits above the watermark */
        .invoice-body-watermark > *:not(.watermark-text):not(.watermark-logo) {{
            position: relative;
            z-index: 3;
        }}
        
        /* Items table wrapper grows to fill remaining page space */
        .items-table-wrapper {{
            flex: 1;
            display: flex;
            flex-direction: column;
            min-height: 0;
        }}
        
        .items-table-wrapper .items-table {{
            flex: 1;
            margin-bottom: 12px;
        }}
        

        
        /* Watermark: repeating horizontal text light yellow */
        .watermark-text {{
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 1;
            pointer-events: none;
            overflow: hidden;
        }}
        
        .watermark-text-line {{
            white-space: nowrap;
            font-size: 9px;
            font-weight: 700;
            font-family: Arial, Helvetica, sans-serif;
            color: rgba(210, 190, 50, 0.35);
            letter-spacing: 0.5px   ;
            line-height: 14px;
            overflow: hidden;
        }}
        
        @media print {{
            .watermark-logo,
            .watermark-text {{
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }}
            .page-break {{
                page-break-after: always;
            }}
        }}
        
        .page-break {{
            page-break-after: always;
        }}
        
        .page-indicator {{
            font-size: 8px;
            font-weight: bold;
            margin-top: 2px;
        }}

        /* ── Duplicate / Ink-saving mode ────────────── */
        body.duplicate-mode .watermark-logo {{
            display: none !important;
        }}
        body.duplicate-mode .watermark-text {{
            display: none !important;
        }}
        body.duplicate-mode .invoice-container,
        body.duplicate-mode .invoice-page-shell,
        body.duplicate-mode .terms-page {{
            -webkit-filter: grayscale(100%);
            filter: grayscale(100%);
        }}
        body.duplicate-mode .logo-section svg {{
            -webkit-filter: grayscale(100%);
            filter: grayscale(100%);
        }}
        body.duplicate-mode .watermark-text-line {{
            color: transparent !important;
        }}
        @media print {{
            body.duplicate-mode .watermark-logo,
            body.duplicate-mode .watermark-text {{
                display: none !important;
            }}
            body.duplicate-mode .invoice-container,
            body.duplicate-mode .invoice-page-shell,
            body.duplicate-mode .terms-page {{
                -webkit-filter: grayscale(100%) !important;
                filter: grayscale(100%) !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }}
        }}
    </style>
</head>
<body{' class="duplicate-mode"' if is_duplicate else ''}>
"""

    # --- Generate each page ---
    for page_idx, page_items in enumerate(page_chunks):
        is_last_page = (page_idx == total_pages - 1)
        page_label = f"Page {page_idx + 1} of {total_pages}" if total_pages > 1 else ""
        needs_invoice_page_break = include_terms_and_conditions or not is_last_page
        page_break_class = ' class="page-break"' if needs_invoice_page_break else ''

        # Determine the starting serial number for items on this page
        page_start_serial = page_idx * items_per_page + 1

        html_content += f"""
    <div{page_break_class}>
    <div class="invoice-page-shell">
    <div class="invoice-container" id="preview-page-{page_idx + 1}" data-preview-page="{page_idx + 1}">
        <!-- Watermark: Centered Logo -->
        <div class="watermark-logo">
            {logo_svg}
        </div>
        <!-- Header -->
        <div class="header">
            <div class="header-top">
                <div class="logo-section">
                    {logo_svg}
                    <div class="gstin-line">
                        GSTIN : 19AADFR8171Q1ZC
                    </div>
                </div>
                <div class="company-name">
                    <div class="original-label">{invoice.get('copy_type', 'Original for Buyer')}</div>
                    <div class="name-svg">{name_svg}</div>
                    <div class="company-address">
                        {company_address_svg}
                    </div>
                </div>
                <div class="certification-badges">
                    <div class="bis-svg">{bis_logo_svg}</div>
                    {f'<div class="page-indicator">{page_label}</div>' if page_label else ''}
                </div>
            </div>
        </div>
        
        <!-- Invoice body wrapper with watermark -->
        <div class="invoice-body-watermark">
        <!-- Watermark: Repeating Text Pattern -->
        <div class="watermark-text">
{watermark_lines_html}        </div>
        
        <!-- Invoice Title -->
        <div class="invoice-title" {'id="preview-top"' if include_preview_ids and page_idx == 0 else ''}>{doc_title}</div>
        
        <!-- Invoice Details - 3 Column Layout -->
        <div style="display: flex; border-bottom: 1px solid #000; padding: 10px;">
            <div style="flex: 1;">
                <div style="margin-bottom: 3px;">
                    <strong>{doc_no_label} :</strong> {invoice.get('invoice_no', '')}
                </div>
                {f'''<div><strong>LINKED RECEIPT NO :</strong> {invoice.get('linked_receipt_no', '')}</div>''' if exchange_mode and invoice.get('linked_receipt_no', '') else ''}
            </div>
            
            <!-- Column 2: Order Details -->
            <div style="flex: 1;">
                <div style="margin-bottom: 3px;">
                    <strong>LINKED ORDER NO :</strong> {invoice.get('order_no', '')}
                </div>
                <div>
                    <strong>ORDER DATE & TIME :</strong> {invoice.get('order_date', '')}
                </div>
            </div>
            
            <!-- Column 3: Invoice Details -->
            <div style="flex: 1;">
                <div>
                    <strong>DATE & TIME :</strong> {invoice.get('invoice_date', datetime.now().strftime('%d/%m/%Y %H:%M:%S'))}
                </div>
            </div>
        </div>
        
        <!-- Customer & Consignee Details - Two Column -->
        <div style="display: flex; border-bottom: 1px solid #000;" {'id="preview-customer"' if include_preview_ids and page_idx == 0 else ''}>
            <!-- Left: Billed To -->
            <div style="flex: 1; padding: 8px 10px; border-right: 1px solid #000;">
                <div class="customer-title">Details of Receiver (Billed To) :</div>
                <div class="customer-name">{customer.get('name', '').upper()}</div>
                <div>{customer.get('address', '')}</div>
                <div>{contact_email_line(customer)}</div>
                <div>STATE NAME: {customer.get('state_name', '')}{', CODE: ' + customer.get('state_gst_code', '') if customer.get('state_gst_code') else ''}</div>
                <div>PINCODE: {customer.get('pincode', '')}</div>
                <div>PAN / AADHAAR NO: {customer.get('pan_aadhaar', '')}</div>
                <div>PLACE OF SUPPLY: {customer.get('place_of_supply_name', '')}{', CODE: ' + customer.get('place_of_supply_gst_code', '') if customer.get('place_of_supply_gst_code') else ''}</div>
            </div>
            <!-- Right: Shipped To -->
            <div style="flex: 1; padding: 8px 10px;">
                <div class="customer-title">Details of Consignee (Shipped To) :</div>
                <div class="customer-name">{consignee.get('name', '').upper()}</div>
                <div>{consignee.get('address', '')}</div>
                <div>{contact_email_line(consignee)}</div>
                <div>STATE NAME: {consignee.get('state_name', '')}{', CODE: ' + consignee.get('state_gst_code', '') if consignee.get('state_gst_code') else ''}</div>
                <div>PINCODE: {consignee.get('pincode', '')}</div>
                <div>PAN / AADHAAR NO: {consignee.get('pan_aadhaar', '')}</div>
            </div>
        </div>
        
        <!-- Items Table -->
        <div class="items-table-wrapper" {'id="preview-items-page-' + str(page_idx + 1) + '"' if include_preview_ids else ''}>
        <table class="items-table">
            <colgroup>
                <col style="width: 2%;">   <!-- S L N O -->
                <col style="width: 16%;">  <!-- DESCRIPTION -->
                <col style="width: 2%;">   <!-- Qty -->
                <col style="width: 7%;">   <!-- HSN -->
                <col style="width: 3%;">   <!-- Purity -->
                <col style="width: 7%;">   <!-- Gross Weight -->
                <col style="width: 7%;">   <!-- Net Weight -->
                <col style="width: 10%;">  <!-- Gold/Silver Amount -->
                <col style="width: 7%;">   <!-- Diamond / Stone Weight -->
                <col style="width: 10%;">   <!-- Diamond / Stone Amount -->
                <col style="width: 7%;">   <!-- H.M Chg -->
                <col style="width: 10%;">  <!-- Making Charges -->
                <col style="width: 12%;">   <!-- TOTAL AMOUNT -->
            </colgroup>
            <thead>
                <tr>
                    <th rowspan="2" style="width: 2%;">S<br>L<br>N<br>O</th>
                    <th rowspan="2" style="width: 18%;">DESCRIPTION</th>
                    <th rowspan="2" style="width: 2%;">Q<br>t<br>y</th>
                    <th rowspan="2" style="width: 7%;">HSN</th>
                    <th rowspan="2" style="width: 3%;">P<br>u<br>r<br>i<br>t<br>y</th>
                    <th colspan="3" class="colspan-header">GOLD / SILVER</th>
                    <th colspan="2" class="colspan-header">DIAMOND / STONE</th>
                    <th colspan="2" class="colspan-header">OTHERS</th>
                    <th rowspan="2" style="width: 12%;">TOTAL<br>AMOUNT<br>(Rs.)</th>
                </tr>
                <tr>
                    <!-- GOLD / SILVER -->
                    <th style="width: 6%;">Gross<br>Weight<br>(g)</th>
                    <th style="width: 6%;">Net<br>Weight<br>(g)</th>
                    <th style="width: 10%;">Amount<br>(Rs.)</th>
                    <!-- DIAMOND / STONE -->
                    <th style="width: 7%;">Weight<br>(Cts./g)</th>
                    <th style="width: 10%;">Amount<br>(Rs.)</th>
                    <!-- OTHERS -->
                    <th style="width: 7%;">H.M Chg &<br>Misc.<br>(Rs.)</th>
                    <th style="width: 10%;">Making<br>Charges<br>(Rs.)</th>
                </tr>
            </thead>
            <tbody>
"""

        # Add item rows for this page
        for local_idx, item in enumerate(page_items):
            idx = page_start_serial + local_idx  # Global serial number
            # Build description: description, stock_no, HUID (if any)
            description_text = item.get("description", "")
            stock_no = item.get("stock_no", "")
            huid = item.get("HUID", None)
            inline_parts = []
            if stock_no:
                inline_parts.append(stock_no)
            if huid:
                inline_parts.append(huid)
            description_html = description_text
            if inline_parts:
                description_html += "<br>" + "<br>".join(inline_parts)

            category = classify_hsn_code(item.get("hsn"))

            # Build making charges: amount + percent on next line
            making_charges_html = format_amount(0 if category in {"stone", "imitation"} else item.get("making_charges", 0))
            making_pct = item.get("making_charges_percent", "")
            item_show_making_percent = to_bool(item.get("show_making_percent"), show_making_percent)
            if making_pct and item_show_making_percent and category not in {"silver", "stone", "imitation"}:
                making_charges_html += f"<br>({making_pct}%)"

            html_content += f"""                <tr>
                    <td class="text-center">{idx}</td>
                    <td class="item-description">{description_html}</td>
                    <td class="text-center">{item.get('quantity', '')}</td>
                    <td class="text-center">{item.get('hsn', '')}</td>
                    <td class="text-center">{item.get('purity', '')}</td>
                    <td class="text-right">{format_weight(item.get('gross_weight', 0))}</td>
                    <td class="text-right">{format_weight(item.get('net_weight', 0))}</td>
                    <td class="text-right">{format_amount(item.get('gold_silver_amount', 0))}</td>
                                        <td class="text-right">{format_weight(item.get('diamond_or_stone_weight', 0))}</td>
                    <td class="text-right">{format_amount(item.get('diamond_or_stone_amount', 0))}</td>
                    <td class="text-right">{format_amount(item.get('other_charges', 0))}</td>
                    <td class="text-right">{making_charges_html}</td>
                    <td class="text-right">{format_amount(item.get('amount', 0))}</td>
                </tr>
"""



        # Add total row — only show values on last page
        if is_last_page:
            html_content += f"""                <tr class="total-row">
                    <td></td>
                    <td class="text-center">TOTAL</td>
                    <td class="text-center">{total_quantity}</td>
                    <td></td>
                    <td></td>
                    <td class="text-center">{format_weight(total_gross_weight)}</td>
                    <td class="text-center">{format_weight(total_net_weight)}</td>
                    <td class="text-center">{format_amount(total_gold_silver_amount)}</td>
                                        <td class="text-center">{format_weight(total_diamond_or_stone_weight)}</td>
                    <td class="text-center">{format_amount(total_diamond_or_stone_amount)}</td>
                    <td class="text-center">{format_amount(total_others)}</td>
                    <td class="text-center">{format_amount(total_making_charges)}</td>
                    <td class="text-center">{format_amount(total_amount)}</td>
                </tr>
"""
        else:
            html_content += """                <tr class="total-row">
                    <td></td>
                    <td class="text-center">TOTAL</td>
                    <td class="text-center">-</td>
                    <td></td>
                    <td></td>
                    <td class="text-center">-</td>
                    <td class="text-center">-</td>
                    <td class="text-center">-</td>
                    <td class="text-center">-</td>
                    <td class="text-center">-</td>
                    <td class="text-center">-</td>
                    <td class="text-center">-</td>
                    <td class="text-center">-</td>
                </tr>
"""

        html_content += f"""            </tbody>
        </table>
        
        <!-- Amount in Words -->
        <div class="amount-words">
            {'Rs. ' + amount_in_words if amount_in_words != 'NIL' else 'NIL'}
        </div>
        </div><!-- end items-table-wrapper -->
        </div><!-- end invoice-body-watermark -->
        
        <!-- Payment and Footer Section - Compact Layout -->
        <div style="padding: 0;" {'id="preview-payment"' if include_preview_ids and is_last_page else ''}>
            <!-- Payment Details Section with Border -->
            <div style="display: flex; gap: 0; border-bottom: 1px solid #000; border-top: none;">
                <!-- Left side: Payment mode labels and values -->
                <div style="flex: 1; border-right: 1px solid #000; display: flex; flex-direction: column;">
                    <div style="padding: 0 6px 4px; flex: 1;">
                        <table style="border-collapse: collapse; font-size: 9px; width: 100%;">
                            <tr>
                                <td style="border: none; padding: 4px 6px; font-weight: bold; width: 25%;">MODE OF PAYMENT</td>
                                <td style="border: none; padding: 4px 6px; font-weight: bold; width: 25%;">BANK NAME</td>
                                <td style="border: none; padding: 4px 6px; font-weight: bold; width: 25%;">CARD/ACC NO.</td>
                                <td style="border: none; padding: 4px 6px; font-weight: bold; width: 25%; text-align: right;">AMOUNT</td>
                            </tr>
                            <tr>
                                <td style="border: none; padding: 4px 6px;">CASH</td>
                                <td style="border: none; padding: 4px 6px;">-</td>
                                <td style="border: none; padding: 4px 6px;">-</td>
                                <td style="border: none; padding: 4px 6px; text-align: right;">{format_amount(payment.get('cash_amount', 0))}</td>
                            </tr>
                            <tr>
                                <td style="border: none; padding: 4px 6px;">UPI</td>
                                <td style="border: none; padding: 4px 6px;">-</td>
                                <td style="border: none; padding: 4px 6px;">-</td>
                                <td style="border: none; padding: 4px 6px; text-align: right;">{format_amount(payment.get('upi_amount', 0))}</td>
                            </tr>
                            <tr>
                                <td style="border: none; padding: 4px 6px;">CARD</td>
                                <td style="border: none; padding: 4px 6px;">{payment.get('card_name', '')}</td>
                                <td style="border: none; padding: 4px 6px;">{payment.get('card_number', '')}</td>
                                <td style="border: none; padding: 4px 6px; text-align: right;">{format_amount(payment.get('card_amount', 0))}</td>
                            </tr>
                            <tr>
                                <td style="border: none; padding: 4px 6px;">BANK</td>
                                <td style="border: none; padding: 4px 6px;">{payment.get('bank_name', 'N/A') if payment.get('bank_amount', 0) > 0 else '-'}</td>
                                <td style="border: none; padding: 4px 6px;">{payment.get('account_number', '-') if payment.get('bank_amount', 0) > 0 else '-'}</td>
                                <td style="border: none; padding: 4px 6px; text-align: right;">{format_amount(payment.get('bank_amount', 0))}</td>
                            </tr>
                        </table>
                    </div>
                    {f'''<div style="padding: 5px 12px; display: flex; align-items: flex-start; font-size: 9px; box-sizing: border-box;">
                        <strong style="min-width: 25%; flex-shrink: 0;">Remarks</strong>
                        <span style="font-style: italic; flex: 1; word-break: break-word; overflow-wrap: break-word;">{payment.get('remarks', '')}</span>
                    </div>''' if payment.get('remarks', '').strip() else ''}
                </div>
                
                <!-- Right side: Financial Summary -->
                <div style="display: flex; flex-direction: column;">
                    <!-- Financial Summary Rows -->
                    <table style="border-collapse: collapse; font-size: 9px;">
                        <tr>
                            <td style="border: none; border-bottom: 1px solid #ddd; text-align: right; padding: 4px 6px; font-weight: bold;">DISCOUNT</td>
                            <td style="border: none; border-bottom: 1px solid #ddd; text-align: right; padding: 4px 6px;">{format_amount(discount_amount)}</td>
                        </tr>
                        <tr>
                            <td style="border: none; border-bottom: 1px solid #ddd; text-align: right; padding: 4px 6px; font-weight: bold; white-space: nowrap;">TAXABLE AMOUNT</td>
                            <td style="border: none; border-bottom: 1px solid #ddd; text-align: right; padding: 4px 6px; min-width: 100px; font-weight: bold;">{format_amount(taxable_amount)}</td>
                        </tr>
{tax_rows_html}
                        <tr>
                            <td style="border: none; border-bottom: 1px solid #ddd; text-align: right; padding: 4px 6px; font-weight: bold; background: #f0f0f0;">TOTAL</td>
                            <td style="border: none; border-bottom: 1px solid #ddd; text-align: right; padding: 4px 6px; font-weight: bold; background: #f0f0f0;">{format_amount(total_before_old_gold)}</td>
                        </tr>
                        <tr>
                            <td style="border: none; border-bottom: 1px solid #ddd; text-align: right; padding: 4px 6px; font-weight: bold;">ROUND OFF</td>
                            <td style="border: none; border-bottom: 1px solid #ddd; text-align: right; padding: 4px 6px;">{'+'  if round_off_display >= 0 else ''}{format_amount(round_off_display)}</td>
                        </tr>
                        <tr>
                            <td style="border: none; border-bottom: 1px solid #ddd; text-align: right; padding: 4px 6px; font-weight: bold; white-space: nowrap;">LESS OLD GOLD + ADVANCE</td>
                            <td style="border: none; border-bottom: 1px solid #ddd; text-align: right; padding: 4px 6px; background: #ffe0e0;">{format_amount(old_gold_value)}</td>
                        </tr>
                        <tr>
                            <td style="border: none; text-align: right; padding: 4px 6px; font-weight: bold;">NET AMOUNT</td>
                            <td style="border: none; text-align: right; padding: 6px; font-weight: bold; font-size: 13px; background: #e8f4f8;">{format_amount_or_dash(net_amount)}</td>
                        </tr>
                    </table>
                    <div style="display: flex; border-top: 1px solid #000; height: 38px; box-sizing: border-box;">
                        <div style="padding: 5px 8px; font-weight: bold; text-align: center; border-right: 1px solid #000; min-width: 110px;">
                            <div style="font-size: 9px; margin-bottom: 2px;">AMOUNT RECEIVED</div>
                            <div style="font-size: 13px;">{format_amount(amount_received)}</div>
                        </div>
                        <div style="padding: 5px 8px; font-weight: bold; text-align: center; min-width: 110px;">
                            <div style="font-size: 9px; margin-bottom: 2px;">BALANCE AMOUNT</div>
                            <div style="font-size: 13px;">{format_amount(balance)}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Narration and Footer Section - Restructured -->
        <div style="padding: 6px 14px 6px;">
            <div style="display: flex; justify-content: space-between; font-size: 10px;">
                <div><strong>Narration :</strong> {payment.get('narration', '')}</div>
                <div style="text-align: right;">
                    <div style="font-weight: bold; margin-bottom: 2px;">FOR RAKSHIT & CO. JOHUREE</div>
                </div>
            </div>
            
            <div style="height: 28px;"></div>
            
            <div style="font-size: 9px; margin-bottom: 8px;">
                I agree that this Transaction took place as mutually agreed upon specific "Terms and Conditions" furnished overleaf.
            </div>
            
            <div style="font-size: 10px; text-align: center; margin-bottom: 8px;">
                <strong>All jewellery items are breakable, please handle with care.</strong>
            </div>
        </div>

        <div style="margin: 0; padding: 6px 0; font-size: 11px; text-align: center; font-weight: bold; background: #f9f9f9; border-top: 1px solid #000;">
            <div class="footer-strip-svg">{footer_svg}</div>
        </div>
    </div>
    </div>
    </div><!-- end page-break wrapper -->
"""

        if include_terms_and_conditions:
            terms_break_class = ' class="page-break"' if page_idx != total_pages - 1 else ""
            html_content += f"""
    <div{terms_break_class}>
    <div class="terms-page" aria-label="Terms and Conditions page {page_idx + 1}">
        {terms_svg}
    </div>
    </div><!-- end terms page wrapper -->
"""
    # End of per-page loop

    html_content += """
</body>
</html>"""

    return html_content


def save_invoice_html(invoice_data: dict[str, Any], html_content: str | None = None) -> str:
    """Persist invoice HTML to disk and return the saved path."""
    invoice = invoice_data.get("invoice_info", {})
    output_dir = invoice_data.get("output_dir", "generated_bills")
    os.makedirs(output_dir, exist_ok=True)

    invoice_no = invoice.get("invoice_no", "INVOICE").replace("/", "_")
    output_path = os.path.join(output_dir, f"{invoice_no}.html")

    if html_content is None:
        html_content = render_invoice_html(invoice_data)

    Path(output_path).write_text(html_content, encoding="utf-8")

    return output_path


def find_chrome_binary() -> str:
    """Return the local Chrome/Chromium executable used for PDF generation."""
    candidates = [
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/microsoft-edge",
    ]
    for candidate in candidates:
        if os.path.exists(candidate):
            return candidate
    raise FileNotFoundError(
        "Could not find a Chrome/Chromium browser executable for PDF generation."
    )


@lru_cache(maxsize=1)
def load_svg_assets() -> tuple[str, str, str, str, str, str, str]:
    """Load static SVG assets once to reduce preview/render overhead."""
    assets_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
    try:
        logo_svg = Path(os.path.join(assets_dir, "logo.svg")).read_text(encoding="utf-8")
    except FileNotFoundError:
        logo_svg = '<svg width="110" height="65"><rect width="110" height="65" fill="#c0c0c0"/><text x="55" y="35" text-anchor="middle" font-size="13" font-weight="bold">LOGO</text></svg>'
    try:
        name_svg = Path(os.path.join(assets_dir, "name.svg")).read_text(encoding="utf-8")
    except FileNotFoundError:
        name_svg = ""
    try:
        bis_logo_svg = Path(os.path.join(assets_dir, "bis_logo.svg")).read_text(encoding="utf-8")
    except FileNotFoundError:
        bis_logo_svg = ""
    try:
        invoice_terms_svg = Path(os.path.join(assets_dir, "terms_and_conditions_invoice.svg")).read_text(encoding="utf-8")
    except FileNotFoundError:
        invoice_terms_svg = ""
    try:
        receipt_terms_svg = Path(os.path.join(assets_dir, "terms_and_conditions_receipt.svg")).read_text(encoding="utf-8")
    except FileNotFoundError:
        receipt_terms_svg = ""
    try:
        footer_svg = Path(os.path.join(assets_dir, "footer.svg")).read_text(encoding="utf-8")
    except FileNotFoundError:
        footer_svg = ""
    try:
        company_address_svg = Path(os.path.join(assets_dir, "company_address_and_contact.svg")).read_text(encoding="utf-8")
    except FileNotFoundError:
        company_address_svg = ""
    return logo_svg, name_svg, bis_logo_svg, invoice_terms_svg, receipt_terms_svg, footer_svg, company_address_svg


def generate_pdf_from_html_path(html_path: str, pdf_path: str | None = None) -> str:
    """Generate a PDF from the saved HTML using headless Chrome."""
    html_file = Path(html_path).resolve()
    if pdf_path is None:
        pdf_path = str(html_file.with_suffix(".pdf"))

    chrome = find_chrome_binary()
    pdf_file = Path(pdf_path).resolve()
    command_variants = [
        [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-background-networking",
            "--disable-extensions",
            "--disable-sync",
            "--metrics-recording-only",
            "--mute-audio",
            "--hide-scrollbars",
            "--no-pdf-header-footer",
            f"--print-to-pdf={pdf_file}",
            html_file.as_uri(),
        ],
        [
            chrome,
            "--headless",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-background-networking",
            "--disable-extensions",
            "--disable-sync",
            "--metrics-recording-only",
            "--mute-audio",
            "--hide-scrollbars",
            "--no-pdf-header-footer",
            f"--print-to-pdf={pdf_file}",
            html_file.as_uri(),
        ],
    ]

    errors: list[str] = []
    for command in command_variants:
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        if result.returncode == 0 and pdf_file.exists():
            return str(pdf_file)
        errors.append(
            "Command failed: "
            + " ".join(command)
            + f"\nstdout: {result.stdout}\nstderr: {result.stderr}"
        )

    raise RuntimeError("PDF generation failed with Chrome.\n" + "\n\n".join(errors))


def generate_pdf(invoice_data: dict[str, Any], pdf_path: str | None = None) -> str:
    """
    Generate a PDF directly from invoice data without leaving intermediate HTML behind.
    """
    output_dir = Path(invoice_data.get("output_dir", "generated_bills"))
    output_dir.mkdir(parents=True, exist_ok=True)

    invoice_no = invoice_data.get("invoice_info", {}).get("invoice_no", "INVOICE").replace("/", "_")
    target_pdf_path = Path(pdf_path) if pdf_path else output_dir / f"{invoice_no}.pdf"
    include_terms_and_conditions = bool(
        get_document_settings(invoice_data).get("include_terms_and_conditions", True)
    )
    html_content = render_invoice_html(
        invoice_data,
        include_terms_and_conditions=include_terms_and_conditions,
    )

    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".html",
        delete=False,
        dir=output_dir,
        encoding="utf-8",
    ) as temp_html:
        temp_html.write(html_content)
        temp_html_path = Path(temp_html.name)

    try:
        return generate_pdf_from_html_path(str(temp_html_path), str(target_pdf_path))
    finally:
        temp_html_path.unlink(missing_ok=True)


def generate_invoice(invoice_data):
    """
    Generate and save the invoice HTML file.

    Returns:
        Path to generated HTML file
    """
    html_content = render_invoice_html(invoice_data)
    return save_invoice_html(invoice_data, html_content)


# Example usage
if __name__ == "__main__":
    # Sample invoice data based on the reference image
    sample_invoice = {
        "customer_info": {
            "name": "RANDOM CUSTOMER",
            "address": "ADD: Sample Apartment, 123 Street, City, State - 123456",
            "contact": "9876543210",
            "state_name": "WEST BENGAL",
            "pincode": "123456",
            "pan_aadhaar": "ABCDE1234F / 1234 5678 9012",
            "state_code": "19-WEST BENGAL",
        },
        "invoice_info": {
            "order_no": "",
            "order_date": "",
            "invoice_no": "A012345",
            "invoice_date": "10/02/2025 16:31:69",
        },
        "items": [
            {
                "description": "JHUMKA PASSA(HLM)",
                "stock_no": "21-22/J-1",
                "HUID": "ABC123456789",  # or can be an empty string ""
                "quantity": "2",
                "hsn": "71131910",
                "purity": "22",
                "gross_weight": 9.340,
                "net_weight": 9.340,
                "gold_silver_amount": 74908.80,
                "diamond_or_stone_weight": 0.00,
                "diamond_or_stone_amount": 0.00,
                "other_charges": 100.00,
                "making_charges": 14232,
                "making_charges_percent": 18.99,
                "amount": 89239.09,
            },
            # {
            #     "description": "HAR (HLM)",
            #     "stock_no": "22-23/J-2",
            #     "HUID": "1764EM",
            #     "quantity": "1",
            #     "hsn": "71131910",
            #     "purity": "22",
            #     "gross_weight": 9.970,
            #     "net_weight": 9.970,
            #     "gold_silver_amount": 79959.40,
            #     "diamond_or_stone_weight": 0.00,
            #     "diamond_or_stone_amount": 0.00,
            #     "other_charges": 550.00,
            #     "making_charges": 15192,
            #     "making_charges_percent": 18.99,
            #     "amount": 95701.69,
            # },
            # {
            #     "description": "GOLD COLLAR(HLM.)",
            #     "stock_no": "22-23/J-3",
            #     "HUID": "QJNSSK",
            #     "quantity": "1",
            #     "hsn": "71131910",
            #     "purity": "22",
            #     "gross_weight": 3.420,
            #     "net_weight": 3.420,
            #     "gold_silver_amount": 27428.40,
            #     "diamond_or_stone_weight": 0.00,
            #     "diamond_or_stone_amount": 0.00,
            #     "other_charges": 650.00,
            #     "making_charges": 5211,
            #     "making_charges_percent": 18.99,
            #     "amount": 33289.80,
            # },
            # {
            #     "description": "RING SET(HLM)",
            #     "stock_no": "22-23/J-4dadadadadadad",
            #     "HUID": "TEST456",
            #     "quantity": "1",
            #     "hsn": "71131910",
            #     "purity": "22",
            #     "gross_weight": 5.250,
            #     "net_weight": 5.250,
            #     "gold_silver_amount": 42100.00,
            #     "diamond_or_stone_weight": 0.25,
            #     "diamond_or_stone_amount": 1500.00,
            #     "other_charges": 200.00,
            #     "making_charges": 8500,
            #     "making_charges_percent": 20.19,
            #     "amount": 42500.50,
            # },
            # {
            #     "description": "BRACELET(HLM)",
            #     "stock_no": "23-24/J-1",
            #     "HUID": "ABC123456789",
            #     "quantity": "1",
            #     "hsn": "71131910",
            #     "purity": "22",
            #     "gross_weight": 7.800,
            #     "net_weight": 7.800,
            #     "gold_silver_amount": 62400.00,
            #     "diamond_or_stone_weight": 0.00,
            #     "diamond_or_stone_amount": 0.00,
            #     "other_charges": 300.00,
            #     "making_charges": 12000,
            #     "making_charges_percent": 19.23,
            #     "amount": 62700.00,
            # },
            # {
            #     "description": "Sitahar",
            #     "stock_no": "23-24/J-2",
            #     "HUID": "ABC123456789",
            #     "quantity": "1",
            #     "hsn": "71131910",
            #     "purity": "22",
            #     "gross_weight": 7.800,
            #     "net_weight": 7.800,
            #     "gold_silver_amount": 62400.00,
            #     "diamond_or_stone_weight": 0.00,
            #     "diamond_or_stone_amount": 0.00,
            #     "other_charges": 300.00,
            #     "making_charges": 12000,
            #     "making_charges_percent": 19.23,
            #     "amount": 62700.00,
            # },
            # {
            #     "description": "Mukta Chique",
            #     "stock_no": "24-25/J-1",
            #     "HUID": "ABC123456789",
            #     "quantity": "1",
            #     "hsn": "71131910",
            #     "purity": "22",
            #     "gross_weight": 5.250,
            #     "net_weight": 5.250,
            #     "gold_silver_amount": 42100.00,
            #     "diamond_or_stone_weight": 0.25,
            #     "diamond_or_stone_amount": 1500.00,
            #     "other_charges": 200.00,
            #     "making_charges": 8500,
            #     "making_charges_percent": 20.19,
            #     "amount": 42500.50,
            # },
            # {
            #     "description": "Tie Har",
            #     "stock_no": "24-25/ET-1",
            #     "HUID": "ABC123456789",
            #     "quantity": "1",
            #     "hsn": "71131910",
            #     "purity": "22",
            #     "gross_weight": 2.500,
            #     "net_weight": 2.500,
            #     "gold_silver_amount": 20100.00,
            #     "diamond_or_stone_weight": 0.25,
            #     "diamond_or_stone_amount": 1500.00,
            #     "other_charges": 200.00,
            #     "making_charges": 8500,
            #     "making_charges_percent": 20.19,
            #     "amount": 42500.50,
            # },
            # {
            #     "description": "Necklace",
            #     "stock_no": "24-25/ET-2",
            #     "HUID": "ABC123456789",
            #     "quantity": "1",
            #     "hsn": "71131910",
            #     "purity": "22",
            #     "gross_weight": 20.870,
            #     "net_weight": 20.870,
            #     "gold_silver_amount": 167400.00,
            #     "diamond_or_stone_weight": 0.25,
            #     "diamond_or_stone_amount": 1500.00,
            #     "other_charges": 200.00,
            #     "making_charges": 8500,
            #     "making_charges_percent": 20.19,
            #     "amount": 42500.50,
            # },
            # {
            #     "description": "Diamond Studded gold Bracelet",
            #     "stock_no": "ABCD/123456/DIAMOND_1234_ABCD",
            #     "HUID": "huid_ABC123456789",
            #     "quantity": "1",
            #     "hsn": "71131910",
            #     "purity": "22",
            #     "gross_weight": 20.870,
            #     "net_weight": 20.870,
            #     "gold_silver_amount": 167400.00,
            #     "diamond_or_stone_weight": 0.25,
            #     "diamond_or_stone_amount": 1500.00,
            #     "other_charges": 200.00,
            #     "making_charges": 8500,
            #     "making_charges_percent": 20.19,
            #     "amount": 42500.50,
            # },
            # {
            #     "description": "Silver Necklace",
            #     "stock_no": "24-25/ET-2",
            #     "HUID": "ABC123456789",
            #     "quantity": "1",
            #     "hsn": "71131910",
            #     "purity": "925",
            #     "gross_weight": 20.870,
            #     "net_weight": 20.870,
            #     "gold_silver_amount": 167400.00,
            #     "diamond_or_stone_weight": 0.00,
            #     "diamond_or_stone_amount": 0.00,
            #     "other_charges": 200.00,
            #     "making_charges": 8500,
            #     "making_charges_percent": 20.19,
            #     "amount": 42500.50,
            # }
        ],
        "charges": {
            "sgst_percent": 1.50,
            "cgst_percent": 1.50,
        },
        "payment_info": {
            "cash_amount": 350000.00,
            "cheque_amount": 150000.00,
            "bank_amount": 0.00,
            "cheque_bank_name": "HDFC",
            "bank_name": "HDFC",
            "cheque_number": "XXXX1234",
            "account_number": "",
            "old_gold_advance": 400000.00,
            # "old_gold_advance": 0.00,
            "discount": 0,
            # "discount": 0.00,
            "round_off": 0,
            # "round_off": 0.00,
            "amount_received": 664847.00,
            "narration": "RANDOM CUSTOMER",
        },
        "output_dir": "generated_bills",
    }
    # sample_invoice = {}
    output_file = generate_invoice(sample_invoice)
    print(f"Invoice generated successfully: {output_file}")
