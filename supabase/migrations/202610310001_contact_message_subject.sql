-- Contact messages carry an admin-editable subject tag so the inbox can be
-- triaged by intent (booking & payment, deposits & refunds, group & corporate,
-- feedback, …) instead of relying on free text. Customers pick it on /contact;
-- staff can re-tag from the inbox. Defaults to 'General' so legacy rows remain
-- sensible, and the value is capped+validated in the adapters.

alter table public.contact_messages
  add column if not exists subject text not null default 'General';

comment on column public.contact_messages.subject is
  'Triage tag the customer picks at submission; staff can re-tag from the inbox.';