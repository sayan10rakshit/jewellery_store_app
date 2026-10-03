alter table public.advance_receipts
  add column if not exists receipt_id uuid references public.receipts(id) on delete set null;

create index if not exists idx_advance_receipts_receipt_id
  on public.advance_receipts (receipt_id);
