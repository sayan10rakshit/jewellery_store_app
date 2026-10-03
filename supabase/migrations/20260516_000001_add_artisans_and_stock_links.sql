create table if not exists public.artisans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  usual_making_charge_percent numeric(7,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.stock_items
  add column if not exists artisan_id uuid references public.artisans(id);

insert into public.artisans (name)
select distinct trim(stock_items.goldsmith_name)
from public.stock_items
where nullif(trim(stock_items.goldsmith_name), '') is not null
on conflict (name) do nothing;

update public.stock_items
set artisan_id = artisans.id
from public.artisans
where public.stock_items.artisan_id is null
  and lower(trim(public.stock_items.goldsmith_name)) = lower(trim(public.artisans.name));

create index if not exists idx_artisans_name
  on public.artisans (name);

create index if not exists idx_stock_items_artisan_id
  on public.stock_items (artisan_id);

drop trigger if exists trg_artisans_updated_at on public.artisans;
create trigger trg_artisans_updated_at
before update on public.artisans
for each row execute function public.set_updated_at();
