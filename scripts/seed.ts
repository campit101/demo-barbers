// Creates the admin accounts and the demo diary.
//   This PC: test database only. Vercel build: whichever database that build uses.
// The owner's password comes from OWNER_PASSWORD (never printed). The demo login's password is public by design.
import { generateId } from "better-auth";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { ensureSeedFresh } from "../src/booking/seed.ts";
import { ACCOUNTS } from "../src/config/shop.ts";
import * as schema from "../src/db/schema.ts";
import { withVerifiedTls } from "../src/db/url.ts";
import { assertTestDatabaseUrl } from "../src/lib/guards.ts";
import { loadEnvLocal } from "./env.ts";

const onVercel = process.env.VERCEL === "1";
loadEnvLocal();
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!onVercel) assertTestDatabaseUrl(url);
if (!url) throw new Error("Database connection string is missing");
const ownerPassword = process.env.OWNER_PASSWORD;
if (!ownerPassword) throw new Error("OWNER_PASSWORD is not set");

const people = [
  { email: ACCOUNTS.owner.email, name: ACCOUNTS.owner.name, role: "owner", password: ownerPassword },
  { email: ACCOUNTS.demo.email, name: ACCOUNTS.demo.name, role: "demo", password: ACCOUNTS.demo.password },
];

const client = new pg.Client({ connectionString: withVerifiedTls(url) });
await client.connect();
try {
  await client.query("begin");
  for (const p of people) {
    const found = await client.query<{ id: string }>(`select id from "user" where email = $1`, [p.email]);
    const id = found.rows[0]?.id ?? generateId();
    const hash = await hashPassword(p.password);
    await client.query(
      `insert into "user" (id, name, email, email_verified, role) values ($1, $2, $3, true, $4)
       on conflict (email) do update set name = excluded.name, role = excluded.role, updated_at = now()`,
      [id, p.name, p.email, p.role],
    );
    const acc = await client.query(`select id from account where user_id = $1 and provider_id = 'credential'`, [id]);
    if (acc.rowCount) await client.query(`update account set password = $2, updated_at = now() where user_id = $1 and provider_id = 'credential'`, [id, hash]);
    else await client.query(`insert into account (id, account_id, provider_id, user_id, password) values ($1, $2, 'credential', $2, $3)`, [generateId(), id, hash]);
  }
  await client.query("commit");
  const rebuilt = await ensureSeedFresh(drizzle({ client, schema }), new Date(), process.argv.includes("--force"));
  console.log(`Accounts ready. Demo diary ${rebuilt ? "rebuilt" : "already fresh"}.`);
} catch (e) {
  await client.query("rollback").catch(() => {});
  throw e;
} finally {
  await client.end();
}
