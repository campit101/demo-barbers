// What happens around a payment: starting Checkout, recording the result, and refunds. The webhook and the return page both
// land here, in either order and any number of times.
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { APP_TAG } from "../config/shop.ts";
import { createHold, attachSession, markRefunded, releaseHold, settlePaid, type Booking, type Db, type HoldInput } from "../booking/service.ts";
import type { SlotProblem } from "../booking/slots.ts";
import { bookings, stripeEvents } from "../db/schema.ts";
import { sessionParams, type PaymentsApi } from "./stripe.ts";

export interface Deps {
  db: Db;
  stripe: PaymentsApi;
}

export type StartResult = { ok: true; url: string; bookingId: string } | { ok: false; reason: "taken" | "bad-input" | "payments-down" | SlotProblem };

/** Takes the hold, then opens Stripe Checkout for the deposit. If Stripe is down the hold is let go straight away. */
export async function startCheckout({ db, stripe }: Deps, input: HoldInput, origin: string, now: Date): Promise<StartResult> {
  const hold = await createHold(db, input, now);
  if (!hold.ok) return hold;
  await expireSessions(stripe, hold.expiredSessionIds);
  try {
    const session = await stripe.checkout.sessions.create(sessionParams(hold.booking, origin, now), { idempotencyKey: `hold-${hold.booking.id}` });
    if (!session.url) throw new Error("Stripe returned no checkout address");
    await attachSession(db, hold.booking.id, session.id, now);
    return { ok: true, url: session.url, bookingId: hold.booking.id };
  } catch {
    await releaseHold(db, hold.booking.id, now);
    return { ok: false, reason: "payments-down" };
  }
}

/** Closes Stripe sessions whose hold has ended, so nobody pays for a time they no longer hold. Best effort: settle handles a late payment anyway. */
export async function expireSessions(stripe: PaymentsApi, ids: readonly string[]): Promise<void> {
  await Promise.all(ids.map((id) => stripe.checkout.sessions.expire(id).catch(() => {})));
}

const isOurs = (s: Stripe.Checkout.Session) => s.metadata?.app === APP_TAG && typeof s.metadata?.bookingId === "string";
const intentId = (s: Stripe.Checkout.Session) => (typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null));

export type SettleOutcome = "confirmed" | "already" | "refunded-lost" | "refunded-missing" | "released" | "unpaid" | "ignored";

/** Acts on a session re-read from Stripe. Safe to repeat. */
export async function settleSession(deps: Deps, session: Stripe.Checkout.Session, now: Date): Promise<{ outcome: SettleOutcome; booking: Booking | null }> {
  if (!isOurs(session)) return { outcome: "ignored", booking: null };
  const bookingId = session.metadata!.bookingId!;
  if (session.payment_status === "paid") {
    const result = await settlePaid(deps.db, { bookingId, sessionId: session.id, paymentIntentId: intentId(session) }, now);
    if (result.state === "missing") {
      const pi = intentId(session);
      if (pi) await deps.stripe.refunds.create({ payment_intent: pi, metadata: { app: APP_TAG, reason: "booking-missing" } }, { idempotencyKey: `refund-missing-${pi}` });
      return { outcome: "refunded-missing", booking: null };
    }
    if (result.state === "lost") {
      await refundDeposit(deps, result.booking, now);
      return { outcome: "refunded-lost", booking: result.booking };
    }
    return { outcome: result.state, booking: result.booking };
  }
  if (session.status === "expired") {
    await releaseHold(deps.db, bookingId, now);
    return { outcome: "released", booking: null };
  }
  return { outcome: "unpaid", booking: null };
}

/** Sends a pending refund. Returns false if Stripe failed, leaving it pending so the clean-up job tries again. */
export async function refundDeposit({ db, stripe }: Deps, b: Booking, now: Date): Promise<boolean> {
  if (b.depositStatus !== "refund_pending") return b.depositStatus === "refunded";
  if (b.stripePaymentIntentId && !b.isSeed) {
    try {
      await stripe.refunds.create({ payment_intent: b.stripePaymentIntentId, metadata: { app: APP_TAG, bookingId: b.id } }, { idempotencyKey: `refund-${b.id}` });
    } catch (e) {
      if ((e as { code?: string }).code !== "charge_already_refunded") return false;
    }
  }
  await markRefunded(db, b.id, now);
  return true;
}

export interface WebhookResult {
  status: number;
  body: string;
}

const originOf = (url: string | null | undefined) => {
  try {
    return new URL(url ?? "").origin;
  } catch {
    return null;
  }
};

/**
 * Handles one verified event. The caller has checked the signature. Answers 500 on failure so Stripe retries.
 * Every copy of the site (live, previews, laptop test runs) shares one Stripe sandbox, so each acts only on sessions it started.
 */
export async function handleEvent(deps: Deps, event: Stripe.Event, now: Date, siteOrigin: string): Promise<WebhookResult> {
  if (event.livemode) return { status: 400, body: "Live events are refused" };
  const relevant = ["checkout.session.completed", "checkout.session.expired", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed"];
  if (!relevant.includes(event.type)) return { status: 200, body: "Ignored" };
  const [seen] = await deps.db.select({ id: stripeEvents.id }).from(stripeEvents).where(eq(stripeEvents.id, event.id));
  if (seen) return { status: 200, body: "Already handled" };
  try {
    // Never trust the event's copy: read the session fresh from Stripe.
    const sent = event.data.object as Stripe.Checkout.Session;
    if (sent.metadata?.app !== APP_TAG) return { status: 200, body: "Not ours" };
    if (originOf(sent.success_url) !== originOf(siteOrigin)) return { status: 200, body: "Another copy's payment" };
    const session = await deps.stripe.checkout.sessions.retrieve(sent.id);
    await settleSession(deps, session, now);
    // Recorded only after success, so a failure is retried.
    await deps.db.insert(stripeEvents).values({ id: event.id, type: event.type, processedAt: now }).onConflictDoNothing();
    return { status: 200, body: "OK" };
  } catch {
    return { status: 500, body: "Try again" };
  }
}

export async function retryPendingRefunds(deps: Deps, now: Date): Promise<number> {
  const pending = await deps.db.select().from(bookings).where(eq(bookings.depositStatus, "refund_pending"));
  let done = 0;
  for (const b of pending) if (await refundDeposit(deps, b, now)) done++;
  return done;
}
