// The scheduled tidy-up, called by Vercel's daily job and a free hourly GitHub Actions job, both with CRON_SECRET.
import { createHash, timingSafeEqual } from "node:crypto";
import { runCleanup } from "@/booking/cleanup";
import { getDeps } from "@/lib/deps";

const digest = (s: string) => createHash("sha256").update(s).digest();

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("Not set up", { status: 503 });
  if (!timingSafeEqual(digest(req.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`))) return new Response("Forbidden", { status: 403 });
  return Response.json(await runCleanup(getDeps(), new Date()));
}
