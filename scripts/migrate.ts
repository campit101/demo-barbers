// Applies the migrations in drizzle/. On this PC it only ever touches the TEST database.
// On Vercel it runs inside the build, against whichever database that deployment uses.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { withVerifiedTls } from "../src/db/url.ts";
import { assertTestDatabaseUrl } from "../src/lib/guards.ts";
import { loadEnvLocal } from "./env.ts";

// Read before .env.local is loaded, so only a real Vercel build counts as Vercel.
const onVercel = process.env.VERCEL === "1";
loadEnvLocal();
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!onVercel) assertTestDatabaseUrl(url);
if (!url) throw new Error("Database connection string is missing");

const client = new pg.Client({ connectionString: withVerifiedTls(url) });
await client.connect();
try {
  await migrate(drizzle({ client }), { migrationsFolder: "drizzle" });
  const { rows } = await client.query<{ count: string }>("select count(*) from drizzle.__drizzle_migrations");
  console.log(`Migrations applied (${rows[0]?.count} in the ledger) on ${onVercel ? `Vercel ${process.env.VERCEL_ENV}` : "the test database"}.`);
} finally {
  await client.end();
}
