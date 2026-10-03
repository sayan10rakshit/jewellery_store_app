alter table public.artisans
  add column if not exists usual_cash_charged numeric(12,2);

alter table public.stock_items
  add column if not exists stone_expense numeric(12,2) not null default 0,
  add column if not exists making_baseline numeric(12,3) not null default 0.92,
  add column if not exists profit_cash_amount numeric(12,2),
  add column if not exists profit_excess_weight_g numeric(12,6),
  add column if not exists profit_calculated_at timestamptz;

update public.stock_items
set making_baseline = case
  when hsn_code in ('71131130', '71141110', '71131110', '71131120', '71069220') then 0.925
  else coalesce(making_baseline, 0.92)
end
where making_baseline is null or making_baseline = 0.92;

create table if not exists public.stock_item_artisans (
  id uuid primary key default gen_random_uuid(),
  stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  artisan_id uuid not null references public.artisans(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stock_item_id, artisan_id)
);

insert into public.stock_item_artisans (stock_item_id, artisan_id)
select public.stock_items.id, public.stock_items.artisan_id
from public.stock_items
where public.stock_items.artisan_id is not null
on conflict (stock_item_id, artisan_id) do nothing;

create index if not exists idx_stock_item_artisans_stock_item_id
  on public.stock_item_artisans (stock_item_id);

create index if not exists idx_stock_item_artisans_artisan_id
  on public.stock_item_artisans (artisan_id);

alter table public.invoice_items
  add column if not exists stone_expense numeric(12,2) not null default 0,
  add column if not exists making_baseline numeric(12,3),
  add column if not exists goldsmith_loss numeric(12,3) not null default 0,
  add column if not exists other_expenses numeric(12,2) not null default 0,
  add column if not exists profit_cash_amount numeric(12,2),
  add column if not exists profit_excess_weight_g numeric(12,6),
  add column if not exists ornament_type text;
