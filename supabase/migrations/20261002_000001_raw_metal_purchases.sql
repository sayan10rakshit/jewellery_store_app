create table if not exists public.raw_metal_purchases (
  id uuid primary key default gen_random_uuid(),
  purchase_date date not null,
  metal text not null check (metal in ('gold', 'silver')),
  source_name text not null check (length(btrim(source_name)) > 0),
  weight_g numeric(14,3) not null check (weight_g > 0),
  rate_per_gram numeric(14,2) not null check (rate_per_gram > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists raw_metal_purchases_date_idx
  on public.raw_metal_purchases (purchase_date desc, created_at desc);

alter table public.raw_metal_purchases enable row level security;
revoke all on table public.raw_metal_purchases from public, anon, authenticated;
grant select, insert, update, delete on table public.raw_metal_purchases to service_role;

drop trigger if exists trg_raw_metal_purchases_updated_at on public.raw_metal_purchases;
create trigger trg_raw_metal_purchases_updated_at
before update on public.raw_metal_purchases
for each row execute function public.set_updated_at();
