create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  body text,
  customer_id uuid references public.customers(id),
  artisan_id uuid references public.artisans(id),
  order_id uuid references public.orders(id),
  invoice_id uuid references public.invoices(id),
  receipt_id uuid references public.receipts(id),
  reminder_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'snoozed', 'closed')),
  snoozed_until timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_notifications_status_reminder_at
  on public.notifications (status, reminder_at asc);

create index if not exists idx_notifications_customer_artisan
  on public.notifications (customer_id, artisan_id);

create index if not exists idx_notifications_order_invoice_receipt
  on public.notifications (order_id, invoice_id, receipt_id);

drop trigger if exists trg_notifications_updated_at on public.notifications;
create trigger trg_notifications_updated_at
before update on public.notifications
for each row execute function public.set_updated_at();
