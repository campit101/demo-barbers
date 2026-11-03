// The app's database connection: one pooled TCP connection set per server instance (Neon's advice for
// Vercel Functions, read 23 Oct 2026). Server-only: importing this from browser code fails the build.
import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { withVerifiedTls } from "./url";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // A slow or waking database fails a request after a few seconds rather than holding a function open.
  const pool = new pg.Pool({ connectionString: withVerifiedTls(url), max: 5, idleTimeoutMillis: 5_000, connectionTimeoutMillis: 5_000, statement_timeout: 10_000 });
  attachDatabasePool(pool);
  return drizzle({ client: pool, schema });
}

let db: ReturnType<typeof createDb> | undefined;
export const getDb = () => (db ??= createDb());
