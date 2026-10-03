do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'transaction_source_type'
      and e.enumlabel = 'receipt'
  ) then
    alter type public.transaction_source_type add value 'receipt';
  end if;
end $$;

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_no text not null unique,
  customer_id uuid references public.customers(id) on delete set null,
  linked_reference_no text,
  linked_invoice_id uuid unique references public.invoices(id) on delete set null,
  receipt_datetime timestamptz not null default now(),
  copy_type text default 'Original for Buyer',
  status public.document_status not null default 'issued',
  customer_name text not null,
  customer_contact_primary text,
  customer_contact_secondary text,
  customer_email citext,
  customer_address text,
  customer_state_name text,
  customer_state_gst_code text,
  customer_pincode text,
  customer_pan_aadhaar_no text,
  gross_amount numeric not null default 0,
  less_invoice_amount numeric not null default 0,
  discount_amount numeric not null default 0,
  round_off_amount numeric not null default 0,
  net_amount numeric not null default 0,
  amount_received numeric not null default 0,
  remarks text,
  narration text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  line_no integer not null,
  description text not null,
  purity text,
  gross_weight_g numeric not null default 0,
  net_weight_g numeric not null default 0,
  rate_per_gram numeric not null default 0,
  line_total_amount numeric not null default 0
);

alter table public.receipts enable row level security;
alter table public.receipt_items enable row level security;

insert into public.receipts (
  receipt_no,
  customer_id,
  linked_reference_no,
  linked_invoice_id,
  receipt_datetime,
  copy_type,
  status,
  customer_name,
  customer_contact_primary,
  customer_contact_secondary,
  customer_email,
  customer_address,
  customer_state_name,
  customer_state_gst_code,
  customer_pincode,
  customer_pan_aadhaar_no,
  gross_amount,
  less_invoice_amount,
  discount_amount,
  round_off_amount,
  net_amount,
  amount_received,
  remarks,
  narration,
  created_at,
  updated_at
)
select
  ar.receipt_no,
  ar.customer_id,
  ar.linked_reference_no,
  ar.linked_invoice_id,
  ar.receipt_datetime,
  ar.copy_type,
  ar.status,
  ar.customer_name,
  ar.customer_contact_primary,
  ar.customer_contact_secondary,
  ar.customer_email,
  ar.customer_address,
  ar.customer_state_name,
  ar.customer_state_gst_code,
  ar.customer_pincode,
  ar.customer_pan_aadhaar_no,
  ar.gross_amount,
  coalesce(ar.less_invoice_amount, 0),
  ar.discount_amount,
  ar.round_off_amount,
  ar.net_amount,
  ar.amount_received,
  ar.remarks,
  ar.narration,
  ar.created_at,
  ar.updated_at
from public.advance_receipts ar
where ar.order_id is null
on conflict (receipt_no) do update set
  customer_id = excluded.customer_id,
  linked_reference_no = excluded.linked_reference_no,
  linked_invoice_id = excluded.linked_invoice_id,
  receipt_datetime = excluded.receipt_datetime,
  copy_type = excluded.copy_type,
  status = excluded.status,
  customer_name = excluded.customer_name,
  customer_contact_primary = excluded.customer_contact_primary,
  customer_contact_secondary = excluded.customer_contact_secondary,
  customer_email = excluded.customer_email,
  customer_address = excluded.customer_address,
  customer_state_name = excluded.customer_state_name,
  customer_state_gst_code = excluded.customer_state_gst_code,
  customer_pincode = excluded.customer_pincode,
  customer_pan_aadhaar_no = excluded.customer_pan_aadhaar_no,
  gross_amount = excluded.gross_amount,
  less_invoice_amount = excluded.less_invoice_amount,
  discount_amount = excluded.discount_amount,
  round_off_amount = excluded.round_off_amount,
  net_amount = excluded.net_amount,
  amount_received = excluded.amount_received,
  remarks = excluded.remarks,
  narration = excluded.narration,
  updated_at = excluded.updated_at;

insert into public.receipt_items (
  receipt_id,
  line_no,
  description,
  purity,
  gross_weight_g,
  net_weight_g,
  rate_per_gram,
  line_total_amount
)
select
  r.id,
  ari.line_no,
  ari.description,
  ari.purity,
  ari.gross_weight_g,
  ari.net_weight_g,
  ari.rate_per_gram,
  ari.line_total_amount
from public.advance_receipt_items ari
join public.advance_receipts ar on ar.id = ari.advance_receipt_id
join public.receipts r on r.receipt_no = ar.receipt_no
where ar.order_id is null
  and not exists (
    select 1
    from public.receipt_items existing
    where existing.receipt_id = r.id
      and existing.line_no = ari.line_no
  );

alter table public.invoices drop constraint if exists invoices_linked_receipt_id_fkey;

update public.invoices inv
set linked_receipt_id = r.id
from public.advance_receipts ar
join public.receipts r on r.receipt_no = ar.receipt_no
where inv.linked_receipt_id = ar.id;

alter table public.invoices
  add constraint invoices_linked_receipt_id_fkey
  foreign key (linked_receipt_id) references public.receipts(id) on delete set null;

alter table public.payment_transactions
  add column if not exists receipt_id uuid;

alter table public.payment_transactions
  drop constraint if exists payment_transactions_receipt_id_fkey;

alter table public.payment_transactions
  add constraint payment_transactions_receipt_id_fkey
  foreign key (receipt_id) references public.receipts(id) on delete set null;

alter table public.payment_transactions
  drop constraint if exists payment_transactions_voucher_id_fkey;

alter table public.payment_transactions
  drop column if exists voucher_id cascade;

drop table if exists public.voucher_items;
drop table if exists public.vouchers;
