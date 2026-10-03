drop trigger if exists trg_customer_communications_updated_at on public.customer_communications;
drop trigger if exists trg_email_templates_updated_at on public.email_templates;

drop table if exists public.customer_communications;
drop table if exists public.email_templates;

drop type if exists public.communication_status;
drop type if exists public.communication_channel;
