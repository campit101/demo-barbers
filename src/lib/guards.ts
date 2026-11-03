// Relative import with extension so plain `node scripts/*.ts` can load this file too.
import { createHash } from "node:crypto";
import { NEON } from "../config/shop.ts";

const TEST_KEY = /^(sk|rk)_test_[A-Za-z0-9_]+$/;

/** Returns the key only if it is a Stripe test (sandbox) key. Live mode is never allowed on this project. */
export function assertTestStripeKey(key: string | undefined): string {
  if (!key) throw new Error("Stripe key is missing");
  if (!TEST_KEY.test(key)) throw new Error("Refusing a Stripe key that is not a test key");
  return key;
}

const NEON_HOST = /^(ep-[a-z0-9-]+?)(-pooler)?(\.[a-z0-9-]+)+\.aws\.neon\.tech$/;

export const fingerprint = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex");

/** Throws unless the connection string points at the test database. Every local script that writes data calls this. */
export function assertTestDatabaseUrl(url: string | undefined, known: { test: string; live: string } = NEON): string {
  if (!url) throw new Error("Database connection string is missing");
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("Database connection string is not a valid URL");
  }
  const endpoint = NEON_HOST.exec(host)?.[1];
  const print = endpoint ? fingerprint(endpoint) : null;
  if (print === known.live) throw new Error("Refusing to touch the live database");
  if (print !== known.test) throw new Error("Refusing: not the test database");
  return url;
}
