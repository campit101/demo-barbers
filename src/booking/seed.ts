// The made-up diary behind "Try the admin". Rebuilt from scratch once it is 24 hours old, so a visitor's clicks never last.
// Conflicts with real bookings are skipped, so seeding can never disturb a visitor's booking.
import { sql } from "drizzle-orm";
import { BARBERS, DATA, SERVICES, depositFor } from "../config/shop.ts";
import { bookings } from "../db/schema.ts";
import { addDaysToKey, londonParts, londonToUtc } from "../lib/time.ts";
import { isClosedDateKey } from "./slots.ts";
import type { Db } from "./service.ts";

const NAMES = ["Sam T", "Priya N", "Owen R", "Jamal A", "Luca B", "Tom W", "Ewan M", "Dan K", "Faisal H", "Rory P", "Ben C", "Niall S"];

function hash(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** A believable week: gaps left open so a customer can still book, lunch blocked off, the same result for the same day. */
export function seedRows(now: Date, days = 14) {
  const today = londonParts(now).dateKey;
  const rows: (typeof bookings.$inferInsert)[] = [];
  for (let i = 0; i < days; i++) {
    const dateKey = addDaysToKey(today, i);
    if (isClosedDateKey(dateKey)) continue;
    for (const barber of BARBERS) {
      rows.push({ kind: "block", barberId: barber.id, startsAt: londonToUtc(dateKey, 780), endsAt: londonToUtc(dateKey, 820), status: "confirmed", isSeed: true, createdAt: now, updatedAt: now });
      let h = hash(barber.id + dateKey);
      let t = 540;
      let n = 0;
      while (t < 1060) {
        const service = SERVICES[h % SERVICES.length]!;
        const gap = [15, 30, 60, 45][(h >>> 3) % 4]!;
        const clash = t < 820 && t + service.minutes > 780;
        if (t + service.minutes <= 1080 && !clash) {
          rows.push({
            kind: "booking",
            reference: `DEMO-${dateKey.replaceAll("-", "").slice(2)}-${barber.id[0]!.toUpperCase()}${n}`,
            barberId: barber.id,
            serviceId: service.id,
            startsAt: londonToUtc(dateKey, t),
            endsAt: londonToUtc(dateKey, t + service.minutes),
            status: "confirmed",
            customerName: NAMES[(h >>> 5) % NAMES.length]!,
            customerEmail: "demo@example.invalid",
            pricePence: service.pricePence,
            depositPence: depositFor(service.pricePence),
            depositStatus: "paid",
            isSeed: true,
            createdAt: now,
            updatedAt: now,
          });
          n++;
        }
        t += clash ? Math.max(service.minutes + gap, 820 - t) : service.minutes + gap;
        h = (h * 17 + 11) >>> 0;
      }
    }
  }
  return rows;
}

/** Rebuilds the demo diary if it is missing or too old. Returns true if it did. An advisory lock stops two rebuilds at once. */
export async function ensureSeedFresh(db: Db, now: Date, force = false): Promise<boolean> {
  const cutoff = new Date(now.getTime() - DATA.seedMaxAgeHours * 3600000);
  return db.transaction(async (tx) => {
    const lock = await tx.execute<{ got: boolean }>(sql`select pg_try_advisory_xact_lock(727201) as got`);
    if (!lock.rows[0]?.got) return false;
    const { rows } = await tx.execute<{ oldest: string | null; n: string }>(sql`select min(created_at) as oldest, count(*) as n from bookings where is_seed`);
    const oldest = rows[0]?.oldest ? new Date(rows[0].oldest) : null;
    if (!force && oldest && oldest > cutoff && Number(rows[0]?.n) > 0) return false;
    await tx.delete(bookings).where(sql`${bookings.isSeed}`);
    const fresh = seedRows(now);
    for (let i = 0; i < fresh.length; i += 100) await tx.insert(bookings).values(fresh.slice(i, i + 100)).onConflictDoNothing();
    return true;
  });
}
