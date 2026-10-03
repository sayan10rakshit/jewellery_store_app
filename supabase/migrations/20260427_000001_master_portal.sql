-- =============================================================================
-- Rakshit & Co. Johuree
-- Master Portal Schema for Supabase / PostgreSQL
-- -----------------------------------------------------------------------------
-- This schema updates the older draft to match the fields currently used in
-- bill_gen_frontend, while also covering stockbook, orderbook, ledger,
-- document file tracking, and customer email workflows.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'stock_status') then
    create type stock_status as enum (
      'in_stock',
      'reserved',
      'sold',
      'exchanged',
      'returned',
      'out_for_jobwork',
      'inactive'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'order_status') then
    create type order_status as enum (
      'draft',
      'open',
      'in_progress',
      'ready',
      'delivered',
      'cancelled'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'order_type') then
    create type order_type as enum (
      'custom_order',
      'stock_reservation',
      'repair',
      'alteration',
      'special_request'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'document_status') then
    create type document_status as enum (
      'draft',
      'issued',
      'partially_paid',
      'paid',
      'cancelled'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_direction') then
    create type payment_direction as enum ('in', 'out');
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_mode') then
    create type payment_mode as enum (
      'cash',
      'upi',
      'card',
      'cheque',
      'bank_transfer',
      'adjustment'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'transaction_source_type') then
    create type transaction_source_type as enum (
      'invoice',
      'advance_receipt',
      'receipt',
      'manual'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'communication_channel') then
    create type communication_channel as enum (
      'email',
      'sms',
      'whatsapp',
      'manual'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'communication_status') then
    create type communication_status as enum (
      'draft',
      'queued',
      'sent',
      'failed',
      'cancelled'
    );
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Master Data
-- -----------------------------------------------------------------------------

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  customer_code text unique,
  full_name text not null,
  primary_contact text not null,
  secondary_contact text,
  email citext,
  address_line text,
  state_name text,
  state_gst_code text,
  place_of_supply_name text,
  place_of_supply_gst_code text,
  pincode text,
  pan_aadhaar_no text unique,
  marketing_opt_in boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_persons (
  sales_person_id text primary key,
  full_name text not null,
  mobile_no text,
  email citext,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stock_items (
  id uuid primary key default gen_random_uuid(),
  stock_no text not null unique,
  huid text unique,
  description text not null,
  hsn_code text not null,
  ornament_type text,
  quantity integer not null default 1 check (quantity > 0),
  purity text not null,
  gross_weight_g numeric(12,3) not null check (gross_weight_g >= 0),
  stone_dust_deduction_g numeric(12,3) not null default 0 check (stone_dust_deduction_g >= 0),
  net_weight_g numeric(12,3) not null check (net_weight_g >= 0 and net_weight_g <= gross_weight_g),
  stone_weight_g numeric(12,3) not null default 0 check (stone_weight_g >= 0),
  stone_amount numeric(12,2) not null default 0,
  other_charges_amount numeric(12,2) not null default 0,
  making_charges_percent numeric(7,2),
  goldsmith_name text,
  goldsmith_loss numeric(12,3) not null default 0,
  other_expenses numeric(12,2) not null default 0,
  status stock_status not null default 'in_stock',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  stock_item_id uuid not null references public.stock_items(id) on delete cascade,
  movement_at timestamptz not null default now(),
  previous_status stock_status,
  new_status stock_status not null,
  quantity_delta integer not null default 0,
  reference_type text,
  reference_id uuid,
  remarks text
);

-- -----------------------------------------------------------------------------
-- Orders
-- -----------------------------------------------------------------------------

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_id uuid references public.customers(id),
  sales_person_id text references public.sales_persons(sales_person_id),
  order_type order_type not null,
  order_date date not null,
  promised_date date,
  status order_status not null default 'open',
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  line_no integer not null,
  stock_item_id uuid references public.stock_items(id),
  description text not null,
  quantity integer not null default 1 check (quantity > 0),
  approx_weight_g numeric(12,3),
  purity text,
  hsn_code text,
  predetermined_rate_per_gram numeric(12,2),
  predetermined_making_charges_amount numeric(12,2),
  predetermined_making_charges_percent numeric(7,2),
  status text not null default 'open',
  design_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, line_no)
);

-- -----------------------------------------------------------------------------
-- Advance Receipts / Customer Receipts
-- -----------------------------------------------------------------------------

create table if not exists public.advance_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_no text not null unique,
  order_id uuid references public.orders(id),
  customer_id uuid references public.customers(id),
  linked_reference_no text,
  receipt_datetime timestamptz not null,
  status document_status not null default 'issued',
  copy_type text default 'Original for Buyer',
  customer_name text not null,
  customer_contact_primary text,
  customer_contact_secondary text,
  customer_email citext,
  transaction_type text not null default 'cash',
  valuation_description text,
  customer_address text,
  customer_state_name text,
  customer_state_gst_code text,
  customer_pincode text,
  customer_pan_aadhaar_no text,
  amount numeric(12,2) not null default 0,
  gross_amount numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  round_off_amount numeric(12,2) not null default 0,
  net_amount numeric(12,2) not null default 0,
  amount_received numeric(12,2) not null default 0,
  remarks text,
  narration text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.advance_receipt_items (
  id uuid primary key default gen_random_uuid(),
  advance_receipt_id uuid not null references public.advance_receipts(id) on delete cascade,
  line_no integer not null,
  description text not null,
  purity text,
  gross_weight_g numeric(12,3) not null default 0,
  net_weight_g numeric(12,3) not null default 0,
  rate_per_gram numeric(12,2) not null default 0,
  line_total_amount numeric(12,2) not null default 0,
  unique (advance_receipt_id, line_no)
);

-- -----------------------------------------------------------------------------
-- Sales / Invoices
-- -----------------------------------------------------------------------------

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,
  customer_id uuid references public.customers(id),
  order_id uuid references public.orders(id),
  sales_person_id text references public.sales_persons(sales_person_id),
  linked_reference_no text,
  invoice_datetime timestamptz not null,
  source_order_date date,
  copy_type text default 'Original for Buyer',
  status document_status not null default 'issued',

  -- Bill-to snapshot from bill_gen_frontend.customer_info
  customer_name text not null,
  customer_contact_primary text,
  customer_contact_secondary text,
  customer_address text,
  customer_state_name text,
  customer_state_gst_code text,
  place_of_supply_name text,
  place_of_supply_gst_code text,
  customer_pincode text,
  customer_pan_aadhaar_no text,

  -- Consignee snapshot from bill_gen_frontend.consignee_info
  consignee_name text,
  consignee_contact_primary text,
  consignee_contact_secondary text,
  consignee_address text,
  consignee_state_name text,
  consignee_state_gst_code text,
  consignee_pincode text,
  consignee_pan_aadhaar_no text,

  items_total_amount numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  taxable_amount numeric(12,2) not null default 0,
  sgst_percent numeric(7,2) not null default 0,
  sgst_amount numeric(12,2) not null default 0,
  cgst_percent numeric(7,2) not null default 0,
  cgst_amount numeric(12,2) not null default 0,
  igst_percent numeric(7,2) not null default 0,
  igst_amount numeric(12,2) not null default 0,
  total_tax_amount numeric(12,2) not null default 0,
  gross_invoice_total numeric(12,2) not null default 0,
  round_off_amount numeric(12,2) not null default 0,
  old_gold_advance_amount numeric(12,2) not null default 0,
  net_payable_amount numeric(12,2) not null default 0,
  amount_received numeric(12,2) not null default 0,
  balance_due_amount numeric(12,2) not null default 0,
  remarks text,
  narration text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  stock_item_id uuid references public.stock_items(id),
  line_no integer not null,
  stock_no text,
  huid text,
  description text not null,
  quantity integer not null default 1 check (quantity > 0),
  hsn_code text,
  purity text,
  gross_weight_g numeric(12,3) not null default 0,
  stone_dust_deduction_g numeric(12,3) not null default 0,
  net_weight_g numeric(12,3) not null default 0,
  rate_per_gram numeric(12,2) not null default 0,
  gold_silver_amount numeric(12,2) not null default 0,
  stone_weight_g numeric(12,3) not null default 0,
  stone_amount numeric(12,2) not null default 0,
  other_charges_amount numeric(12,2) not null default 0,
  making_charges_amount numeric(12,2) not null default 0,
  making_charges_percent numeric(7,2),
  line_total_amount numeric(12,2) not null default 0,
  unique (invoice_id, line_no)
);

-- -----------------------------------------------------------------------------
-- Ledger / Payments
-- -----------------------------------------------------------------------------

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_number text not null unique,
  transaction_datetime timestamptz not null default now(),
  customer_id uuid references public.customers(id),
  direction payment_direction not null,
  source_type transaction_source_type not null,
  invoice_id uuid references public.invoices(id),
  advance_receipt_id uuid references public.advance_receipts(id),
  receipt_id uuid references public.receipts(id),
  total_amount numeric(12,2) not null check (total_amount >= 0),
  reference_no text,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_transaction_tenders (
  id uuid primary key default gen_random_uuid(),
  payment_transaction_id uuid not null references public.payment_transactions(id) on delete cascade,
  payment_mode payment_mode not null,
  amount numeric(12,2) not null check (amount >= 0),
  instrument_label text,
  instrument_number text,
  account_number text
);

-- -----------------------------------------------------------------------------
-- Files / Communications
-- -----------------------------------------------------------------------------

create table if not exists public.document_files (
  id uuid primary key default gen_random_uuid(),
  document_type text not null,
  document_id uuid not null,
  file_name text not null,
  file_path text not null,
  mime_type text not null default 'application/pdf',
  generated_at timestamptz not null default now(),
  notes text
);

create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  template_name text not null unique,
  subject_template text not null,
  body_html text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_communications (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id),
  channel communication_channel not null default 'email',
  template_id uuid references public.email_templates(id),
  related_document_type text,
  related_document_id uuid,
  recipient_name text,
  recipient_email citext,
  recipient_phone text,
  subject text,
  body_preview text,
  attachment_file_ids uuid[] not null default '{}',
  status communication_status not null default 'draft',
  scheduled_at timestamptz,
  sent_at timestamptz,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------

create index if not exists idx_customers_primary_contact
  on public.customers (primary_contact);

create index if not exists idx_customers_email
  on public.customers (email);

create index if not exists idx_stock_items_status
  on public.stock_items (status);

create index if not exists idx_stock_items_hsn_code
  on public.stock_items (hsn_code);

create index if not exists idx_orders_customer_order_date
  on public.orders (customer_id, order_date desc);

create index if not exists idx_invoices_customer_invoice_datetime
  on public.invoices (customer_id, invoice_datetime desc);

create index if not exists idx_advance_receipts_customer_datetime
  on public.advance_receipts (customer_id, receipt_datetime desc);

create index if not exists idx_payment_transactions_customer_datetime
  on public.payment_transactions (customer_id, transaction_datetime desc);

create index if not exists idx_customer_communications_customer_status
  on public.customer_communications (customer_id, status, scheduled_at desc);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------

drop trigger if exists trg_customers_updated_at on public.customers;
create trigger trg_customers_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

drop trigger if exists trg_sales_persons_updated_at on public.sales_persons;
create trigger trg_sales_persons_updated_at
before update on public.sales_persons
for each row execute function public.set_updated_at();

drop trigger if exists trg_stock_items_updated_at on public.stock_items;
create trigger trg_stock_items_updated_at
before update on public.stock_items
for each row execute function public.set_updated_at();

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

drop trigger if exists trg_order_items_updated_at on public.order_items;
create trigger trg_order_items_updated_at
before update on public.order_items
for each row execute function public.set_updated_at();

drop trigger if exists trg_advance_receipts_updated_at on public.advance_receipts;
create trigger trg_advance_receipts_updated_at
before update on public.advance_receipts
for each row execute function public.set_updated_at();

drop trigger if exists trg_invoices_updated_at on public.invoices;
create trigger trg_invoices_updated_at
before update on public.invoices
for each row execute function public.set_updated_at();

drop trigger if exists trg_receipts_updated_at on public.receipts;
create trigger trg_receipts_updated_at
before update on public.receipts
for each row execute function public.set_updated_at();

drop trigger if exists trg_payment_transactions_updated_at on public.payment_transactions;
create trigger trg_payment_transactions_updated_at
before update on public.payment_transactions
for each row execute function public.set_updated_at();

drop trigger if exists trg_email_templates_updated_at on public.email_templates;
create trigger trg_email_templates_updated_at
before update on public.email_templates
for each row execute function public.set_updated_at();

drop trigger if exists trg_customer_communications_updated_at on public.customer_communications;
create trigger trg_customer_communications_updated_at
before update on public.customer_communications
for each row execute function public.set_updated_at();
