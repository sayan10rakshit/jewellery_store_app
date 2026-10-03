alter table public.stock_items
  add column if not exists goldsmith_name text,
  add column if not exists goldsmith_loss numeric(12,3) not null default 0,
  add column if not exists other_expenses numeric(12,2) not null default 0;

alter table public.stock_items
  drop column if exists rate_per_gram,
  drop column if exists gold_silver_amount,
  drop column if exists making_charges_amount;
