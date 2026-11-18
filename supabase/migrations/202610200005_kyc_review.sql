-- 202610200005_kyc_review.sql
-- Staff review for licence scans uploaded from the customer account.
--
-- Customers may upload/replace their own scan (profiles.licence_url), but only
-- staff can change the verification flag. Idempotent: safe to run more than once.

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service-role calls run without auth.uid(). Only admins may change role/status.
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role or new.status is distinct from old.status then
      raise exception 'Only super admins can change account role or status.';
    end if;
  end if;

  -- A customer can upload a new scan, but cannot mark their own licence verified.
  if auth.uid() is not null and not public.is_staff()
     and new.licence_verified is distinct from old.licence_verified then
    raise exception 'Licence verification must be completed by Rove staff.';
  end if;

  return new;
end;
$$;

-- Expose the review state to the admin users table.
create or replace function public.admin_users()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required.';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.full_name, 'email', p.email, 'phone', p.phone,
      'role', p.role, 'status', p.status, 'licenseNumber', p.license_number,
      'cardBrand', p.card_brand, 'cardLast4', p.card_last4, 'createdAt', p.created_at,
      'licenceVerified', p.licence_verified, 'licenceUrl', p.licence_url,
      'bookings', (select count(*) from public.bookings b where b.user_id = p.id),
      'spend', (select coalesce(sum(b.total),0) from public.bookings b where b.user_id = p.id and b.status = 'completed')
    ) order by p.created_at desc), '[]'::jsonb)
    from public.profiles p
  );
end;
$$;

create or replace function public.admin_verify_licence(p_user_id uuid, p_verified boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Staff access required.';
  end if;

  update public.profiles
  set licence_verified = p_verified
  where id = p_user_id;

  if not found then
    raise exception 'User not found.';
  end if;

  return jsonb_build_object('id', p_user_id, 'licenceVerified', p_verified);
end;
$$;

grant execute on function public.admin_users() to authenticated;
grant execute on function public.admin_verify_licence(uuid, boolean) to authenticated;
