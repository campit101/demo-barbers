// The scheduled tidy-up. Nothing depends on it for correctness: reads already ignore expired holds and old rows.
// It makes the deletion promise true on disk, retries refunds, and rebuilds the demo diary.
import { and, lt, sql } from "drizzle-orm";
import { DATA } from "../config/shop.ts";
import { bookings, rateLimits, session, stripeEvents, verification } from "../db/schema.ts";
import { expireSessions, retryPendingRefunds, type Deps } from "../payments/settle.ts";
import { ensureSeedFresh } from "./seed.ts";

export async function runCleanup(deps: Deps, now: Date) {
  const { db, stripe } = deps;
  const expired = await db
    .update(bookings)
    .set({ status: "expired", holdExpiresAt: null, updatedAt: now })
    .where(sql`${bookings.status} = 'held' and ${bookings.holdExpiresAt} <= ${now.toISOString()}`)
    .returning({ session: bookings.stripeSessionId });
  await expireSessions(stripe, expired.flatMap((r) => (r.session ? [r.session] : [])));

  const refunds = await retryPendingRefunds(deps, now);

  const cutoff = new Date(now.getTime() - DATA.retentionHours * 3600000);
  const deleted = await db
    .delete(bookings)
    .where(sql`not ${bookings.isSeed} and ${bookings.createdAt} <= ${cutoff.toISOString()} and ${bookings.depositStatus} <> 'refund_pending'`)
    .returning({ id: bookings.id });

  await db.delete(stripeEvents).where(lt(stripeEvents.processedAt, new Date(now.getTime() - 7 * 86400000)));
  await db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(now.getTime() - 2 * 86400000)));
  await db.delete(session).where(and(lt(session.expiresAt, now)));
  await db.delete(verification).where(lt(verification.expiresAt, now));

  const reseeded = await ensureSeedFresh(db, now);
  return { holdsExpired: expired.length, refunds, deleted: deleted.length, reseeded };
}
