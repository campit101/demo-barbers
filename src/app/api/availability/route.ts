// Open times for the booking screens. GET ?barber=marek&service=cut&date=YYYY-MM-DD
import { LIMITS } from "@/config/shop";
import { getDb } from "@/db/client";
import { availability } from "@/booking/service";
import { clientAddress, consume, limitKey } from "@/lib/rate-limit";
import { formatTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const db = getDb();
  const limit = await consume(db as never, limitKey("availability", clientAddress(req.headers)), { max: LIMITS.availabilityPerMinutePerConnection, windowSeconds: 60 });
  if (!limit.allowed) return Response.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  const q = new URL(req.url).searchParams;
  const slots = await availability(db, { barberId: q.get("barber") ?? "", serviceId: q.get("service") ?? "", dateKey: q.get("date") ?? "" }, new Date());
  return Response.json({ slots: slots.map((s) => ({ start: s.toISOString(), label: formatTime(s) })) }, { headers: { "Cache-Control": "no-store" } });
}
