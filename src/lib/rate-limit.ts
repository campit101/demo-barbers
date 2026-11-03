// Per-connection limits shared by search, sign-up, sign-in and checkout (CONSTRAINTS.md, "Cost and abuse rules").
// A connection is known only by a salted hash of its address: raw IP addresses are never stored.
// A cheap in-memory count turns away obvious floods before the database; the database count is the real limit,
// shared by every server instance.
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export interface Limit {
  max: number;
  windowSeconds: number;
}

/** The visitor's connection as Vercel reports it (first x-forwarded-for entry, grouped by ipGroup), or "unknown". */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return ipGroup(forwarded || headers.get("x-real-ip")?.trim() || "unknown");
}

/** One connection: an IPv4 address, or an IPv6 /64 (one home or phone usually holds a whole /64). */
export function ipGroup(address: string): string {
  const value = address.trim().toLowerCase().replace(/%.*$/, "");
  if (!value) return "unknown";
  if (!value.includes(":")) return value;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped) return mapped[1]!;
  const [head = "", tail] = value.split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  const groups = tail === undefined ? front : [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return value.slice(0, 64);
  return `${groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(":")}::/64`;
}

/** Salted SHA-256 of the action and address. The salt (IP_HASH_SALT) lives only in .env.local and Vercel. */
export function limitKey(action: string, address: string, salt: string | undefined = process.env.IP_HASH_SALT): string {
  if (!salt) throw new Error("IP_HASH_SALT is not set");
  return createHash("sha256").update(`${salt}:${action}:${address}`).digest("hex");
}

/** Start of the fixed window that `now` falls in. */
export function windowStart(now: Date, windowSeconds: number): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

const memory = new Map<string, number>();

/** Counts one attempt and says whether it is allowed. */
export async function consume(
  db: NodePgDatabase<Record<string, unknown>>,
  key: string,
  limit: Limit,
  now: Date = new Date(),
): Promise<{ allowed: boolean; count: number; retryAfterSeconds: number }> {
  const start = windowStart(now, limit.windowSeconds);
  const retryAfterSeconds = Math.max(1, Math.ceil((start.getTime() + limit.windowSeconds * 1000 - now.getTime()) / 1000));
  const memKey = `${key}:${start.getTime()}`;
  const seen = (memory.get(memKey) ?? 0) + 1;
  memory.set(memKey, seen);
  if (memory.size > 5000) memory.clear();
  if (seen > limit.max) return { allowed: false, count: seen, retryAfterSeconds };
  const { rows } = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, ${start.toISOString()}, 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count`);
  const count = Number(rows[0]?.count ?? seen);
  return { allowed: count <= limit.max, count, retryAfterSeconds };
}

/** Removes finished windows (the nightly job calls this). */
export async function deleteOldLimits(db: NodePgDatabase<Record<string, unknown>>, before: Date): Promise<void> {
  await db.execute(sql`delete from rate_limits where window_start < ${before.toISOString()}`);
}

/** For tests: forget the in-memory counts. */
export const resetMemoryLimits = () => memory.clear();
