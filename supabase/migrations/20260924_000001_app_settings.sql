create table if not exists public.app_settings (
    key text primary key,
    value jsonb not null,
    updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

revoke all on table public.app_settings from public, anon, authenticated;
grant select, insert, update on table public.app_settings to service_role;
