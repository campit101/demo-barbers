import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dayView } from "@/admin/views";
import { getBooking, listDiary, createHold } from "@/booking/service";
import { runCleanup } from "@/booking/cleanup";
import { ensureSeedFresh, seedRows } from "@/booking/seed";
import { bookings, rateLimits, stripeEvents } from "@/db/schema";
import { signBookingLink, verifyBookingLink } from "@/lib/manage-link";
import { resetMemoryLimits } from "@/lib/rate-limit";
import { londonToUtc } from "@/lib/time";
import { handleEvent, refundDeposit, settleSession, startCheckout, type Deps } from "@/payments/settle";
import { NOW, clearBookings, db, person, pool } from "./helpers";

process.env.MANAGE_LINK_SECRET ??= "test-secret";

const DAY = "2026-11-05";
const SITE = "https://example.test";
const at = (m: number) => londonToUtc(DAY, m);
const input = (minute = 600) => ({ barberId: "marek", serviceId: "cut", start: at(minute), ...person });

function fakeSession(over: Partial<Stripe.Checkout.Session> & { bookingId?: string }): Stripe.Checkout.Session {
  const { bookingId, ...rest } = over;
  return { id: "cs_test_1", status: "complete", payment_status: "paid", payment_intent: "pi_1", metadata: { app: "demo-barbers", bookingId: bookingId ?? "" }, ...rest } as Stripe.Checkout.Session;
}

function deps(over: { session?: Stripe.Checkout.Session } = {}) {
  const stripe = {
    checkout: {
      sessions: {
        create: vi.fn(async () => ({ id: "cs_test_1", url: "https://checkout.stripe.test/1" })),
        retrieve: vi.fn(async () => over.session ?? fakeSession({})),
        expire: vi.fn(async () => ({})),
      },
    },
    refunds: { create: vi.fn(async () => ({})) },
  };
  return { deps: { db, stripe } as Deps, stripe };
}

beforeEach(async () => {
  await clearBookings();
  await db.delete(stripeEvents);
  await db.delete(rateLimits);
  resetMemoryLimits();
});
afterAll(async () => {
  await clearBookings();
  await pool.end();
});

describe("starting checkout", () => {
  it("holds the slot and charges 20% in pounds, in sandbox", async () => {
    const { deps: d, stripe } = deps();
    const r = await startCheckout(d, input(), "https://example.test", NOW);
    expect(r).toMatchObject({ ok: true, url: "https://checkout.stripe.test/1" });
    const params = stripe.checkout.sessions.create.mock.calls[0] as unknown as [Stripe.Checkout.SessionCreateParams];
    expect(params[0].line_items?.[0]?.price_data).toMatchObject({ currency: "gbp", unit_amount: 480 });
    expect(params[0].metadata).toMatchObject({ app: "demo-barbers" });
  });

  it("asks Stripe for a session at least 30 minutes long", async () => {
    const { deps: d, stripe } = deps();
    await startCheckout(d, input(), "https://example.test", NOW);
    const params = stripe.checkout.sessions.create.mock.calls[0] as unknown as [Stripe.Checkout.SessionCreateParams];
    expect(params[0].expires_at! - Math.floor(NOW.getTime() / 1000)).toBeGreaterThanOrEqual(30 * 60);
  });

  it("lets the slot go if Stripe is down", async () => {
    const { deps: d, stripe } = deps();
    stripe.checkout.sessions.create.mockRejectedValueOnce(new Error("down"));
    expect(await startCheckout(d, input(), "https://example.test", NOW)).toMatchObject({ ok: false, reason: "payments-down" });
    expect((await startCheckout(d, input(), "https://example.test", NOW)).ok).toBe(true);
  });

  it("closes the Stripe session of an expired hold it replaces", async () => {
    const { deps: d, stripe } = deps();
    stripe.checkout.sessions.create.mockResolvedValueOnce({ id: "cs_test_old", url: "https://x" });
    await startCheckout(d, input(), "https://example.test", NOW);
    stripe.checkout.sessions.create.mockResolvedValueOnce({ id: "cs_test_new", url: "https://y" });
    expect((await startCheckout(d, input(), "https://example.test", new Date(NOW.getTime() + 11 * 60000))).ok).toBe(true);
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_test_old");
  });
});

describe("the diary's deposit total", () => {
  it("counts only money the shop actually holds", async () => {
    const paid = async (minute: number) => {
      const r = await createHold(db, input(minute), NOW);
      if (!r.ok) throw new Error(r.reason);
      await settleSession(deps().deps, fakeSession({ bookingId: r.booking.id, id: `cs_test_${minute}` }), NOW);
      return r.booking;
    };
    await paid(600);
    const refunding = await paid(660);
    await db.update(bookings).set({ depositStatus: "refund_pending" }).where(eq(bookings.id, refunding.id));
    const stillPaying = await createHold(db, input(720), NOW);
    expect(stillPaying.ok).toBe(true);

    const view = await dayView(db, DAY, "owner", NOW);
    expect(view.count).toBe(3);
    expect(view.depositsHeld).toBe("£4.80");
  });
});

describe("the webhook", () => {
  const event = (id: string, type: string, obj: object, livemode = false) => ({ id, type, livemode, data: { object: { success_url: `${SITE}/booking/done?session_id=x`, ...obj } } }) as unknown as Stripe.Event;

  async function held() {
    const r = await createHold(db, input(), NOW);
    if (!r.ok) throw new Error(r.reason);
    return r.booking;
  }

  it("confirms from a fresh read of Stripe, not the event's copy", async () => {
    const b = await held();
    const { deps: d, stripe } = deps({ session: fakeSession({ bookingId: b.id }) });
    const r = await handleEvent(d, event("evt_1", "checkout.session.completed", { id: "cs_test_1", metadata: { app: "demo-barbers" } }), NOW, SITE);
    expect(r.status).toBe(200);
    expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_test_1");
    expect(await getBooking(db, b.id)).toMatchObject({ status: "confirmed", depositStatus: "paid" });
  });

  it("does nothing the second time the same event arrives", async () => {
    const b = await held();
    const { deps: d, stripe } = deps({ session: fakeSession({ bookingId: b.id }) });
    const e = event("evt_2", "checkout.session.completed", { id: "cs_test_1", metadata: { app: "demo-barbers" } });
    await handleEvent(d, e, NOW, SITE);
    const second = await handleEvent(d, e, NOW, SITE);
    expect(second.body).toBe("Already handled");
    expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledTimes(1);
  });

  it("works when the webhook lands before the customer returns", async () => {
    const b = await held();
    const session = fakeSession({ bookingId: b.id });
    const { deps: d } = deps({ session });
    await handleEvent(d, event("evt_3", "checkout.session.completed", { id: "cs_test_1", metadata: { app: "demo-barbers" } }), NOW, SITE);
    const page = await settleSession(d, session, NOW);
    expect(page.outcome).toBe("already");
  });

  it("works when the customer returns first", async () => {
    const b = await held();
    const session = fakeSession({ bookingId: b.id });
    const { deps: d } = deps({ session });
    expect((await settleSession(d, session, NOW)).outcome).toBe("confirmed");
    const r = await handleEvent(d, event("evt_4", "checkout.session.completed", { id: "cs_test_1", metadata: { app: "demo-barbers" } }), NOW, SITE);
    expect(r.status).toBe(200);
    expect(await getBooking(db, b.id)).toMatchObject({ status: "confirmed", depositStatus: "paid" });
  });

  it("answers 500 and remembers nothing when something fails, so Stripe retries", async () => {
    const b = await held();
    const { deps: d, stripe } = deps({ session: fakeSession({ bookingId: b.id }) });
    stripe.checkout.sessions.retrieve.mockRejectedValueOnce(new Error("blip"));
    const e = event("evt_5", "checkout.session.completed", { id: "cs_test_1", metadata: { app: "demo-barbers" } });
    expect((await handleEvent(d, e, NOW, SITE)).status).toBe(500);
    expect((await handleEvent(d, e, NOW, SITE)).status).toBe(200);
    expect(await getBooking(db, b.id)).toMatchObject({ status: "confirmed" });
  });

  it("ignores other apps' events and refuses live ones", async () => {
    const { deps: d, stripe } = deps();
    expect((await handleEvent(d, event("evt_6", "checkout.session.completed", { id: "cs_x", metadata: { app: "polisher" } }), NOW, SITE)).body).toBe("Not ours");
    expect((await handleEvent(d, event("evt_7", "customer.created", {}), NOW, SITE)).body).toBe("Ignored");
    expect((await handleEvent(d, event("evt_8", "checkout.session.completed", {}, true), NOW, SITE)).status).toBe(400);
    expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
  });

  it("leaves payments started on another copy of the site alone, and does not ask Stripe to retry", async () => {
    const { deps: d, stripe } = deps();
    const fromLaptop = { id: "cs_test_2", success_url: "http://localhost:3210/booking/done?session_id=x", metadata: { app: "demo-barbers", bookingId: "not-here" } };
    const r = await handleEvent(d, event("evt_10", "checkout.session.completed", fromLaptop), NOW, SITE);
    expect(r).toEqual({ status: 200, body: "Another copy's payment" });
    expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it("releases the slot when the session expires unpaid", async () => {
    const b = await held();
    const { deps: d } = deps({ session: fakeSession({ bookingId: b.id, status: "expired", payment_status: "unpaid" }) });
    await handleEvent(d, event("evt_9", "checkout.session.expired", { id: "cs_test_1", metadata: { app: "demo-barbers" } }), NOW, SITE);
    expect(await getBooking(db, b.id)).toMatchObject({ status: "expired" });
  });

  it("leaves the hold alone while payment is unfinished", async () => {
    const b = await held();
    const { deps: d } = deps();
    expect((await settleSession(d, fakeSession({ bookingId: b.id, status: "open", payment_status: "unpaid" }), NOW)).outcome).toBe("unpaid");
    expect(await getBooking(db, b.id)).toMatchObject({ status: "held" });
  });
});

describe("refunds when a payment cannot stand", () => {
  it("refunds automatically when a late payment lost the slot", async () => {
    const r = await createHold(db, input(), NOW);
    if (!r.ok) throw new Error(r.reason);
    const later = new Date(NOW.getTime() + 11 * 60000);
    expect((await createHold(db, input(), later)).ok).toBe(true);
    const { deps: d, stripe } = deps();
    const out = await settleSession(d, fakeSession({ bookingId: r.booking.id }), later);
    expect(out.outcome).toBe("refunded-lost");
    expect(stripe.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: "pi_1" }), { idempotencyKey: `refund-${r.booking.id}` });
    expect(await getBooking(db, r.booking.id)).toMatchObject({ depositStatus: "refunded", status: "cancelled" });
  });

  it("refunds a payment whose booking has gone", async () => {
    const { deps: d, stripe } = deps();
    const out = await settleSession(d, fakeSession({ bookingId: "00000000-0000-4000-8000-000000000000" }), NOW);
    expect(out.outcome).toBe("refunded-missing");
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed refund pending for the clean-up to retry, and treats 'already refunded' as done", async () => {
    const r = await createHold(db, input(), NOW);
    if (!r.ok) throw new Error(r.reason);
    await pool.query(`update bookings set status = 'cancelled', hold_expires_at = null, deposit_status = 'refund_pending', stripe_payment_intent_id = 'pi_9' where id = $1`, [r.booking.id]);
    const row = (await getBooking(db, r.booking.id))!;
    const { deps: d, stripe } = deps();
    stripe.refunds.create.mockRejectedValueOnce(new Error("down"));
    expect(await refundDeposit(d, row, NOW)).toBe(false);
    expect((await getBooking(db, r.booking.id))?.depositStatus).toBe("refund_pending");
    stripe.refunds.create.mockRejectedValueOnce(Object.assign(new Error("done"), { code: "charge_already_refunded" }));
    expect((await runCleanup(d, NOW)).refunds).toBe(1);
    expect((await getBooking(db, r.booking.id))?.depositStatus).toBe("refunded");
  });
});

describe("manage links", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("accepts its own signature and refuses anything altered", () => {
    const good = signBookingLink(id);
    expect(verifyBookingLink(good)).toBe(id);
    expect(verifyBookingLink(`${id}.nope`)).toBeNull();
    expect(verifyBookingLink(good.replace("1111", "2222"))).toBeNull();
    expect(verifyBookingLink(good.slice(0, -1))).toBeNull();
    expect(verifyBookingLink("")).toBeNull();
    expect(verifyBookingLink(null)).toBeNull();
    expect(verifyBookingLink("../../etc")).toBeNull();
  });
});

describe("seeding and clean-up", () => {
  it("builds a believable diary with no overlaps and only on open days", async () => {
    expect(seedRows(NOW).length).toBeGreaterThan(50);
    expect(await ensureSeedFresh(db, NOW)).toBe(true);
    const diary = await listDiary(db, londonToUtc(DAY, 0), londonToUtc(DAY, 1439), NOW);
    expect(diary.length).toBeGreaterThan(6);
    expect(await listDiary(db, londonToUtc("2026-11-08", 0), londonToUtc("2026-11-08", 1439), NOW)).toHaveLength(0);
  });

  it("does not rebuild until 24 hours have passed, then resets clicks", async () => {
    await ensureSeedFresh(db, NOW);
    await pool.query(`update bookings set status = 'completed' where is_seed and kind = 'booking'`);
    expect(await ensureSeedFresh(db, new Date(NOW.getTime() + 23 * 3600000))).toBe(false);
    expect(await ensureSeedFresh(db, new Date(NOW.getTime() + 25 * 3600000))).toBe(true);
    const { rows } = await pool.query(`select count(*) from bookings where is_seed and status = 'completed'`);
    expect(Number(rows[0].count)).toBe(0);
  });

  it("never disturbs a visitor's real booking", async () => {
    const r = await createHold(db, input(), NOW);
    if (!r.ok) throw new Error(r.reason);
    await ensureSeedFresh(db, NOW);
    expect(await getBooking(db, r.booking.id)).not.toBeNull();
  });

  it("clears expired holds, deletes visitors' rows after 24 hours and closes Stripe sessions", async () => {
    const r = await createHold(db, input(), NOW);
    if (!r.ok) throw new Error(r.reason);
    await pool.query(`update bookings set stripe_session_id = 'cs_test_gone' where id = $1`, [r.booking.id]);
    const { deps: d, stripe } = deps();
    const first = await runCleanup(d, new Date(NOW.getTime() + 11 * 60000));
    expect(first.holdsExpired).toBe(1);
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_test_gone");
    expect(await getBooking(db, r.booking.id)).toMatchObject({ status: "expired" });
    const second = await runCleanup(d, new Date(NOW.getTime() + 25 * 3600000));
    expect(second.deleted).toBe(1);
    expect(await getBooking(db, r.booking.id)).toBeNull();
  });
});
