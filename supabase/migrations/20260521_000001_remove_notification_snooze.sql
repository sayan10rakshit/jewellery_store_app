update public.notifications
set
  reminder_at = coalesce(snoozed_until, reminder_at),
  status = case when status = 'closed' then 'closed' else 'open' end
where snoozed_until is not null or status = 'snoozed';

alter table public.notifications
  drop constraint if exists notifications_status_check;

alter table public.notifications
  drop column if exists snoozed_until;

alter table public.notifications
  add constraint notifications_status_check
  check (status in ('open', 'closed'));
