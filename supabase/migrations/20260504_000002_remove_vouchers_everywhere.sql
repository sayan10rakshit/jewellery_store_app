do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payment_transactions'
      and column_name = 'voucher_id'
  ) then
    alter table public.payment_transactions
      drop constraint if exists payment_transactions_voucher_id_fkey;

    alter table public.payment_transactions
      drop column if exists voucher_id cascade;
  end if;
end $$;

drop table if exists public.voucher_items;
drop table if exists public.vouchers;

update public.payment_transactions
set source_type = 'manual'
where source_type::text = 'voucher';

do $$
begin
  if exists (
    select 1
    from pg_type
    where typname = 'transaction_source_type'
  ) then
    alter type public.transaction_source_type rename to transaction_source_type_old;

    create type public.transaction_source_type as enum (
      'invoice',
      'advance_receipt',
      'receipt',
      'manual'
    );

    alter table public.payment_transactions
      alter column source_type
      type public.transaction_source_type
      using source_type::text::public.transaction_source_type;

    drop type public.transaction_source_type_old;
  end if;
end $$;

drop type if exists public.voucher_type;
