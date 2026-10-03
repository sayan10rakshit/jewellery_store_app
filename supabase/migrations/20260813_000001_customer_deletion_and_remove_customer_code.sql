-- Keep document snapshots when a customer is removed, while allowing the portal
-- to explicitly purge linked records when requested.
alter table public.customers drop column if exists customer_code;

alter table public.orders drop constraint if exists orders_customer_id_fkey;
alter table public.orders add constraint orders_customer_id_fkey
  foreign key (customer_id) references public.customers(id) on delete set null;

alter table public.advance_receipts drop constraint if exists advance_receipts_customer_id_fkey;
alter table public.advance_receipts add constraint advance_receipts_customer_id_fkey
  foreign key (customer_id) references public.customers(id) on delete set null;
alter table public.advance_receipts drop constraint if exists advance_receipts_order_id_fkey;
alter table public.advance_receipts add constraint advance_receipts_order_id_fkey
  foreign key (order_id) references public.orders(id) on delete set null;
alter table public.advance_receipts drop constraint if exists advance_receipts_receipt_id_fkey;
alter table public.advance_receipts add constraint advance_receipts_receipt_id_fkey
  foreign key (receipt_id) references public.receipts(id) on delete set null;

alter table public.invoices drop constraint if exists invoices_customer_id_fkey;
alter table public.invoices add constraint invoices_customer_id_fkey
  foreign key (customer_id) references public.customers(id) on delete set null;
alter table public.invoices drop constraint if exists invoices_order_id_fkey;
alter table public.invoices add constraint invoices_order_id_fkey
  foreign key (order_id) references public.orders(id) on delete set null;
alter table public.invoices drop constraint if exists invoices_linked_receipt_id_fkey;
alter table public.invoices add constraint invoices_linked_receipt_id_fkey
  foreign key (linked_receipt_id) references public.receipts(id) on delete set null;

alter table public.receipts drop constraint if exists receipts_linked_invoice_id_fkey;
alter table public.receipts add constraint receipts_linked_invoice_id_fkey
  foreign key (linked_invoice_id) references public.invoices(id) on delete set null;

alter table public.payment_transactions drop constraint if exists payment_transactions_customer_id_fkey;
alter table public.payment_transactions add constraint payment_transactions_customer_id_fkey
  foreign key (customer_id) references public.customers(id) on delete set null;
alter table public.payment_transactions drop constraint if exists payment_transactions_invoice_id_fkey;
alter table public.payment_transactions add constraint payment_transactions_invoice_id_fkey
  foreign key (invoice_id) references public.invoices(id) on delete set null;
alter table public.payment_transactions drop constraint if exists payment_transactions_advance_receipt_id_fkey;
alter table public.payment_transactions add constraint payment_transactions_advance_receipt_id_fkey
  foreign key (advance_receipt_id) references public.advance_receipts(id) on delete set null;
alter table public.payment_transactions drop constraint if exists payment_transactions_receipt_id_fkey;
alter table public.payment_transactions add constraint payment_transactions_receipt_id_fkey
  foreign key (receipt_id) references public.receipts(id) on delete set null;

alter table public.notifications drop constraint if exists notifications_customer_id_fkey;
alter table public.notifications add constraint notifications_customer_id_fkey
  foreign key (customer_id) references public.customers(id) on delete set null;
alter table public.notifications drop constraint if exists notifications_order_id_fkey;
alter table public.notifications add constraint notifications_order_id_fkey
  foreign key (order_id) references public.orders(id) on delete set null;
alter table public.notifications drop constraint if exists notifications_invoice_id_fkey;
alter table public.notifications add constraint notifications_invoice_id_fkey
  foreign key (invoice_id) references public.invoices(id) on delete set null;
alter table public.notifications drop constraint if exists notifications_receipt_id_fkey;
alter table public.notifications add constraint notifications_receipt_id_fkey
  foreign key (receipt_id) references public.receipts(id) on delete set null;
