# Rakshit & Co. Johuree Master Portal Blueprint

## What changed from the old schema

The schema you drafted was missing several fields that `bill_gen_frontend` already captures today:

- `customer_info.contact2`
- `customer_info.place_of_supply_name`
- `customer_info.place_of_supply_gst_code`
- `consignee_info.*`
- `invoice_info.linked_reference_no`
- `invoice_info.copy_type`
- richer invoice item breakup:
  - `HUID`
  - `stone_dust_deduction`
  - `rate_per_gram`
  - `gold_silver_amount`
  - `diamond_or_stone_weight`
  - `diamond_or_stone_amount`
  - `other_charges`
  - `making_charges_percent`
- richer payment split:
  - `cash_amount`
  - `upi_amount`
  - `card_amount`
  - `cheque_amount`
  - `bank_amount`
  - `card_name`
  - `cheque_bank_name`
  - `bank_name`
  - `card_number`
  - `cheque_number`
  - `account_number`
  - `discount`
  - `round_off`
  - `old_gold_advance`
  - `amount_received`
  - `narration`
- receipt item fields:
  - `purity`
  - `gross_weight`
  - `net_weight`
  - `rate_per_gram`
  - `amount`

Because invoices and receipts are legal business documents, the revised schema keeps customer master data and also stores document-time snapshots inside `invoices` and `advance_receipts`. That is intentional.

## Recommended local-first architecture

You said the app will stay local and will not be hosted publicly. The cleanest setup is:

- Frontend: local web app on `localhost`
- Backend: Supabase database + storage + auth if needed
- File generation: keep using your existing `bill_gen_frontend` PDF generator first
- Master portal: a new app that manages stock, orders, CRM, ledger, and launches or embeds billing workflows

Recommended rollout:

1. Keep `bill_gen_frontend` as the billing engine for phase 1.
2. Build the master portal around it instead of rewriting billing immediately.
3. Save invoice, receipt, payment, and PDF metadata into Supabase.
4. Later, move the billing UI into the master portal if you want one unified interface.

## Portal modules

### 1. Dashboard

Show:

- today sales
- today receipts
- pending orders
- low stock / reserved stock
- customer dues
- recent communications

### 2. Customer Book

Manage:

- customer master
- 2 contact numbers
- address + GST state details
- PAN/Aadhaar
- email address
- marketing opt-in
- purchase history
- due history
- email history

### 3. Stockbook

Manage:

- stock number
- HUID
- HSN
- purity
- gross / net / stone deduction
- pricing breakup
- current stock status
- stock movement history

### 4. Orderbook

Manage:

- custom orders
- reservation orders
- repair / alteration jobs
- promised delivery date
- line-wise rate and making commitments
- order-to-invoice linkage

### 5. Billing Desk

Use existing billing flow for:

- invoice generation
- receipt generation
- PDF file output
- customer/consignee snapshots
- tax calculation
- split payment capture

Persist:

- invoice headers
- invoice lines
- receipt headers
- receipt lines
- generated PDF path

### 6. Voucher Desk

Use for:

- old gold purchase
- refund payouts
- advance refunds
- manual adjustments

### 7. Ledger

Track:

- money in / out
- split tender payments
- invoice settlements
- receipt collections
- voucher payouts
- outstanding balances

### 8. Reminders / Follow-up Desk

Support:

- order follow-up reminders
- invoice follow-up reminders
- receipt follow-up reminders
- customer callback reminders
- artisan callback reminders

The schema includes:

- `document_files`
- `notifications`

That is enough to track operational follow-ups directly inside the portal.

## Screen design for the master portal

Use a single left-sidebar app with these sections:

1. `Dashboard`
2. `Customers`
3. `Stockbook`
4. `Orderbook`
5. `Billing`
6. `Receipts`
7. `Vouchers`
8. `Ledger`
9. `Notifications`
10. `Reports`
11. `Settings`

For a jewellery workflow, each page should prioritize lookup speed:

- global search by customer / invoice / order / stock no / HUID
- sticky action bar
- quick-create buttons
- dense but clean data tables
- printable detail drawer on the right

## Important schema decisions

### Why `payment_transaction_tenders` exists

Your old `Transactions` table assumed one payment mode per transaction.  
The current billing UI can capture mixed payments in one sale, such as:

- cash + UPI
- bank + card
- cheque + cash

So the revised schema separates:

- `payment_transactions`: one business transaction
- `payment_transaction_tenders`: one or many payment-mode rows

### Why invoice and receipt snapshots are duplicated

Customer master data can change later.  
Invoices and receipts must preserve what was actually printed that day.  
That is why billing and consignee fields are stored again on the document tables.

### Why stock has both physical and pricing fields

Your billing form mixes identity, weight, and commercial breakup for each item.  
The stockbook should preserve all of that so billing can reuse stock data directly.

## Suggested build phases

### Phase 1

- create Supabase tables from `supabase/master_portal_schema.sql`
- connect billing app writes to Supabase
- store generated PDF metadata

### Phase 2

- build customer book
- build stockbook
- build orderbook
- create invoice / receipt listing screens

### Phase 3

- build voucher desk
- build ledger settlement views
- add due reminders

### Phase 4

- add email templates
- send invoice / receipt PDF by email
- add promotional campaigns with opt-in filtering

## Email component recommendation

For your use case, the first version should support three email types:

1. `Transactional`
   - invoice PDF
   - receipt PDF
   - order-ready notification

2. `Relationship`
   - follow-up after purchase
   - due reminder
   - repair / custom order update

3. `Promotional`
   - Akshaya Tritiya
   - Durga Puja / Diwali offers
   - new collection launch

Minimum customer fields you should keep for this:

- `full_name`
- `primary_contact`
- `email`
- `marketing_opt_in`

## Notes about Supabase MCP

You shared the MCP setup steps, which are useful, but I did not run them here.

Reasons:

- remote MCP needs Codex config change
- Supabase login needs an interactive auth flow
- this workspace does not yet contain a full Supabase app scaffold

Once you want, we can do that as the next step and then turn this schema into actual migrations and typed data access.
