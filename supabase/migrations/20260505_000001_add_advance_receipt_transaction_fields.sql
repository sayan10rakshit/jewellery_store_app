alter table public.advance_receipts
  add column if not exists transaction_type text not null default 'cash',
  add column if not exists valuation_description text;
