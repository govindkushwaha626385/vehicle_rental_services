#!/usr/bin/env node
/**
 * Create the three demo accounts in a real Supabase project.
 *
 * Usage:
 *   1. Copy .env.example → .env and add SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *   2. npm run seed:users
 *
 * The service role key bypasses RLS and the profile field guard, so this must
 * only ever be run locally. Never ship it to the browser.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('\nMissing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\nAdd them to .env (see .env.example).\n');
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ACCOUNTS = [
  {
    email: 'demo@rove.rent',
    password: 'demo123',
    name: 'Maya Chen',
    phone: '+91 98765 43210',
    license: 'MH0220210003003',
    role: 'customer',
  },
  {
    email: 'manager@rove.rent',
    password: 'manager123',
    name: 'Sam Okafor',
    phone: '+91 80 5555 0101',
    license: 'KA0120220002002',
    role: 'manager',
  },
  {
    email: 'admin@rove.rent',
    password: 'admin123',
    name: 'Avery Ross',
    phone: '+91 80 5555 0100',
    license: 'KA0120230001001',
    role: 'admin',
  },
];

async function findUserByEmail(email) {
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const found = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function ensureUser(account) {
  const { data, error } = await admin.auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
    user_metadata: { full_name: account.name, phone: account.phone },
  });

  let user = data?.user;
  if (error) {
    if (!/already|registered|exists/i.test(error.message)) throw new Error(error.message);
    user = await findUserByEmail(account.email);
    if (!user) throw new Error(`Could not find existing user ${account.email}`);
  }

  const { error: profileError } = await admin.from('profiles').upsert(
    {
      id: user.id,
      full_name: account.name,
      email: account.email,
      phone: account.phone,
      license_number: account.license,
      role: account.role,
      status: 'active',
    },
    { onConflict: 'id' },
  );

  if (profileError) throw new Error(profileError.message);
  return user;
}

console.log(`\nSeeding demo accounts into ${url}\n`);

for (const account of ACCOUNTS) {
  try {
    const user = await ensureUser(account);
    console.log(`  ✓ ${account.role.padEnd(8)} ${account.email.padEnd(22)} ${account.password}  (${user.id})`);
  } catch (error) {
    console.error(`  ✗ ${account.email}: ${error.message}`);
    process.exitCode = 1;
  }
}

console.log('\nDone. Sign in at /login or the admin console at /admin.\n');
