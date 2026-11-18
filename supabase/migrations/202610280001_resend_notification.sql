-- 202610280001_resend_notification.sql
--
-- Staff "resend" for the email outbox (Admin → Comms → Outbox).
--
-- The original notification_log row is immutable delivery history, so a resend
-- inserts a fresh queued row (the notify dispatcher picks it up) instead of
-- flipping a sent/failed row back to queued. Two rules are enforced here rather
-- than in the client, so a hand-crafted API call cannot bypass them:
--   * only staff may resend;
--   * a customer who opted out of that kind is never emailed again.
-- The attempt itself is audited by the notification_log insert trigger.

create or replace function public.resend_notification(p_id uuid)
returns public.notification_log
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.notification_log;
  v_copy public.notification_log;
  v_prefs jsonb;
begin
  if not public.is_staff() then
    raise exception 'Only staff can resend emails.' using errcode = '42501';
  end if;

  select * into v_source from public.notification_log where id = p_id;
  if v_source.id is null then
    raise exception 'Email not found.';
  end if;
  if v_source.channel <> 'email' or coalesce(v_source.recipient, '') = '' then
    raise exception 'Only email messages can be resent.';
  end if;

  select coalesce(notification_prefs, '{}'::jsonb) into v_prefs
  from public.profiles
  where lower(email) = lower(v_source.recipient)
  limit 1;

  if v_prefs is not null and not public.notification_kind_allowed(v_source.kind, v_prefs) then
    raise exception 'This customer has opted out of these emails.';
  end if;

  insert into public.notification_log (kind, channel, recipient, subject, body, meta, status)
  values (
    v_source.kind,
    'email',
    v_source.recipient,
    v_source.subject,
    v_source.body,
    coalesce(v_source.meta, '{}'::jsonb) || jsonb_build_object('resentFrom', v_source.id),
    'queued'
  )
  returning * into v_copy;

  return v_copy;
end;
$$;

revoke all on function public.resend_notification(uuid) from public, anon;
grant execute on function public.resend_notification(uuid) to authenticated, service_role;

comment on function public.resend_notification(uuid)
  is 'Staff-only: queue a fresh copy of a sent/failed email, honouring the recipient''s notification preferences.';
