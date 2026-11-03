// Coming back from Stripe. The confirmation page reconciles by itself, so a booking never depends on the webhook arriving first.
import "server-only";
import { getBooking, releaseHold, type Booking } from "@/booking/service";
import { LIMITS } from "@/config/shop";
import { getDeps } from "@/lib/deps";
import { signBookingLink, verifyBookingLink } from "@/lib/manage-link";
import { consume, limitKey } from "@/lib/rate-limit";
import { expireSessions, settleSession, type SettleOutcome } from "@/payments/settle";

export interface ReturnView {
  outcome: SettleOutcome | "bad-link" | "unreachable" | "too-many";
  booking: Booking | null;
  manageHref: string | null;
}

/** Fetches the session fresh from Stripe and records it. Safe to reload any number of times. */
export async function confirmReturn(sessionId: string | null | undefined, address: string): Promise<ReturnView> {
  if (!sessionId || !/^cs_test_[A-Za-z0-9_]{10,200}$/.test(sessionId)) return { outcome: "bad-link", booking: null, manageHref: null };
  const deps = getDeps();
  // Each check costs a call to Stripe, so made-up links cannot be used to wear out the payment account.
  const limit = await consume(deps.db as never, limitKey("return", address), { max: LIMITS.returnChecksPerHourPerConnection, windowSeconds: 3600 });
  if (!limit.allowed) return { outcome: "too-many", booking: null, manageHref: null };
  try {
    const session = await deps.stripe.checkout.sessions.retrieve(sessionId);
    const { outcome, booking } = await settleSession(deps, session, new Date());
    const fresh = booking ? await getBooking(deps.db, booking.id) : null;
    return { outcome, booking: fresh, manageHref: fresh ? `/manage/${encodeURIComponent(signBookingLink(fresh.id))}` : null };
  } catch (e) {
    // Stripe answered, and has no such payment: a wrong link, not an outage.
    if ((e as { code?: unknown })?.code === "resource_missing") return { outcome: "bad-link", booking: null, manageHref: null };
    return { outcome: "unreachable", booking: null, manageHref: null };
  }
}

/** The customer backed out of Stripe's page: let the time go straight away. Only a signed link can do this. */
export async function releaseFromCancel(token: string | null | undefined): Promise<Booking | null> {
  const id = verifyBookingLink(token);
  if (!id) return null;
  const deps = getDeps();
  const b = await getBooking(deps.db, id);
  if (!b || b.status !== "held") return b;
  await releaseHold(deps.db, id, new Date());
  if (b.stripeSessionId) await expireSessions(deps.stripe, [b.stripeSessionId]);
  return b;
}
