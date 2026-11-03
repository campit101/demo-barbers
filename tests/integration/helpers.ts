// Test-database setup. The guard makes it impossible for these tests to run against the live database.
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { loadEnvLocal } from "../../scripts/env.ts";
import * as schema from "../../src/db/schema.ts";
import { bookings } from "../../src/db/schema.ts";
import { withVerifiedTls } from "../../src/db/url.ts";
import { assertTestDatabaseUrl } from "../../src/lib/guards.ts";
import type { Db } from "../../src/booking/service.ts";

loadEnvLocal();
const url = assertTestDatabaseUrl(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);

export const pool = new pg.Pool({ connectionString: withVerifiedTls(url), max: 12 });
export const db: Db = drizzle({ client: pool, schema });

export async function clearBookings(): Promise<void> {
  await db.delete(bookings);
}

/** Tuesday 3 Nov 2026 at noon London time, a fixed "now" so tests do not depend on the day they run. */
export const NOW = new Date("2026-11-03T12:00:00Z");
export const person = { name: "Sam Test", email: "sam@example.com" };
