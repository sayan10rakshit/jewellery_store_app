-- Keep the existing date for reporting while recording the editable order time.
alter table public.orders
  add column if not exists order_datetime timestamptz;
