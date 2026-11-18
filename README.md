# Rove — premium self-drive car rentals

A complete vehicle-rental storefront and operations console for the Indian market. Customers can search live availability, price a trip, pay with Razorpay, download a voucher/invoice and manage a booking. Fleet managers and super admins get a separate console for bookings, fleet, pricing, promos, hubs and users.

Built with **React 19 + Vite 6 + Tailwind CSS 4**, with **Supabase** (Postgres, Auth, Storage, Edge Functions) as the only backend. **Razorpay** handles payments.

---

## Quick start (zero-config demo)

```bash
npm install
npm run dev
```

No `.env` is required. The app detects missing Supabase keys and runs in **local demo mode**, storing the entire catalogue, users and bookings in `localStorage`. All customer and admin flows work, including simulated card payments.

Open [http://localhost:5173](http://localhost:5173).

### Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Customer | `demo@rove.rent` | `demo123` |
| Fleet manager | `manager@rove.rent` | `manager123` |
| Super admin | `admin@rove.rent` | `admin123` |

Demo checkout uses the test card **4242 4242 4242 4242**, any future expiry and any CVC. The security deposit is simulated. Reset all browser data from **Admin → Settings → Reset demo data**.

> Demo bookings occupy some near-term dates. If a car looks unavailable, choose the dates from the checkout screen or use a far-future range such as **10–13 June 2027**.

---

## Features

### Customer experience

- Editorial landing page with a live hero booking widget (including one-tap quick-date presets), a "recently viewed" strip for returning visitors, fleet categories, value props, reviews, FAQ, location map and trust badges.
- Fleet browsing with search, price range, category, transmission, seats, fuel, AWD and hub filters plus sorting and date-aware availability. Switch between grid, list and a live hub coverage map; selecting a pin filters the fleet to that hub.
- Vehicle detail pages with gallery, specs, features, protection tiers, fuel/insurance policy, driver requirements, reviews (rating distribution with screen-reader labels and a show-all toggle for deeper history), a 30-day nightly price explorer (weekend/seasonal nights highlighted, tap a day to start your trip there) and similar vehicles that carry your dates over.
- Four-step checkout: trip → extras/protection → driver and licence → payment. Server-authoritative pricing, promo codes, deposit or full payment, GST and one-way fees. Every step validates inline, moves focus to the first problem, and links each error to its field; a persistent live region announces price updates and the final due-now amount, a rejected promo never vanishes behind a re-quote, and the payment sheet focuses the card field and releases its lock on close. On mobile, a sticky summary bar keeps the total and the next-step action in reach.
- Instant confirmation with a status-accurate hero (confirmed, pending, active, completed, cancelled or rejected), printable voucher/invoice/transaction history, and a calendar (`.ics`) download with separate one-hour pick-up and drop-off events. Closed bookings show no deposit due, and print styles keep only the voucher/invoice cards.
- Guest checkout and booking lookup by code + email, including reopening a booking after signing out with the account email. `/manage?code=…` auto-loads when an email is known, wrong codes and wrong emails stay indistinguishable, and cancelling a booking made under an account requires that account (guest bookings can be cancelled with the verified code + email).
- Customer account: trips (the active trip pinned first, honest empty states, retry when the list fails to load), notifications (booking confirmations, cancellations, refunds and trip updates with unread badge and mark-all-read), invoices, saved vehicles, payment methods and profile, with online cancellation (refund preview, clear no-payment copy), post-trip reviews (validated, focus-managed), driving-licence upload for KYC review, inline profile validation and per-event notification preferences.
- About and contact pages with a working support form (that can come pre-linked to a booking code from your trips), plus an installable PWA (manifest, app icons and offline shell).
- Auth: sign-up, sign-in, password reset, protected routes and suspended-account handling.
- Legal pages for rental terms, privacy, age/licence rules and damage liability.
- **Search anywhere**: press **⌘K** (Ctrl+K on Windows) — or the Search button in the header — to open the storefront command palette and jump to pages, hubs, vehicle types, recently viewed vehicles or account actions. Results are grouped by section, and every label lives in Admin → Content.
- **Compare vehicles**: add up to three cars or bikes to a shortlist from any card or vehicle page, keep it in a sticky tray while browsing, and open the `/compare` table to see price, tax note, space, gearbox, fuel, rating, trips and highlights side by side. The shortlist is stored per device, is pruned automatically when a vehicle disappears from the catalogue, and the whole feature can be turned off from Admin.
- **Trip ideas (`/routes`)**: curated route cards (one-way and round trips between hubs) with a “Build your own” trip search. The route list is edited from Admin → Content, and each card drops the pick-up/drop-off hubs straight into Browse with live availability.
- **Remember my trip**: every search is remembered on the device, the search widget prefills with your last hubs/dates next visit, Browse offers a “Your last search” resume strip, and **Book again** on past trips carries the remembered pickup/drop-off straight into the vehicle page. Admin can switch the whole thing off and rewrites the copy.
- **Hub directory (`/hubs`)**: every pick-up hub with address, hours, phone, live vehicle count and “from” price, plus one-tap **See cars** per hub. The page copy is Admin-controlled.
- **Saved searches**: bookmark a hub/dates/kind combination from Browse, give it a name, and jump straight back to it with one tap from the saved-searches drawer.
- **Notification preferences**: a customer can switch updates per event type (booking confirmed, trip updates, cancellations & refunds, offers & promos) from the account profile; prefs are stored on the profile and exposed by both the demo and Supabase adapters.
- **Change trip, self-serve**: customers request date/hub/time changes on upcoming bookings with a live, server-authenticated price preview; staff approve (booking is repriced + a trip-change entry is recorded) or decline with a reason — both sides notified, and the whole feature is an Admin toggle with its own copy group. The pending request surfaces in the account, the confirmation page, and a dedicated “Change requests” filter + banner in Admin Bookings.
- **Availability alerts**: signed-in customers can save a “notify me when it’s free” watchlist on any vehicle (dated window), see it in the account, and remove it. Matching is server-model-driven: when a booking is cancelled, dates change, or an availability block is released, the freed window is matched against every live alert, the customer is notified in-app and by email, and the alert is stamped so it can never be sent twice. Admin → Calendar adds a **Waitlist demand** panel with every watched window, a “ready” queue and one-click notify (all or one); the customer account switches to **Free for your dates — book it** with a deep link that opens the pre-filled watch dialog. The watchlist remains an Admin toggle with its own copy, and live self-serve cancellations are covered by the same dispatcher.
- **Help panel**: a floating “Need a hand?” button on every storefront page with call/email/WhatsApp — and a booking-scoped “Message us about {code}” link on confirmation and manage screens.

### Operations console (`/admin`)

- Dashboard: revenue, bookings, utilisation, fleet health, status mix, today's pick-ups & returns, a live staff-event feed, top vehicles and recent activity, plus a deep **analytics** band (revenue/cash/bookings trends, 14-day pipeline, category donut, hub ranking, weekday + pick-up-time heatmap, fleet health, promo performance, KPI cards with sparklines and clicks through to the full **Analytics command center** at `/admin/analytics` — window-switchable money analytics (recognised revenue, cash captured, **GST stream**, outstanding balances, **deposit float**), a **Deposits & returns** section (held vs released vs deducted, damage/late/cleaning charges by reason, extra-due beyond the deposit, overdue returns), demand charts, **waitlist demand** (watching / free now / notified, most-watched vehicles), and mix by count **and revenue** for categories and hubs, plus a **fleet maintenance** section (overdue/due, spend YTD and 90-day, six-month spend, work-type and vendor rankings, workshop load and the vehicles needing a slot), all with one-click CSV export). Charts are dependency-free responsive SVG with accessible text summaries, and analytics is an Admin toggle with its own copy group.
- **Handover desk (`/admin/desk`)**: the daily ops screen in two tabs. **Pick-ups** — today and the next seven days, grouped by date, with a per-booking checklist (licence on file, driver age vs minimum, insurance tier, payment state, deposit due at pick-up), staff confirmation toggles persisted per booking, contact shortcuts, and a gated **Start trip** that only enables once the handover is ready. **Returns** — every active trip and every completed-but-unsettled trip (so a deposit is never forgotten), with drop-off/overdue badges, a return checklist (keys, fuel, walk-around, cleaning, settlement agreed), an inspection form (fuel level, damage severity/amount, cleaning fee, late-fee-per-day, note), a **live deposit-settlement preview**, and a confirm-gated **Settle deposit** that completes the trip, releases/charges the deposit, returns the vehicle to the fleet, queues the `deposit_settled` email, notifies the customer and audits the change. Late fees are only charged to *today* while a trip is still out — completed trips use their recorded completion date. Both checklists are one pure, tested module shared by both adapters.
- Bookings: search/filter, pick-up date-window quick filters (today, next 7 days, this month), **bulk approve/reject** for pending rows (with a shared reason — each customer is notified), approve, reject, cancel, mark on rent/completed, edit dates, hubs and times with automatic repricing, record a staff cancellation reason, internal notes, full refunds, deny-list filters for change requests, CSV export of the current view and a direct link to the customer voucher.
- Finance & GST: date-range invoice register (with a reconciliation totals row and booking deep links), GST split by rate, captured payments and refunds, outstanding balances, deposits due at pick-up, CSV exports for invoices and payments, and an inline warning when the range is inverted.
- Availability: month calendar with maintenance, private-use, buffer and other blocks (each with its own legend colour). Booked cells and the month's booking list link straight to `/admin/bookings?code=…`, which opens that booking's drawer and clears the param. The block modal validates live — an overlapping booking/block or an end date before the start disables Save and names the clash before the server is asked. Blocks are enforced in quotes, browse, checkout and booking writes, and are protected by both a friendly trigger and a concurrency-safe exclusion constraint.
- Audit log: append-only history of staff changes across bookings, fleet, pricing, content, users, settings and availability, with before/after details, filters and super-admin-only access.
- Fleet: create/edit/delete vehicles, multi-image URLs or Storage uploads, status, pricing, features and merchandising, **bulk status changes** (available / on rent / in service) across selected rows, and a **real maintenance snapshot** driven by each vehicle’s odometer, last-service baseline and service intervals. The header shows the review-weighted fleet rating across all trips, and each rating cell carries its review count and links straight to that vehicle’s filtered reviews. `Featured` vehicles fill the homepage first in `display order`, and an optional card `badge` (for example “Staff pick”) appears on the customer card.
- **Maintenance & service (`/admin/maintenance`)**: an urgency-ranked service board for every vehicle, precise due/overdue bands from distance and calendar wear, per-vehicle lifetime spend and workshop visits, service history with cost and vendor, odometer updates, admin-only correction of mistaken entries, CSV export of the current board, and return-to-service. Workshop downtime is scheduled through the existing availability blocks, so the calendar stays authoritative and quotes/bookings cannot slip through. Logging a resetting service moves the baseline atomically; repairs and bodywork only move the odometer. Every write is audited.
- **Comms (`/admin/comms`)**: edit and live-preview every transactional email (subject + body with `{code}`, `{name}`, `{dates}`, `{amount}`, `{hub}`, `{time}`, `{reason}` placeholders) **and the two outreach templates** (`winback_offer`, `customer_message`) used by the Customers CRM. Overrides are stored as settings — the demo adapter renders them as messages queue, and the Supabase notify dispatcher reads the same keys. The editor tracks unsaved changes per template (saving one row never discards edits in the others), offers one-click restore for subject *and* body, flags unknown placeholders such as `{nmae}` before they reach a customer, shows live character counts and a jump-to list, and requires a non-empty subject and body.
- Pricing: extras, protection tiers (labels, daily price, deductible and availability), promo codes, seasonal windows, tax, deposit, security deposit, one-way fee and rental limits. Rate rules are validated by one shared module (`src/lib/rateRules.js`) used by this page, Settings and both adapters, so the same limits and messages apply everywhere and an invalid patch is rejected before it reaches storage. The form tracks unsaved changes, focuses the first invalid field, and names the configured tax label. Promo cards report their real state — Active, Off, Expired or Used up — with full-year expiry dates, and every create/edit form validates inline with associated labels.
- Locations: hub CRUD with city, address, coordinates and contact details, with every field label associated for screen readers.
- **Customers (`/admin/customers`)**: a Customer 360 read model computed by one pure shared function — registered customers **and** guest checkouts, each with lifetime value, completed vs total trips, average value, last/next trip, favourite category and hub, **value segment** (VIP / Repeat / Active / Prospect / Lapsed / Dormant) and **churn risk** (low / watch / at risk). Segment mix donut, top-customers-by-LTV ranking, searchable/filterable/sortable table, **select-to-email bulk outreach** with per-customer `{name}` merge, plain CSV export, and a one-click win-back cohort that uses the editable Comms templates.
- Users: role assignment (customer / fleet manager / super admin), suspension, licence-scan review, a last-admin safeguard and CSV export.
- Content: every customer-facing string — hero copy/imagery, navigation and footer links, page headings across Home, About, Contact, Terms, Privacy, Browse, Vehicle detail, Checkout, Auth, Account, Manage booking, 404 and Confirmation, search-widget and filter labels, the ⌘K search palette, the vehicle-comparison tray and table, the /routes trip-ideas page, the /hubs directory, the saved-searches and trip-memory labels, the help panel and the notification-preference copy, form labels/placeholders, payment-sheet copy, empty states, cancellation and review modals, trust badges, testimonials, FAQs, contact details, social links, SEO titles and sharing defaults — plus every customer-facing policy and the curated route list, with validation and a reset-to-defaults flow. A section jump bar reaches each area of the long form; the 1,000+ page-copy strings have their own search (label, key or current copy) with a live match count, and any edited string offers a one-tap “Reset to default”. Unsaved work is tracked precisely, can be discarded after confirmation, and follows you on mobile through a sticky publish bar; the first invalid field is focused on save, modal editors validate inline, and a failed load offers a retry instead of an endless skeleton. Page copy supports `*italics*` and the live placeholders `{deposit}`, `{refund}`, `{hubs}`, `{hours}` and `{email}`; modal and status templates also fill live values such as `{code}`, `{policy}`, `{window}`, `{amount}`, `{percent}` and `{email}`.
- Settings: tax rate, tax label, pricing mode (added at checkout or included in listed prices), which components are taxable (rental, extras, protection, one-way fee), invoice tax note, invoice prefix, deposit, security deposit, one-way and seasonal pricing, booking auto-confirm, currency status, integrations, appearance and demo-data reset. Appearance controls the accent preset, corner radius, motion level and whether Browse offers the hub map. Legal name, GSTIN and registered address stay in Content. Validation is the single source of truth (native browser bubbles are disabled) and the rate-rule half is shared with Pricing (`src/lib/rateRules.js`): errors name the configured tax label, a season needs both dates or neither, the first invalid field is focused immediately, fixing a field clears its warning at once, and a sticky save bar keeps the action reachable on phones and tablets.
- Inbox: contact-form messages with new/read/resolved states, private staff notes, email reply links, trip-linked messages (booking code shown and searchable) and delete. An unread badge in the console sidebar updates live as messages are triaged. Keyboard triage: **J/K** walk the visible queue (auto-marks read, keeps the row in view), **R** opens the reply, **/** jumps to search and **Esc** closes the reader — all suppressed while typing or when a modal is open.
- Reviews: a moderation workspace — average rating, star-spread bars and a "needs attention" count (≤2 stars), search across customer/vehicle/booking/text, rating filters (5/4/3/≤2), four sort orders, booking deep links, and a final delete flow (removals are audited). The summary band follows the current scope, so opening one vehicle's reviews (via `?vehicle=` from Fleet, with a removable chip) shows that vehicle's rating, spread and five-star share rather than the fleet's.
- Feature toggles for bikes, guest checkout, customer reviews, vehicle comparison, remember-my-trip, self-serve trip changes and dashboard analytics, plus admin-controlled minimum rental length, maximum advance booking window, cancellation window/refund percentage, late fees and fuel fees. Customers can also control their notification preferences per event type from the account.
- Role guards: fleet managers cannot open Finance, Users, Content or Settings; customers cannot open the console. Rate rules are review-only for fleet managers — they edit in super-admin-only Settings.
- Console search: press **⌘K** (Ctrl+K on Windows) anywhere in the console to open the command palette — type to jump to any page or quick action, filtered by your role. The storefront has the same palette with pages, hubs, vehicle types, recently viewed vehicles and account actions.

### Platform

- Row Level Security on every table, security-definer RPCs for quotes and booking access, and GiST exclusion constraints that make double-booking and overlapping availability blocks impossible at the database level.
- Transactional emails (confirmation, cancellation, refunds, trip status) are queued on booking events and drained by the `notify` dispatcher via Resend — checkout never waits on the email provider.
- Server-side price recalculation in Postgres and again inside the Razorpay Edge Functions; the browser total is never trusted. The public quote RPC is block-aware and the internal core function is not executable by `anon` or `authenticated`.
- Each booking stores both the GST rate and whether tax was included at pricing time, so the finance register and customer invoice stay accurate after the admin changes the current tax settings. Invoice numbers combine the admin prefix with the booking code.
- Razorpay signature verification, idempotent payment handling, automatic refunds and promo usage accounting.
- Signed Razorpay webhook reconciliation for captured payments interrupted by a closed tab, with automatic refunds when the dates or price no longer hold.
- Notification queue and a Resend-backed dispatcher (optional `notify` Edge Function) for payment-recovery and failure alerts.
- SEO: per-route titles/descriptions/canonicals, JSON-LD for the business and vehicle detail pages, `robots.txt`, sitemap and `noindex` on private routes.
- Route-level code splitting, keyboard focus states, skip link and Lighthouse 100/100/100 (accessibility, best practices, SEO) on the landing page.

---

## Production setup

### 1. Create a Supabase project

Create a project at [supabase.com](https://supabase.com), then copy the project URL and **anon** key.

### 2. Run the migrations

Using the Supabase CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Or paste these files, in order, into the SQL editor:

1. `supabase/migrations/202610200001_init.sql` — schema, triggers, RPCs, RLS, storage policies.
2. `supabase/migrations/202610200002_seed_catalog.sql` — demo fleet, hubs, extras, insurance tiers, promos and settings.
3. `supabase/migrations/202610200003_bikes.sql` — bike fields and expanded vehicle types.
4. `supabase/migrations/202610200004_webhook_kyc_contact.sql` — webhook ledger, checkout intents, contact messages, notifications, licence storage and operations columns.
5. `supabase/migrations/202610200005_kyc_review.sql` — staff-only licence verification and KYC fields on the admin users feed.
6. `supabase/migrations/202610200006_contact_inbox_quote_rules.sql` — contact inbox workflow, cancellation context, content defaults and quote rules for minimum/advance windows and the bike toggle.
7. `supabase/migrations/202610210001_vehicle_blocks_audit_logs.sql` — availability blocks, block/booking conflict guards, block-aware quoting and the append-only staff audit log.
8. `supabase/migrations/202610210002_finance_invoices.sql` — GST rate per booking, invoice prefix and tax-label settings, and the finance-ready booking serializer.
9. `supabase/migrations/202610210003_day_rates.sql` — the server-authoritative nightly price explorer RPC with the same weekend/seasonal arithmetic as quoting.
10. `supabase/migrations/202610210004_booking_contact.sql` — optional booking code on support messages so staff answer with the trip in context.
11. `supabase/migrations/202610210005_notifications.sql` — the in-app notifications inbox: customer trip updates and a staff operations feed with owner/staff RLS.
12. `supabase/migrations/202610210006_review_moderation.sql` — review moderation policies and staff delete flow.
13. `supabase/migrations/202610220001_appearance_settings.sql` — seeded theme accent, corner radius, motion level and hub-map toggle.
14. `supabase/migrations/202610220002_tax_booking_fleet_controls.sql` — tax pricing mode and taxable-component settings, per-booking tax-mode snapshot, booking auto-confirm, vehicle featured/order/badge columns and the tax-aware quote engine.
15. `supabase/migrations/202610220003_security_deposit_due_at_pickup.sql` — security deposit captured per booking and due at pick-up (no online pre-authorisation).
16. `supabase/migrations/202610220004_notification_prefs.sql` — per-customer notification preferences stored on the profile.
17. `supabase/migrations/202610220005_booking_change_requests.sql` — self-serve trip changes: `change_request`/`trip_changes` columns and security-definer RPCs for requesting, withdrawing and staff-approving/declining changes.
18. `supabase/migrations/202610220006_desk_checks.sql` — handover-desk checklist state (`desk_checks`) exposed through the booking serializer.
19. `supabase/migrations/202610220007_availability_alerts.sql` — per-customer “notify me when it’s free” watchlist with owner-scoped RLS.
20. `supabase/migrations/202610220008_returns_deposit_settlement.sql` — drop-off return checklist, inspection record and immutable deposit settlement on each booking, exposed through the shared booking serializer.
21. `supabase/migrations/202610220009_availability_alert_dispatch.sql` — match metadata + staff update policy for the watchlist dispatcher, with a window index for fast matching at scale.
22. `supabase/migrations/202610220010_fleet_maintenance.sql` — vehicle odometer/service-baseline columns, the staff-only `vehicle_service_logs` workshop history, RLS, baseline/odometer sync, validation and audit triggers.
23. `supabase/migrations/202610220011_booking_serializer_lockdown.sql` — revokes direct execution of the internal `booking_json` serializers from `public`, `anon` and `authenticated`, keeping them reachable only through checked security-definer RPCs.
24. `supabase/migrations/202610220012_availability_strip.sql` — public `vehicle_busy_days` RPC returning only busy dates + coarse reasons (booked / block:kind), powering the vehicle page "availability for the next 30 days" strip without leaking booking identity.

The seed migration is optional for a production catalogue but is required if you want the seeded demo fleet. Bikes are modelled in the schema; add bike rows from Admin → Fleet or seed them for your own catalogue.

> Before the first deploy — and after changing SQL, RPCs or RLS — run `npm run check`. It executes the demo contracts (including the compare-shortlist and command-palette unit tests), applies every migration to a throwaway Postgres cluster, checks block quoting, conflict guards and function ACLs, then builds the production bundle. CI runs the same commands.

### 3. Configure the browser environment

```bash
cp .env.example .env
```

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_ENABLE_DEMO=false
```

Restart Vite after changing env values. `VITE_ENABLE_DEMO=true` forces demo mode even when Supabase keys are present.

### 4. Create the demo accounts (optional)

Add the service-role values to `.env`:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

```bash
npm run seed:users
```

This creates the three accounts and assigns their roles. **Never expose the service-role key to the browser** and change the demo passwords before going live.

### 5. Deploy the Razorpay Edge Functions

Set the function secrets:

```bash
supabase secrets set RAZORPAY_KEY_ID=rzp_live_xxxxxxxx
supabase secrets set RAZORPAY_KEY_SECRET=xxxxxxxxxxxx
supabase secrets set RAZORPAY_WEBHOOK_SECRET=xxxxxxxxxxxx
supabase secrets set NOTIFY_SECRET=xxxxxxxxxxxx
# Optional email dispatcher:
# supabase secrets set RESEND_API_KEY=re_xxxxxxxx
# supabase secrets set ROVE_FROM_EMAIL='Rove <bookings@your-domain.com>'
```

Deploy:

```bash
supabase functions deploy razorpay-order
supabase functions deploy razorpay-verify
supabase functions deploy razorpay-refund
supabase functions deploy razorpay-webhook
supabase functions deploy notify
```

Point a Razorpay webhook at `https://<project-ref>.supabase.co/functions/v1/razorpay-webhook` for `payment.captured`, `payment.failed` and `refund.failed`, using the same `RAZORPAY_WEBHOOK_SECRET`. The `notify` function is server-to-server only and requires the `x-notify-secret` header; invoke it from a scheduler (for example a Supabase cron job) if you want queued emails delivered.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into functions automatically. The functions are configured with `verify_jwt = false` in `supabase/config.toml` so **guest checkout and guest cancellation work without a Supabase session**. Authorisation happens inside the functions: payments are verified with the Razorpay HMAC signature and amount, while cancellations require a matching signed-in owner, active staff role, or the guest email on the booking. Signed-in requests still send their access token so bookings are attached to the account. If you deploy without the CLI config, pass `--no-verify-jwt`.

Razorpay orders use **automatic capture**. Amounts are stored as integer rupees in Postgres and converted to **paise** only at the Razorpay boundary.

### 6. Deploy the frontend

```bash
npm run build
```

Deploy `dist/` to any static host (Vercel, Netlify, Cloudflare Pages, S3 + CDN). Configure an **SPA fallback** so unknown paths serve `index.html`:

- Netlify: `/* /index.html 200`
- Vercel: rewrite all paths to `/index.html`
- Nginx: `try_files $uri $uri/ /index.html;`

Update the canonical/sitemap domain (`https://rove.rent`) and the JSON-LD business details in `index.html` / `public/` for your own domain.

### 7. Storage (optional)

The migrations create a public `vehicle-images` bucket with staff-only write policies. Admin → Fleet can upload JPG/PNG/WebP files (max 5 MB in production), or you can paste external image URLs.

A private `licences` bucket stores customer KYC scans. Customers can upload and replace their own image; only staff can read all scans and change the verification flag. Verify or revoke a licence from **Admin → Users → Licence**.

---

## How payment and booking creation work

1. The browser calls `razorpay-order` with the checkout draft.
2. The function validates the draft, recalculates the quote through `quote_rental`, checks availability, then creates a Razorpay order for `amountDue`.
3. Razorpay Checkout collects the payment and returns `razorpay_order_id`, `razorpay_payment_id` and `razorpay_signature`.
4. `razorpay-verify` verifies the HMAC signature, fetches the payment, confirms the order/amount, creates the booking, records the payment and the ₹5,000 security deposit, increments promo usage and returns the booking code.
5. `razorpay-refund` handles customer cancellations under the admin-configured window and refund percentage (default: full refund ≥48h before pick-up, 50% inside 48h) and staff refunds. Refunds go back to the original Razorpay payment.
6. If the browser closes before step 4, the signed `razorpay-webhook` recovers the booking from the server-side checkout intent. It re-quotes the trip and automatically refunds if the dates were taken or the amount no longer matches.
7. The GiST exclusion constraint rejects a second overlapping booking even if two checkouts race. The Edge Function refunds automatically if the insert fails.

Customer cancellation uses the same configurable policy from the UI and the Edge Function. Staff can cancel with a full refund, and can also issue a full refund after cancelling if the refund box was left unchecked.

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Preview the production build |
| `npm run test:demo` | Contract tests for quoting, checkout, cancellation and admin mutations (Node, no browser required) |
| `npm run test:sql` | Apply all migrations to a throwaway Postgres cluster and assert block quoting, finance settings, conflict guards, maintenance baselines and ACLs |
| `npm run check` | Run demo tests, SQL validation and the production build |
| `npm run seed:users` | Create the three demo accounts in a real Supabase project |

`npm run test:demo` resets the in-memory demo state, so it never touches your browser's real demo data.

---

## Project structure

```text
src/
  components/       shared UI, navbar/footer, booking widget, payment sheet, guards, command palettes, compare tray
  context/          auth, catalogue metadata and toast providers
  demo/             localStorage fixtures and demo adapter (loaded only in demo mode)
  lib/              API loader, Supabase adapter, pricing, finance/GST, formatting, meta, calendar
  pages/            customer pages and the /admin console (including Availability, Finance and Audit)
  App.jsx           routing, layouts, route metadata and lazy loading
supabase/
  functions/        Razorpay order/verify/refund/webhook, notify, and shared helpers
  migrations/       schema, RPCs, RLS, constraints, KYC, blocks, audit and seed catalogue
public/             favicon, PWA manifest/service worker, robots.txt, sitemap.xml
scripts/            demo contracts, SQL migration validation, icon generation and user seeding
```

The API surface lives in `src/demo/api.js` (demo) and `src/lib/supabaseApi.js` (production); `src/lib/api.js` loads only the selected adapter before React mounts. Both return the same camelCase shapes, so pages never branch on the backend.

Admin analytics exports are byte-for-byte identical between Dashboard and Analytics: `src/lib/analyticsCsv.js` builds the range-aware CSV (last N daily rows plus weekday/hub/category mixes under one 12-column header), and a contract test pins its shape.

Customer-facing helpers that are pure and contract-tested: `src/lib/availabilityStrip.js` (next-30-day free/booked cells for the vehicle detail strip, shared by demo + Supabase RPC data), `src/lib/tripProgress.js` (milestone + closed-state derivation for the voucher stepper) and `src/lib/compare.js` decision heuristics (`rowWinnerIndex`, `cheapestVehicleId` — ties are never claimed as winners). Saved searches carry the full filter set (`filters` alongside the URL params) so a saved view restores exactly what was on screen; browse chip filters are also mirrored into the URL (canonical round-trip) so Back/Forward and shared links restore the filtered view. The analytics engine exposes a read-only no-show signal (confirmed bookings whose pick-up day passed unstarted) on the dashboard needs-attention line and the Analytics page. Demand is covered at both ends of the trip: pick-up *and* return (slot × weekday) heatmaps plus by-hour pick-up/drop-off bars, and the customer view splits recognised revenue between first-time and returning riders (with repeat-trip counts) alongside a completed-trip-length distribution (1 / 2–3 / 4–7 / 8–14 / 15+ days). Admin reload races are guarded by the shared `useRequestGuard` hook across Bookings, Fleet, Desk, Returns, Customers, Maintenance, Calendar, Finance, Inbox, Reviews and Audit. Operators never lose typed work: the Fleet vehicle and Bookings drawers ask "Discard unsaved changes?" before closing a dirty form (Bookings derives dirties from a live comparison to the loaded booking — no flag bookkeeping), and the dialog layer restores the page's original scroll lock when the last overlay closes (closing a confirm inside a drawer used to leave the page stuck). Vehicle pages carry a one-tap share button that copies a deep link (falling back to a copyable toast when the clipboard is unavailable).

---

## Pricing rules

Seeded settings (financial defaults in Admin → Settings; booking rules and policy copy in Admin → Content):

- GST: **18%**, displayed as **GST**, added at checkout by default, with invoice numbers prefixed **INV/26-27/**. Rental, extras, protection and one-way fees are taxable unless an admin switches a component off.
- Booking auto-confirm: **on**; switch it off to capture payment and hold every booking as `pending` until staff approve it.
- Fleet merchandising: the first four seeded vehicles are featured in homepage order with sample badges.
- Deposit: **25%** of the total
- Weekend multiplier: **1.15×** (Friday, Saturday, Sunday nights)
- Seasonal multiplier: **1.25×** (15 Dec – 5 Jan)
- One-way fee: **₹1,500**
- Refundable security deposit: **₹5,000**
- Minimum driver age: **21**, minimum bike rider age: **18**, maximum rental: **45 days**
- Minimum rental: **1 day**, maximum advance booking window: **365 days**
- Cancellation window: **48 hours**; refund inside the window: **50%** (100% outside it)
- Bikes, guest checkout and customer reviews can each be switched off from Admin → Content.

Legal page bodies stay code-driven so they can interpolate the live policy (tax mode and label, deposit, refund window, one-way and fuel fees, insurance deductibles, company details). Their headings, intro copy and “last updated” date are editable in Admin → Content, as are the About, Contact and homepage copy, navigation, footer and SEO defaults.

Appearance is also admin-controlled in Admin → Settings: six accent presets, three corner-radius scales, a calm-motion switch and a hub-map toggle. The choice is stored as normal settings (`theme_accent`, `theme_radius`, `theme_motion`, `map_view_enabled`) and applied through CSS variables, so the storefront and console repaint together without a rebuild. The calm-motion switch mirrors the OS reduced-motion behaviour. The map plots admin-managed hub coordinates and filters the fleet client-side, so it never implies per-vehicle location data.

Seeded promo codes: `FIRST10`, `WEEKEND15`, `AUTUMN20`, `ROVE1500`.

Weekend and seasonal multipliers use the **greater** of the two for each night. Promo discounts apply to the rental base before GST. Extras and protection are charged per rental day.

---

## Security notes

- RLS is enabled on every table. Customers only see their own bookings, payments and favourites; catalogue reads are public; staff/admin writes are role-gated.
- The service-role key exists only inside Supabase Edge Functions.
- `quote_rental` is the single source of truth for prices. The JS calculator in `src/lib/pricing.js` is used only in demo mode and mirrors the SQL rules. Its internal `quote_rental_core` is revoked from `public`, `anon` and `authenticated`, so callers cannot skip the availability-block check.
- Availability blocks are checked in the public RPCs, checkout and trigger guards. A GiST exclusion constraint prevents two overlapping blocks from being saved even when two admins submit at the same time.
- The audit log is append-only: staff can read it only through the super-admin-only page, no update/delete grants exist, and triggers capture actor, entity, action and before/after values for every staff-editable table.
- Finance data is super-admin-only in the console. The internal `booking_json` serializer is not executable by `anon` or `authenticated`; customers and staff reach it through role-checked RPCs.
- `is_staff()` and `is_admin()` require an **active** profile status, so suspended staff immediately lose console access. The client also signs out suspended sessions.
- The `profiles` trigger prevents non-admins from changing their own role or status.
- The last active super admin cannot be demoted or suspended.

### Current boundaries

- **Security deposit:** the ₹5,000 deposit is due at pick-up and is not charged or pre-authorised online. The amount is snapshotted on each booking (`bookings.hold_amount`), shown separately from the rental payment, and excluded from the captured-payment ledger. A true card pre-authorisation would require Razorpay manual capture plus capture/void handling; the current build uses auto-capture for the rental payment only.
- **Transactional email:** booking vouchers and invoices are generated in the browser and are downloadable/printable. The optional `notify` Edge Function can deliver queued emails through Resend once `RESEND_API_KEY` and a scheduler are configured; no scheduler is included. Supabase Auth still sends sign-up and password-reset emails.
- **Payment recovery:** the signed webhook recovers captured payments if the browser closes before verification. Events are deduplicated in `webhook_events`; permanent failures remain in that ledger with `last_error` for staff review. An unsupported or unverified order still requires manual review.
- **KYC:** licence upload is private and staff-reviewed, but there is no automated document-authenticity or liveness provider. Review the scan and the original licence in person at pick-up.
- **Saved cards:** the account shows the card network and last four digits returned by Razorpay. It does not store reusable card tokens; Razorpay Checkout collects card details on every payment.
- **Sitemap:** `public/sitemap.xml` lists the stable public pages. Generate vehicle URLs from the `vehicles` table in your deploy pipeline if you want every car indexed individually.
- **Real-mode verification:** the demo API is covered by `npm run test:demo`; the schema, block guards, audit triggers and function ACLs are covered by `npm run test:sql`. The Supabase/Razorpay adapters, Storage policies and Edge Functions still require a configured project and Razorpay test keys to exercise end to end.

---

## License

Private project. All brand names, vehicle imagery and copy are placeholders for the Rove demo.
