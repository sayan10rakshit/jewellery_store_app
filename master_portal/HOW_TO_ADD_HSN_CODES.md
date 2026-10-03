# How to Add / Update HSN Codes

This guide explains how to add new HSN codes for each jewellery category.
Each category has **two places** to update: the **backend** (Python) and the **frontend** (JavaScript).

---

## Overview of Files

| File | What to change |
|------|---------------|
| `master_portal/app.py` | HSN dropdown options (labels shown to the user) |
| `master_portal/static/app.js` | HSN category detection sets (determines form behaviour) |

---

## Step 1: Add the HSN to the Dropdown (Backend)

Open **`master_portal/app.py`** and find the `HSN_FIELD_OPTIONS` list (near the top of the file, around line 79).

Add a new entry in the appropriate group:

```python
HSN_FIELD_OPTIONS = [
    # ── Gold ──
    {"value": "71131910", "label": "71131910 · Plain Gold Jewellery"},
    ...
    # ── Silver ──
    {"value": "71131130", "label": "71131130 · Plain Silver Jewellery"},
    ...
    # ── Stones ──
    {"value": "71023910", "label": "71023910 · Loose Diamonds (Cut & Polished)"},
    ...
    # ── Imitation ──
    {"value": "71179010", "label": "71179010 · Studded Imitation Jewellery"},
    ...

    # ADD YOUR NEW HSN CODE HERE, in the correct group:
    {"value": "XXXXXXXX", "label": "XXXXXXXX · Description of the item"},
]
```

**Format:** `{"value": "<8-digit HSN code>", "label": "<HSN code> · <Human-readable description>"}`

---

## Step 2: Register the HSN in the Correct Category (Frontend)

Open **`master_portal/static/app.js`** and search for **`GOLD_HSN_CODES`** (around line 4897).

Add the HSN to the matching set. The portal combines the related gold, silver,
and stone-category sets automatically:

### For Gold Jewellery
```javascript
const GOLD_HSN_CODES = new Set([
    "XXXXXXXX"   // ← add your new gold HSN here
]);
```

Use `GOLD_SEMI_MANUFACTURED_CODES` for gold semi-manufactured goods and
`GOLD_ARTICLES_CODES` for gold articles. All three sets use gold behaviour.

**Effect:** The form will show gold-specific fields:
- Physical Properties: Gold purities (22K, 24K, etc.), gross/net/stone weight
- Expenses: Making Baseline, Artisan Making, Stone Expense, Other Expenses
- Cost: Making Charges %, Stone Amount, Other Charges

### For Silver Jewellery
```javascript
const SILVER_HSN_CODES = new Set([
    "XXXXXXXX"   // ← add your new silver HSN here
]);
```

Use `SILVER_SEMI_MANUFACTURED_CODES` or `SILVER_ARTICLES_CODES` where those
descriptions apply. All three sets use silver behaviour.

**Effect:** The form will show silver-specific fields:
- Physical Properties: Silver purities (925, 999, etc.), gross/net/stone weight
- Expenses: Artisan Payment %, Per Gram / Total Expense toggle, Stone Expense, Other Expenses
- Cost: Per Gram / Total Cost toggle, Stone Amount, Other Charges

### For Stones (Gems / Precious Stones)
```javascript
const STONE_HSN_CODES = new Set([
    "XXXXXXXX"   // ← add your new stone HSN here
]);
```

Use `PEARL_ARTICLES_HSN_CODES` or `PEARL_LOOSE_HSN_CODES` for pearl goods;
both use stone behaviour. Only `STONE_HSN_CODES` receives 0.125% CGST +
0.125% SGST (or 0.25% IGST). Every other listed HSN, including pearl and
imitation HSNs, uses 1.5% CGST + 1.5% SGST (or 3% IGST).

**Effect:** The form will show stone-specific fields:
- Physical Properties: Quantity + Weight toggle (Grams / Ratti)
- Expenses: Per Ratti / Total Expense toggle
- Cost: Per Ratti / Total Cost toggle
- Weight toggle auto-switches cost/expense mode (Grams → Total, Ratti → Per Ratti)

### For Imitation / Costume Jewellery
```javascript
const IMITATION_HSN_CODES = new Set([
    "71179010", "71171910", "71171920", "71179090",
    "XXXXXXXX"   // ← add your new imitation HSN here
]);
```

**Effect:** The form will show imitation-specific fields:
- Physical Properties: Quantity only (no purity, no weights)
- Expenses: Total Expense only
- Cost: Total Cost only

---

## Step 3: (Optional) Add New Purity Values

If your new HSN category needs **new purity options**, update these in **two places**:

### Backend — `master_portal/app.py`
Find `PURITY_FIELD_OPTIONS` (around line 102) and add a new entry:

```python
{"value": "NEW_PURITY", "label": "NEW_PURITY · description"},
```

### Frontend — `master_portal/static/app.js`
Find `GOLD_PURITY_VALUES` or `SILVER_PURITY_VALUES` (around line 4901) and add the value:

```javascript
const GOLD_PURITY_VALUES = new Set(["22K", "24K", "18K", "14K", "9K", "NEW_PURITY"]);
// OR
const SILVER_PURITY_VALUES = new Set(["925", "999", "990", "970", "958", "835", "800", "NEW_PURITY"]);
```

> **Note:** Stones and Imitation do not use purity, so no purity filtering is applied for those categories.

---

## Quick Checklist

- [ ] Added HSN to `HSN_FIELD_OPTIONS` in `app.py`
- [ ] Added HSN to the correct `Set` in `app.js` (including the gold/silver semi-manufactured and articles sets, or pearl sets, where applicable)
- [ ] (Optional) Added new purity to `PURITY_FIELD_OPTIONS` in `app.py` and the matching `Set` in `app.js`
- [ ] Tested by opening the "Add Stock Item" modal and selecting the new HSN code

---

## What Happens If an HSN Is Not in Any Set?

If an HSN code is selected that doesn't appear in any of the four sets, the form **defaults to Gold** behaviour. This is intentional — gold is the most common category.
