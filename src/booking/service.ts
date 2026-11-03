// Booking rules that touch the database. Every function takes the database and the current time, so tests can pin both.
// Double-booking is stopped by the database's exclusion constraint; this code only turns that refusal into a clear answer.
import { randomBytes } from "node:crypto";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { BARBERS, DATA, LIMITS, SHOP, barberById, depositFor, serviceById } from "../config/shop.ts";
import * as schema from "../db/schema.ts";
import { bookings } from "../db/schema.ts";
import { addDaysToKey, isDateKey, londonParts, londonToUtc } from "../lib/time.ts";
import { bookingDays, isFreeToChange, openSlots, slotProblem, type SlotProblem, type Span } from "./slots.ts";

export type Db = NodePgDatabase<typeof schema>;
export type Booking = typeof bookings.$inferSelect;

const HOUR = 3600000;
const LIVE = sql`('confirmed', 'completed', 'no_show')`;

/** Oldest moment a visitor's row is still visible. Seeded rows are rebuilt separately. */
const retentionCutoff = (now: Date) => new Date(now.getTime() - DATA.retentionHours * HOUR);

/** A row counts only if it is visible: seeded, or under 24 hours old, even before the clean-up has deleted it. */
function visible(now: Date) {
  return sql`(${bookings.isSeed} or ${bookings.createdAt} > ${retentionCutoff(now).toISOString()})`;
}

/** Live rows, plus holds still within their 10 minutes. Expired holds are ignored here with no timer involved. */
function occupying(now: Date) {
  return sql`(${bookings.status} in ${LIVE} or (${bookings.status} = 'held' and ${bookings.holdExpiresAt} > ${now.toISOString()}))`;
}

/** Walks Drizzle's error wrapping to find Postgres's error code. */
function pgCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}
const EXCLUSION_VIOLATION = "23P01";
const isOverlap = (e: unknown) => pgCode(e) === EXCLUSION_VIOLATION;

/** Ids come back from forms and addresses. A malformed one is simply not found, instead of a database error. */
const isId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
function newReference(): string {
  const bytes = randomBytes(6);
  return `DB-${Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join("")}`;
}

/** Busy spans for one barber between two instants. */
export async function busySpans(db: Db, barberId: string, from: Date, to: Date, now: Date): Promise<Span[]> {
  const rows = await db
    .select({ start: bookings.startsAt, end: bookings.endsAt })
    .from(bookings)
    .where(and(eq(bookings.barberId, barberId), lt(bookings.startsAt, to), gte(bookings.endsAt, from), occupying(now), visible(now)))
    .orderBy(asc(bookings.startsAt));
  return rows;
}

export interface DayOption {
  dateKey: string;
  closed: boolean;
}

/** Open start times for a barber, service and London date. Invalid input gives no times rather than an error. */
export async function availability(db: Db, q: { barberId: string; serviceId: string; dateKey: string }, now: Date): Promise<Date[]> {
  const service = serviceById(q.serviceId);
  if (!service || !barberById(q.barberId) || !isDateKey(q.dateKey)) return [];
  const from = londonToUtc(q.dateKey, 0);
  const to = londonToUtc(addDaysToKey(q.dateKey, 1), 0);
  return openSlots(q.dateKey, service.minutes, await busySpans(db, q.barberId, from, to, now), now);
}

/** The first open time for a service with one barber, looking across the booking window. */
export async function firstOpen(db: Db, barberId: string, minutes: number, now: Date): Promise<Date | null> {
  const days = bookingDays(now);
  const from = londonToUtc(days[0]!, 0);
  const to = londonToUtc(addDaysToKey(days.at(-1)!, 1), 0);
  const busy = await busySpans(db, barberId, from, to, now);
  for (const day of days) {
    const slots = openSlots(day, minutes, busy, now);
    if (slots[0]) return slots[0];
  }
  return null;
}

/** "Next free chair": the first 30 minute slot per barber. */
export async function nextFreeChairs(db: Db, now: Date) {
  return Promise.all(BARBERS.map(async (b) => ({ barberId: b.id, start: await firstOpen(db, b.id, 30, now) })));
}

export type HoldResult =
  | { ok: true; booking: Booking; expiredSessionIds: string[] }
  | { ok: false; reason: "taken" | "bad-input" | SlotProblem };

export interface HoldInput {
  barberId: string;
  serviceId: string;
  start: Date;
  name: string;
  email: string;
  /** Salted hash of the connection that asked. Only the same connection may let go of its own earlier hold. */
  holdOwner?: string;
}

/**
 * Takes the slot for 10 minutes. Expired holds and over-24-hour rows in the way are cleared in the same transaction, then
 * the insert either succeeds or the database refuses it. Two people tapping at once cannot both win.
 */
export async function createHold(db: Db, input: HoldInput, now: Date): Promise<HoldResult> {
  const service = serviceById(input.serviceId);
  if (!service || !barberById(input.barberId)) return { ok: false, reason: "bad-input" };
  const problem = slotProblem(input.start, service.minutes, now);
  if (problem) return { ok: false, reason: problem };
  const end = new Date(input.start.getTime() + service.minutes * 60000);
  try {
    return await db.transaction(async (tx) => {
      const expired = await clearOverlappingLeftovers(tx, input.barberId, input.start, end, now);
      // Someone coming back from Stripe with the Back button is not "someone else": let go of their own earlier hold.
      // The email alone is not proof, since anyone can type it; the hold must also have come from the same connection.
      if (input.holdOwner) {
        const own = await tx
          .update(bookings)
          .set({ status: "expired", holdExpiresAt: null, updatedAt: now })
          .where(sql`${overlapping(input.barberId, input.start, end)} and ${bookings.status} = 'held' and ${bookings.customerEmail} = ${input.email} and ${bookings.holdOwner} = ${input.holdOwner}`)
          .returning({ session: bookings.stripeSessionId });
        expired.push(...own.flatMap((r) => (r.session ? [r.session] : [])));
      }
      const [row] = await tx
        .insert(bookings)
        .values({
          kind: "booking",
          reference: newReference(),
          barberId: input.barberId,
          serviceId: input.serviceId,
          startsAt: input.start,
          endsAt: end,
          status: "held",
          holdExpiresAt: new Date(now.getTime() + SHOP.holdMinutes * 60000),
          customerName: input.name,
          customerEmail: input.email,
          holdOwner: input.holdOwner ?? null,
          pricePence: service.pricePence,
          depositPence: depositFor(service.pricePence),
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return { ok: true as const, booking: row!, expiredSessionIds: expired };
    });
  } catch (e) {
    if (isOverlap(e)) return { ok: false, reason: "taken" };
    throw e;
  }
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const overlapping = (barberId: string, start: Date, end: Date) =>
  sql`${bookings.barberId} = ${barberId} and tstzrange(${bookings.startsAt}, ${bookings.endsAt}, '[)') && tstzrange(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, '[)')`;

/** Clears expired holds and invisible old rows that overlap a span. Returns Stripe sessions that should now be expired. */
async function clearOverlappingLeftovers(tx: Tx, barberId: string, start: Date, end: Date, now: Date): Promise<string[]> {
  const overlap = overlapping(barberId, start, end);
  const expired = await tx
    .update(bookings)
    .set({ status: "expired", holdExpiresAt: null, updatedAt: now })
    .where(sql`${overlap} and ${bookings.status} = 'held' and ${bookings.holdExpiresAt} <= ${now.toISOString()}`)
    .returning({ session: bookings.stripeSessionId });
  await tx.delete(bookings).where(sql`${overlap} and not ${bookings.isSeed} and ${bookings.createdAt} <= ${retentionCutoff(now).toISOString()} and ${bookings.depositStatus} <> 'refund_pending'`);
  return expired.flatMap((r) => (r.session ? [r.session] : []));
}

export async function getBooking(db: Db, id: string): Promise<Booking | null> {
  if (!isId(id)) return null;
  const [row] = await db.select().from(bookings).where(eq(bookings.id, id));
  return row ?? null;
}

export const isVisible = (b: Booking, now: Date) => b.isSeed || b.createdAt.getTime() > retentionCutoff(now).getTime();

export async function attachSession(db: Db, id: string, sessionId: string, now: Date): Promise<void> {
  await db.update(bookings).set({ stripeSessionId: sessionId, updatedAt: now }).where(eq(bookings.id, id));
}

/** Lets go of a hold the moment someone backs out of paying, or Stripe's session ends. Only ever touches a hold. */
export async function releaseHold(db: Db, id: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(bookings)
    .set({ status: "expired", holdExpiresAt: null, updatedAt: now })
    .where(and(eq(bookings.id, id), eq(bookings.status, "held")))
    .returning({ id: bookings.id });
  return rows.length > 0;
}

export type SettleResult =
  | { state: "confirmed" | "already"; booking: Booking }
  /** Paid, but someone else now has the time: the deposit must go back. */
  | { state: "lost"; booking: Booking }
  /** Paid, but the row is gone or belongs to another session: the deposit must go back. */
  | { state: "missing" };

/**
 * Records a successful payment. Safe to call any number of times, from the webhook or the return page, in either order:
 * the row lock serialises them and only the first changes anything.
 */
export async function settlePaid(db: Db, p: { bookingId: string; sessionId: string; paymentIntentId: string | null }, now: Date): Promise<SettleResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(bookings).where(eq(bookings.id, p.bookingId)).for("update");
    if (!row || (row.stripeSessionId && row.stripeSessionId !== p.sessionId)) return { state: "missing" as const };
    if (row.depositStatus !== "none") return { state: "already" as const, booking: row };
    const paid = { depositStatus: "paid" as const, stripeSessionId: p.sessionId, stripePaymentIntentId: p.paymentIntentId, updatedAt: now };
    if (row.status === "held") {
      const [done] = await tx.update(bookings).set({ ...paid, status: "confirmed", holdExpiresAt: null }).where(eq(bookings.id, row.id)).returning();
      return { state: "confirmed" as const, booking: done! };
    }
    // The hold ran out before Stripe finished. Take the time back if it is still free, otherwise refund.
    try {
      const [done] = await tx.transaction(async (inner) => inner.update(bookings).set({ ...paid, status: "confirmed", holdExpiresAt: null }).where(eq(bookings.id, row.id)).returning());
      return { state: "confirmed" as const, booking: done! };
    } catch (e) {
      if (!isOverlap(e)) throw e;
      const [lost] = await tx
        .update(bookings)
        .set({ stripeSessionId: p.sessionId, stripePaymentIntentId: p.paymentIntentId, depositStatus: "refund_pending", status: "cancelled", outcome: "late-payment-lost-slot", updatedAt: now })
        .where(eq(bookings.id, row.id))
        .returning();
      return { state: "lost" as const, booking: lost! };
    }
  });
}

export type CancelResult =
  | { ok: true; refund: boolean; booking: Booking }
  | { ok: false; reason: "not-found" | "not-active" | "already-started" };

/** A customer cancels. Free 24 hours or more before, with the deposit going back; later, the deposit is kept. */
export async function cancelBooking(db: Db, id: string, now: Date): Promise<CancelResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(bookings).where(eq(bookings.id, id)).for("update");
    if (!row || !isVisible(row, now)) return { ok: false as const, reason: "not-found" as const };
    if (row.kind !== "booking" || row.status !== "confirmed") return { ok: false as const, reason: "not-active" as const };
    if (row.startsAt.getTime() <= now.getTime()) return { ok: false as const, reason: "already-started" as const };
    const refund = isFreeToChange(row.startsAt, now);
    const [done] = await tx
      .update(bookings)
      .set({ status: "cancelled", depositStatus: refund ? "refund_pending" : "kept", updatedAt: now })
      .where(eq(bookings.id, id))
      .returning();
    return { ok: true as const, refund, booking: done! };
  });
}

export type RebookResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: "not-found" | "not-active" | "too-late" | "taken" | "bad-input" | SlotProblem };

/** Moves a booking to a new time, keeping the same service and deposit. Allowed 24 hours or more before. */
export async function rebook(db: Db, id: string, target: { barberId: string; start: Date }, now: Date): Promise<RebookResult> {
  if (!barberById(target.barberId)) return { ok: false, reason: "bad-input" };
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.select().from(bookings).where(eq(bookings.id, id)).for("update");
      if (!row || !isVisible(row, now)) return { ok: false as const, reason: "not-found" as const };
      if (row.kind !== "booking" || row.status !== "confirmed") return { ok: false as const, reason: "not-active" as const };
      if (!isFreeToChange(row.startsAt, now)) return { ok: false as const, reason: "too-late" as const };
      const service = serviceById(row.serviceId ?? "");
      if (!service) return { ok: false as const, reason: "bad-input" as const };
      const problem = slotProblem(target.start, service.minutes, now);
      if (problem) return { ok: false as const, reason: problem };
      const end = new Date(target.start.getTime() + service.minutes * 60000);
      await clearOverlappingLeftovers(tx, target.barberId, target.start, end, now);
      const [done] = await tx
        .update(bookings)
        .set({ barberId: target.barberId, startsAt: target.start, endsAt: end, updatedAt: now })
        .where(eq(bookings.id, id))
        .returning();
      return { ok: true as const, booking: done! };
    });
  } catch (e) {
    if (isOverlap(e)) return { ok: false, reason: "taken" };
    throw e;
  }
}

/** Marks a refund as done, once Stripe has confirmed it (or at once for a seeded booking with no real payment). */
export async function markRefunded(db: Db, id: string, now: Date): Promise<void> {
  await db.update(bookings).set({ depositStatus: "refunded", updatedAt: now }).where(and(eq(bookings.id, id), eq(bookings.depositStatus, "refund_pending")));
}

// Admin side.

/** Everything in a window for the diary, with invisible old rows left out. Holds still within 10 minutes show too. */
export async function listDiary(db: Db, from: Date, to: Date, now: Date): Promise<Booking[]> {
  return db
    .select()
    .from(bookings)
    .where(and(lt(bookings.startsAt, to), gte(bookings.endsAt, from), occupying(now), visible(now)))
    .orderBy(asc(bookings.startsAt));
}

/** Everything booked from now on, including the cancelled, for the simple "what's booked" page. */
export async function listBooked(db: Db, from: Date, to: Date, now: Date): Promise<Booking[]> {
  return db
    .select()
    .from(bookings)
    .where(and(eq(bookings.kind, "booking"), lt(bookings.startsAt, to), gte(bookings.endsAt, from), sql`${bookings.status} <> 'held' and ${bookings.status} <> 'expired'`, visible(now)))
    .orderBy(asc(bookings.startsAt));
}

export type AdminAction = "completed" | "no_show" | "refund";
export type AdminResult = { ok: true; booking: Booking; refund: boolean } | { ok: false; reason: "not-found" | "not-allowed" | "not-yet" | "seed-only" };

/** Marks a booking completed or no-show, or starts a refund. `seedOnly` is set for the public demo login. */
export async function adminAct(db: Db, id: string, action: AdminAction, opts: { seedOnly: boolean }, now: Date): Promise<AdminResult> {
  if (!isId(id)) return { ok: false, reason: "not-found" };
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(bookings).where(eq(bookings.id, id)).for("update");
    if (!row || row.kind !== "booking" || !isVisible(row, now)) return { ok: false as const, reason: "not-found" as const };
    if (opts.seedOnly && !row.isSeed) return { ok: false as const, reason: "seed-only" as const };
    if (action === "refund") {
      if (row.depositStatus !== "paid" && row.depositStatus !== "kept") return { ok: false as const, reason: "not-allowed" as const };
      const nextStatus = row.status === "confirmed" ? "cancelled" : row.status;
      const [done] = await tx.update(bookings).set({ depositStatus: "refund_pending", status: nextStatus, updatedAt: now }).where(eq(bookings.id, id)).returning();
      return { ok: true as const, booking: done!, refund: true };
    }
    if (row.status !== "confirmed") return { ok: false as const, reason: "not-allowed" as const };
    // A real booking cannot be marked before it has started. Seeded ones can, so the demo works any day of the week.
    if (!row.isSeed && row.startsAt.getTime() > now.getTime()) return { ok: false as const, reason: "not-yet" as const };
    const [done] = await tx
      .update(bookings)
      .set({ status: action, depositStatus: action === "no_show" ? "kept" : row.depositStatus, updatedAt: now })
      .where(eq(bookings.id, id))
      .returning();
    return { ok: true as const, booking: done!, refund: false };
  });
}

export type BlockResult = { ok: true; booking: Booking } | { ok: false; reason: "taken" | "bad-input" | "closed" | "outside-hours" | "past" | "too-far" | "too-long" };

const DEMO_BLOCK = "demo-block";
/** Any fixed number: the advisory lock that makes demo blocks take turns. */
const DEMO_BLOCK_LOCK = 4_271_903;

/**
 * Blocks time off for one barber. Refused if it overlaps anything live. A demo login's blocks are seeded, so they reset, and
 * they are kept small and few, because that login is public and these times do come off the public booking page.
 */
export async function blockTime(db: Db, q: { barberId: string; dateKey: string; fromMinute: number; toMinute: number; isSeed: boolean }, now: Date): Promise<BlockResult> {
  if (!barberById(q.barberId) || !isDateKey(q.dateKey) || !Number.isInteger(q.fromMinute) || !Number.isInteger(q.toMinute)) return { ok: false, reason: "bad-input" };
  if (q.toMinute <= q.fromMinute) return { ok: false, reason: "bad-input" };
  if (q.fromMinute < SHOP.openMinute || q.toMinute > SHOP.closeMinute) return { ok: false, reason: "outside-hours" };
  const start = londonToUtc(q.dateKey, q.fromMinute);
  const end = londonToUtc(q.dateKey, q.toMinute);
  const [y, m, d] = q.dateKey.split("-").map(Number) as [number, number, number];
  if (SHOP.closedDays.includes(new Date(Date.UTC(y, m - 1, d)).getUTCDay())) return { ok: false, reason: "closed" };
  if (end.getTime() <= now.getTime()) return { ok: false, reason: "past" };
  if (q.isSeed && q.toMinute - q.fromMinute > LIMITS.demoBlockMaxMinutes) return { ok: false, reason: "too-long" };
  const lastDay = q.isSeed ? bookingDays(now).at(-1)! : addDaysToKey(londonParts(now).dateKey, LIMITS.ownerBlockDaysAhead);
  if (q.dateKey > lastDay) return { ok: false, reason: "too-far" };
  try {
    return await db.transaction(async (tx) => {
      // Demo blocks take turns, so many arriving at once cannot slip past the cap before the oldest are trimmed.
      if (q.isSeed) await tx.execute(sql`select pg_advisory_xact_lock(${DEMO_BLOCK_LOCK})`);
      await clearOverlappingLeftovers(tx, q.barberId, start, end, now);
      const [row] = await tx
        .insert(bookings)
        .values({ kind: "block", barberId: q.barberId, startsAt: start, endsAt: end, status: "confirmed", isSeed: q.isSeed, outcome: q.isSeed ? DEMO_BLOCK : null, createdAt: now, updatedAt: now })
        .returning();
      if (q.isSeed) {
        await tx.delete(bookings).where(
          sql`${bookings.id} in (select id from bookings where outcome = ${DEMO_BLOCK} order by created_at desc, id offset ${LIMITS.demoBlocksActive})`,
        );
      }
      return { ok: true as const, booking: row! };
    });
  } catch (e) {
    if (isOverlap(e)) return { ok: false, reason: "taken" };
    throw e;
  }
}

/** Removes a block. The demo login can remove only its own seeded ones. */
export async function removeBlock(db: Db, id: string, opts: { seedOnly: boolean }): Promise<boolean> {
  if (!isId(id)) return false;
  const rows = await db
    .delete(bookings)
    .where(and(eq(bookings.id, id), eq(bookings.kind, "block"), opts.seedOnly ? eq(bookings.isSeed, true) : undefined))
    .returning({ id: bookings.id });
  return rows.length > 0;
}

/** For the customer's own screens: what today means for this booking. */
export function manageView(b: Booking, now: Date) {
  return {
    canChange: b.status === "confirmed" && isFreeToChange(b.startsAt, now),
    canCancel: b.status === "confirmed" && b.startsAt.getTime() > now.getTime(),
    day: londonParts(b.startsAt).dateKey,
  };
}
