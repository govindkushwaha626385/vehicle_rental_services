-- In-app notifications: customer trip updates and staff operational events.
-- Outbound email already flows through notification_log + the notify
-- function; this table is the in-product inbox readers see immediately.
--
-- audience 'user' rows belong to a specific profile (read + mark-read by the
-- owner). audience 'staff' rows are broadcast operational events readable by
-- any staff member and inserted by staff or the service role.

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  audience     text not null default 'user' check (audience in ('user', 'staff')),
  user_id      uuid references public.profiles(id) on delete cascade,
  kind         text not null,
  title        text not null,
  body         text not null default '',
  booking_code text,
  link         text not null default '',
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  constraint notifications_user_requires_owner check (audience <> 'user' or user_id is not null)
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_staff_idx
  on public.notifications (audience, created_at desc) where audience = 'staff';

alter table public.notifications enable row level security;

-- Users read their own inbox; staff additionally read the ops feed.
drop policy if exists notifications_select_own_or_staff on public.notifications;
create policy notifications_select_own_or_staff on public.notifications
  for select to authenticated
  using (public.is_staff() or (audience = 'user' and user_id = auth.uid()));

-- Owners mark their own inbox read; staff insert ops feed rows.
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated
  with check (audience = 'user' and user_id = auth.uid());

drop policy if exists notifications_staff_insert on public.notifications;
create policy notifications_staff_insert on public.notifications
  for insert to authenticated
  with check (public.is_staff());

-- Staff also queue outbound emails from the console (cancellations, refunds,
-- status changes). The notify dispatcher drains these rows via service role.
drop policy if exists notification_log_staff_insert on public.notification_log;
create policy notification_log_staff_insert on public.notification_log
  for insert to authenticated
  with check (public.is_staff());