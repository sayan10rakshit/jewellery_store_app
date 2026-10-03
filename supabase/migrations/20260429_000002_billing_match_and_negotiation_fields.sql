alter table public.advance_receipts
  add column if not exists customer_email citext;

alter table public.invoices
  add column if not exists customer_email citext;

alter table public.invoice_items
  add column if not exists gold_silver_rate numeric(12,2) not null default 0,
  add column if not exists negotiated_total_amount_with_tax numeric(12,2);
