-- A reversible, auditable lifecycle for made-to-order jewellery.
alter type public.order_status add value if not exists 'created';
alter type public.order_status add value if not exists 'finished';
alter type public.order_status add value if not exists 'pending_delivery';

alter table public.order_items
  add column if not exists other_charges_amount numeric(12,2) not null default 0,
  add column if not exists stone_amount numeric(12,2);

create table if not exists public.order_artisan_assignments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete cascade,
  artisan_id uuid not null references public.artisans(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  returned_at timestamptz,
  remarks text
);
create index if not exists idx_order_artisan_assignments_order_id on public.order_artisan_assignments(order_id, assigned_at desc);
alter table public.order_artisan_assignments
  add column if not exists order_item_id uuid references public.order_items(id) on delete cascade;
create index if not exists idx_order_artisan_assignments_order_item_id on public.order_artisan_assignments(order_item_id, assigned_at desc);

create table if not exists public.order_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  event_type text not null check (event_type in ('created', 'details_updated', 'artisan_assigned', 'status_changed', 'final_details_linked', 'delivered', 'cancelled')),
  from_status public.order_status,
  to_status public.order_status,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists idx_order_lifecycle_events_order_id_occurred_at on public.order_lifecycle_events(order_id, occurred_at desc);
