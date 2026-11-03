import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { LIMITS } from "@/config/shop";
import { adminAct, attachSession, availability, blockTime, cancelBooking, createHold, firstOpen, getBooking, listDiary, rebook, releaseHold, removeBlock, settlePaid } from "@/booking/service";
import { londonToUtc } from "@/lib/time";
import { NOW, clearBookings, db, person, pool } from "./helpers";

const DAY = "2026-11-05"; // a Thursday, more than 24 hours after NOW
const at = (minute: number) => londonToUtc(DAY, minute);
const MINUTE = 60000;
const hold = (minute: number, over: Partial<{ barberId: string; serviceId: string }> = {}, now = NOW) =>
  createHold(db, { barberId: "marek", serviceId: "cut", start: at(minute), ...person, holdOwner: "connection-a", ...over }, now);

async function confirmed(minute: number, over: Partial<{ barberId: string; serviceId: string }> = {}, now = NOW) {
  const r = await hold(minute, over, now);
  if (!r.ok) throw new Error(r.reason);
  const s = await settlePaid(db, { bookingId: r.booking.id, sessionId: `cs_test_${r.booking.id}`, paymentIntentId: "pi_test" }, now);
  if (s.state !== "confirmed") throw new Error(s.state);
  return s.booking;
}

beforeEach(clearBookings);
afterAll(async () => {
  await clearBookings();
  await pool.end();
});

describe("double-booking", () => {
  it("lets exactly one of ten simultaneous bookings win the same slot", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => createHold(db, { barberId: "marek", serviceId: "cut", start: at(600), name: person.name, email: `racer${i}@example.com` }, NOW)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "taken")).toHaveLength(9);
  });

  it("refuses at database level even when code is bypassed", async () => {
    await confirmed(600);
    const raw = pool.query(
      `insert into bookings (kind, barber_id, starts_at, ends_at, status) values ('block', 'marek', $1, $2, 'confirmed')`,
      [at(610).toISOString(), at(620).toISOString()],
    );
    await expect(raw).rejects.toMatchObject({ code: "23P01" });
  });

  it("allows the same time with the other barber, and back-to-back bookings", async () => {
    await confirmed(600);
    expect((await hold(600, { barberId: "ailsa" })).ok).toBe(true);
    expect((await hold(630)).ok).toBe(true);
  });

  it("refuses a long service that would run into the next booking", async () => {
    await confirmed(660);
    const r = await hold(630, { serviceId: "both" });
    expect(r).toMatchObject({ ok: false, reason: "taken" });
    const open = await availability(db, { barberId: "marek", serviceId: "both", dateKey: DAY }, NOW);
    expect(open.map((d) => d.getTime())).not.toContain(at(630).getTime());
    expect(open.map((d) => d.getTime())).toContain(at(690).getTime());
  });

  it("refuses a service that would run past closing", async () => {
    expect(await hold(17 * 60 + 15, { serviceId: "both" })).toMatchObject({ ok: false, reason: "past-closing" });
  });

  it("refuses past times, closed days and times off the grid before touching the database", async () => {
    const past = await createHold(db, { barberId: "marek", serviceId: "cut", start: new Date(NOW.getTime() - MINUTE), ...person }, NOW);
    expect(past).toMatchObject({ ok: false, reason: "past" });
    const sunday = await createHold(db, { barberId: "marek", serviceId: "cut", start: londonToUtc("2026-11-08", 600), ...person }, NOW);
    expect(sunday).toMatchObject({ ok: false, reason: "closed" });
    expect(await hold(607)).toMatchObject({ ok: false, reason: "off-grid" });
    expect(await hold(600, { serviceId: "nonsense" })).toMatchObject({ ok: false, reason: "bad-input" });
  });
});

describe("coming back to your own hold", () => {
  it("lets the same email take the time again and closes the old payment page", async () => {
    const first = await hold(600);
    if (!first.ok) throw new Error(first.reason);
    await attachSession(db, first.booking.id, "cs_test_first", NOW);
    const again = await hold(600);
    if (!again.ok) throw new Error(again.reason);
    expect(again.expiredSessionIds).toEqual(["cs_test_first"]);
    expect(await getBooking(db, first.booking.id)).toMatchObject({ status: "expired" });
  });

  it("refuses the same email typed from another connection, so knowing someone's email is not enough to take their time", async () => {
    const first = await hold(600);
    if (!first.ok) throw new Error(first.reason);
    const stranger = await createHold(db, { barberId: "marek", serviceId: "cut", start: at(600), ...person, holdOwner: "connection-b" }, NOW);
    expect(stranger).toMatchObject({ ok: false, reason: "taken" });
    const noProof = await createHold(db, { barberId: "marek", serviceId: "cut", start: at(600), ...person }, NOW);
    expect(noProof).toMatchObject({ ok: false, reason: "taken" });
    expect(await getBooking(db, first.booking.id)).toMatchObject({ status: "held" });
  });

  it("still refuses anyone else, and never touches a paid booking", async () => {
    await hold(600);
    expect(await createHold(db, { barberId: "marek", serviceId: "cut", start: at(600), name: "Other", email: "other@example.com" }, NOW)).toMatchObject({ ok: false, reason: "taken" });
    await confirmed(720);
    expect(await hold(720)).toMatchObject({ ok: false, reason: "taken" });
  });
});

describe("the 10 minute hold", () => {
  it("blocks the slot while live and frees it after 10 minutes with no timer", async () => {
    const someoneElse = (now: Date) => createHold(db, { barberId: "marek", serviceId: "cut", start: at(600), name: "Other", email: "other@example.com" }, now);
    expect((await hold(600)).ok).toBe(true);
    expect(await someoneElse(NOW)).toMatchObject({ ok: false, reason: "taken" });

    const nineLater = new Date(NOW.getTime() + 9 * MINUTE);
    expect(await someoneElse(nineLater)).toMatchObject({ ok: false, reason: "taken" });
    let open = await availability(db, { barberId: "marek", serviceId: "cut", dateKey: DAY }, nineLater);
    expect(open.map((d) => d.getTime())).not.toContain(at(600).getTime());

    const tenLater = new Date(NOW.getTime() + 10 * MINUTE);
    open = await availability(db, { barberId: "marek", serviceId: "cut", dateKey: DAY }, tenLater);
    expect(open.map((d) => d.getTime())).toContain(at(600).getTime());
    expect((await hold(600, {}, tenLater)).ok).toBe(true);
  });

  it("reports the expired hold's Stripe session so it can be closed", async () => {
    const first = await hold(600);
    if (!first.ok) throw new Error("hold failed");
    await pool.query(`update bookings set stripe_session_id = 'cs_test_old' where id = $1`, [first.booking.id]);
    const second = await hold(600, {}, new Date(NOW.getTime() + 11 * MINUTE));
    expect(second).toMatchObject({ ok: true, expiredSessionIds: ["cs_test_old"] });
  });

  it("releases at once when someone backs out", async () => {
    const r = await hold(600);
    if (!r.ok) throw new Error("hold failed");
    expect(await releaseHold(db, r.booking.id, NOW)).toBe(true);
    expect(await releaseHold(db, r.booking.id, NOW)).toBe(false);
    expect((await hold(600)).ok).toBe(true);
  });
});

describe("payments arriving in awkward orders", () => {
  it("confirms once however many times the webhook and return page call it", async () => {
    const r = await hold(600);
    if (!r.ok) throw new Error("hold failed");
    const p = { bookingId: r.booking.id, sessionId: "cs_test_1", paymentIntentId: "pi_1" };
    const all = await Promise.all([settlePaid(db, p, NOW), settlePaid(db, p, NOW), settlePaid(db, p, NOW)]);
    expect(all.filter((s) => s.state === "confirmed")).toHaveLength(1);
    expect(all.filter((s) => s.state === "already")).toHaveLength(2);
    const row = await getBooking(db, r.booking.id);
    expect(row).toMatchObject({ status: "confirmed", depositStatus: "paid", holdExpiresAt: null, stripePaymentIntentId: "pi_1" });
  });

  it("re-takes the slot when a late payment lands and the time is still free", async () => {
    const r = await hold(600);
    if (!r.ok) throw new Error("hold failed");
    await releaseHold(db, r.booking.id, NOW);
    const s = await settlePaid(db, { bookingId: r.booking.id, sessionId: "cs_test_1", paymentIntentId: "pi_1" }, new Date(NOW.getTime() + 20 * MINUTE));
    expect(s.state).toBe("confirmed");
  });

  it("marks a refund when a late payment lands and someone else has the slot", async () => {
    const r = await hold(600);
    if (!r.ok) throw new Error("hold failed");
    const later = new Date(NOW.getTime() + 11 * MINUTE);
    const other = await hold(600, {}, later);
    expect(other.ok).toBe(true);
    const s = await settlePaid(db, { bookingId: r.booking.id, sessionId: "cs_test_1", paymentIntentId: "pi_1" }, later);
    expect(s.state).toBe("lost");
    expect(await getBooking(db, r.booking.id)).toMatchObject({ status: "cancelled", depositStatus: "refund_pending", outcome: "late-payment-lost-slot" });
  });

  it("flags a payment for a booking that no longer exists", async () => {
    const s = await settlePaid(db, { bookingId: "00000000-0000-4000-8000-000000000000", sessionId: "cs_test_1", paymentIntentId: "pi_1" }, NOW);
    expect(s.state).toBe("missing");
  });

  it("does not let a different session confirm a booking", async () => {
    const b = await confirmed(600);
    const s = await settlePaid(db, { bookingId: b.id, sessionId: "cs_test_other", paymentIntentId: "pi_2" }, NOW);
    expect(s.state).toBe("missing");
    expect((await getBooking(db, b.id))?.stripePaymentIntentId).toBe("pi_test");
  });
});

describe("cancelling and rebooking", () => {
  it("refunds when cancelled 24 hours or more before, and frees the slot", async () => {
    const cancelAt = new Date(at(600).getTime() - 24 * 3600000);
    const b = await confirmed(600, {}, new Date(cancelAt.getTime() - 3600000));
    const r = await cancelBooking(db, b.id, cancelAt);
    expect(r).toMatchObject({ ok: true, refund: true, booking: { status: "cancelled", depositStatus: "refund_pending" } });
    expect((await hold(600, {}, cancelAt)).ok).toBe(true);
  });

  it("keeps the deposit when cancelled later than that", async () => {
    const cancelAt = new Date(at(600).getTime() - 24 * 3600000 + 1000);
    const b = await confirmed(600, {}, new Date(cancelAt.getTime() - 3600000));
    const r = await cancelBooking(db, b.id, cancelAt);
    expect(r).toMatchObject({ ok: true, refund: false, booking: { status: "cancelled", depositStatus: "kept" } });
  });

  it("cannot cancel twice, or after the start", async () => {
    const b = await confirmed(600);
    expect((await cancelBooking(db, b.id, NOW)).ok).toBe(true);
    expect(await cancelBooking(db, b.id, NOW)).toMatchObject({ ok: false, reason: "not-active" });
    const c = await confirmed(660, {}, new Date(at(660).getTime() - 2 * 3600000));
    expect(await cancelBooking(db, c.id, new Date(at(660).getTime() + 1000))).toMatchObject({ ok: false, reason: "already-started" });
  });

  it("moves a booking and frees the old time", async () => {
    const b = await confirmed(600);
    const r = await rebook(db, b.id, { barberId: "ailsa", start: at(720) }, NOW);
    expect(r).toMatchObject({ ok: true, booking: { barberId: "ailsa", depositStatus: "paid" } });
    expect((await hold(600)).ok).toBe(true);
  });

  it("will not move onto a taken slot, or inside 24 hours", async () => {
    const a = await confirmed(600);
    await confirmed(660);
    expect(await rebook(db, a.id, { barberId: "marek", start: at(660) }, NOW)).toMatchObject({ ok: false, reason: "taken" });
    const made = new Date(at(780).getTime() - 2 * 3600000);
    const soon = await confirmed(780, {}, made);
    expect(await rebook(db, soon.id, { barberId: "marek", start: at(840) }, made)).toMatchObject({ ok: false, reason: "too-late" });
  });

  it("hides and frees a visitor's booking after 24 hours, even before the clean-up runs", async () => {
    const b = await confirmed(600);
    const later = new Date(NOW.getTime() + 25 * 3600000);
    expect(await cancelBooking(db, b.id, later)).toMatchObject({ ok: false, reason: "not-found" });
    const open = await availability(db, { barberId: "marek", serviceId: "cut", dateKey: DAY }, later);
    expect(open.map((d) => d.getTime())).toContain(at(600).getTime());
    expect((await hold(600, {}, later)).ok).toBe(true);
    expect(await getBooking(db, b.id)).toBeNull();
  });
});

describe("the shop's side", () => {
  it("blocks time off, refuses overlaps, and customers cannot book it", async () => {
    await confirmed(600);
    expect(await blockTime(db, { barberId: "marek", dateKey: DAY, fromMinute: 600, toMinute: 700, isSeed: false }, NOW)).toMatchObject({ ok: false, reason: "taken" });
    const r = await blockTime(db, { barberId: "marek", dateKey: DAY, fromMinute: 720, toMinute: 780, isSeed: false }, NOW);
    if (!r.ok) throw new Error(r.reason);
    expect(await hold(750)).toMatchObject({ ok: false, reason: "taken" });
    expect(await removeBlock(db, r.booking.id, { seedOnly: false })).toBe(true);
    expect((await hold(750)).ok).toBe(true);
  });

  it("refuses blocks outside hours, on closed days and in the past", async () => {
    const q = { barberId: "marek", isSeed: false };
    expect(await blockTime(db, { ...q, dateKey: DAY, fromMinute: 480, toMinute: 600 }, NOW)).toMatchObject({ reason: "outside-hours" });
    expect(await blockTime(db, { ...q, dateKey: "2026-11-08", fromMinute: 600, toMinute: 660 }, NOW)).toMatchObject({ reason: "closed" });
    expect(await blockTime(db, { ...q, dateKey: "2026-10-27", fromMinute: 600, toMinute: 660 }, NOW)).toMatchObject({ reason: "past" });
    expect(await blockTime(db, { ...q, dateKey: DAY, fromMinute: 660, toMinute: 600 }, NOW)).toMatchObject({ reason: "bad-input" });
  });

  it("keeps the public demo login from emptying the public booking page", async () => {
    const q = { barberId: "marek", dateKey: DAY, isSeed: true };
    expect(await blockTime(db, { ...q, fromMinute: 540, toMinute: 540 + LIMITS.demoBlockMaxMinutes + 15 }, NOW)).toMatchObject({ ok: false, reason: "too-long" });
    expect(await blockTime(db, { ...q, dateKey: "2027-01-08", fromMinute: 600, toMinute: 615 }, NOW)).toMatchObject({ ok: false, reason: "too-far" });
    for (let i = 0; i < LIMITS.demoBlocksActive + 2; i++) {
      const r = await blockTime(db, { ...q, fromMinute: 540 + i * 15, toMinute: 555 + i * 15 }, new Date(NOW.getTime() + i * 1000));
      expect(r.ok).toBe(true);
    }
    const rows = await listDiary(db, at(0), at(1439), NOW);
    expect(rows.filter((b) => b.kind === "block")).toHaveLength(LIMITS.demoBlocksActive);
    expect(rows.some((b) => b.startsAt.getTime() === at(540).getTime())).toBe(false);
  });

  it("keeps the cap when many demo blocks arrive at the same moment", async () => {
    const q = { dateKey: DAY, isSeed: true };
    const tries = Array.from({ length: 20 }, (_, i) => blockTime(db, { ...q, barberId: i % 2 ? "ailsa" : "marek", fromMinute: 540 + Math.floor(i / 2) * 15, toMinute: 555 + Math.floor(i / 2) * 15 }, NOW));
    expect((await Promise.all(tries)).every((r) => r.ok)).toBe(true);
    const rows = await listDiary(db, at(0), at(1439), NOW);
    expect(rows.filter((b) => b.kind === "block")).toHaveLength(LIMITS.demoBlocksActive);
  });

  it("lets the owner block further ahead, but not beyond a year", async () => {
    const q = { barberId: "marek", fromMinute: 600, toMinute: 900, isSeed: false };
    expect((await blockTime(db, { ...q, dateKey: "2027-01-08" }, NOW)).ok).toBe(true);
    expect(await blockTime(db, { ...q, dateKey: "2030-01-08" }, NOW)).toMatchObject({ ok: false, reason: "too-far" });
  });

  it("treats a tampered id as not found rather than crashing", async () => {
    expect(await getBooking(db, "garbage")).toBeNull();
    expect(await adminAct(db, "garbage", "refund", { seedOnly: false }, NOW)).toMatchObject({ ok: false, reason: "not-found" });
    expect(await removeBlock(db, "garbage", { seedOnly: false })).toBe(false);
  });

  it("marks completed and no-show only after a real booking has started", async () => {
    const made = new Date(at(600).getTime() - 2 * 3600000);
    const b = await confirmed(600, {}, made);
    expect(await adminAct(db, b.id, "completed", { seedOnly: false }, made)).toMatchObject({ ok: false, reason: "not-yet" });
    const after = new Date(at(600).getTime() + MINUTE);
    expect(await adminAct(db, b.id, "no_show", { seedOnly: false }, after)).toMatchObject({ ok: true, booking: { status: "no_show", depositStatus: "kept" } });
    expect(await adminAct(db, b.id, "completed", { seedOnly: false }, after)).toMatchObject({ ok: false, reason: "not-allowed" });
  });

  it("refunds from the admin and frees a future slot", async () => {
    const b = await confirmed(600);
    expect(await adminAct(db, b.id, "refund", { seedOnly: false }, NOW)).toMatchObject({ ok: true, refund: true, booking: { status: "cancelled", depositStatus: "refund_pending" } });
    expect(await adminAct(db, b.id, "refund", { seedOnly: false }, NOW)).toMatchObject({ ok: false, reason: "not-allowed" });
    expect((await hold(600)).ok).toBe(true);
  });

  it("stops the demo login touching a visitor's real booking", async () => {
    const b = await confirmed(600);
    expect(await adminAct(db, b.id, "refund", { seedOnly: true }, NOW)).toMatchObject({ ok: false, reason: "seed-only" });
    expect((await getBooking(db, b.id))?.depositStatus).toBe("paid");
  });

  it("shows live rows in the diary and hides expired holds", async () => {
    await hold(600);
    await confirmed(660);
    const from = londonToUtc(DAY, 0);
    const to = londonToUtc(DAY, 1439);
    expect(await listDiary(db, from, to, NOW)).toHaveLength(2);
    expect(await listDiary(db, from, to, new Date(NOW.getTime() + 11 * MINUTE))).toHaveLength(1);
  });

  it("finds the first open time", async () => {
    const first = await firstOpen(db, "marek", 30, new Date("2026-11-08T10:00:00Z"));
    expect(first?.toISOString()).toBe(londonToUtc("2026-11-10", 540).toISOString());
  });
});
