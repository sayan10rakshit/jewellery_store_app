-- Keep detailed orderbook activity in the existing lifecycle event stream.
-- The event type is intentionally open ended so new order checkpoints can be
-- added without another database constraint migration.
alter table public.order_lifecycle_events
  drop constraint if exists order_lifecycle_events_event_type_check;

create index if not exists idx_order_lifecycle_events_order_id_occurred_at
  on public.order_lifecycle_events (order_id, occurred_at desc);

-- Preserve at least the original creation date for orders created before the
-- lifecycle history was introduced. Later historical transitions cannot be
-- reconstructed from the current order row alone.
insert into public.order_lifecycle_events (
  order_id, event_type, to_status, details, occurred_at
)
select
  orders.id,
  'created',
  case when orders.status in ('draft', 'open') then 'created'::public.order_status else orders.status end,
  jsonb_build_object('order_number', coalesce(orders.order_number, '')),
  coalesce(orders.created_at, orders.updated_at, now())
from public.orders as orders
where not exists (
  select 1
  from public.order_lifecycle_events as events
  where events.order_id = orders.id
    and events.event_type = 'created'
);
