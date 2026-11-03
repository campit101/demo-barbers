// "Next free chair" for the home page and barber cards: the first open 30 minute slot per barber.
import { BARBERS, LIMITS } from "@/config/shop";
import { getDb } from "@/db/client";
import { nextFreeChairs } from "@/booking/service";
import { clientAddress, consume, limitKey } from "@/lib/rate-limit";
import { formatWhen, londonParts } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const db = getDb();
  const limit = await consume(db as never, limitKey("availability", clientAddress(req.headers)), { max: LIMITS.availabilityPerMinutePerConnection, windowSeconds: 60 });
  if (!limit.allowed) return Response.json({ error: "Too many requests" }, { status: 429 });
  const now = new Date();
  const free = await nextFreeChairs(db, now);
  return Response.json(
    {
      chairs: free.map((f) => ({
        barberId: f.barberId,
        name: BARBERS.find((b) => b.id === f.barberId)?.name,
        start: f.start?.toISOString() ?? null,
        date: f.start ? londonParts(f.start).dateKey : null,
        when: f.start ? formatWhen(f.start, now) : "Nothing free",
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
