-- Trip-linked support: customers can attach a booking code when they write in,
-- so staff answer from the inbox with the trip already in context.

alter table public.contact_messages add column if not exists booking_code text;

alter table public.contact_messages drop constraint if exists contact_messages_booking_code_check;
alter table public.contact_messages
  add constraint contact_messages_booking_code_check
  check (booking_code is null or char_length(booking_code) between 4 and 32);

create index if not exists contact_messages_booking_code_idx
  on public.contact_messages (booking_code)
  where booking_code is not null;