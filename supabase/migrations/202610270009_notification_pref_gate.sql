-- 202610270009_notification_pref_gate.sql
--
-- Actually enforce the notification preferences a customer saves in Account.
--
-- The preferences were stored (profiles.notification_prefs) but never read:
-- a customer who toggled off "Trip updates" still received trip emails and
-- in-app alerts. This migration adds a single choke point for in-app rows — a
-- BEFORE INSERT trigger on notifications that silently drops any user-facing
-- row whose kind the customer opted out of. The trigger maps each kind to one
-- of the four preference buckets (booking_confirmed / trip_updates /
-- cancellations_refunds / promotions) exactly like src/lib/notifications.js,
-- so opt-outs work in both adapters.
--
-- The notify dispatcher separately skips queued emails for opted-out
-- recipients (see supabase/functions/notify).

-- Shared mapping so the trigger and the dispatcher agree.
create or replace function public.notification_kind_allowed(p_kind text, p_prefs jsonb)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
    (p_prefs -> (
      case lower(replace(coalesce(p_kind, ''), '_', '-'))
        when 'booking-confirmed' then 'booking_confirmed'
        when 'booking-pending'   then 'booking_confirmed'
        when 'booking-cancelled' then 'cancellations_refunds'
        when 'booking-rejected'  then 'cancellations_refunds'
        when 'booking-refunded'  then 'cancellations_refunds'
        when 'deposit-settled'   then 'cancellations_refunds'
        when 'winback-offer'     then 'promotions'
        else 'trip_updates'
      end
    ))::boolean,
    true
  );
$$;

create or replace function public.gate_user_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefs jsonb;
begin
  if new.audience = 'user' and new.user_id is not null then
    select coalesce(notification_prefs, '{}'::jsonb) into v_prefs
    from public.profiles where id = new.user_id;

    if not public.notification_kind_allowed(new.kind, v_prefs) then
      -- Suppressing the row (returning null) opts the customer out without
      -- making every sender branch on preferences.
      return null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_pref_gate on public.notifications;
create trigger notifications_pref_gate before insert on public.notifications
  for each row execute function public.gate_user_notification();

-- Least privilege: the mapping is only consumed by the notify dispatcher
-- (service_role). No client role should be able to probe another customer's
-- preference state; trigger functions fire via their security-definer owner.
revoke all on function public.notification_kind_allowed(text, jsonb) from public, anon, authenticated;
grant execute on function public.notification_kind_allowed(text, jsonb) to service_role;
revoke all on function public.gate_user_notification() from public, anon, authenticated;
