import "server-only";

import { headers } from "next/headers";
import { siteUrl } from "@/lib/site";

/** The address this request came in on. The live site's is fixed; headers are only trusted on local runs and private previews, whose address varies. */
export async function requestOrigin(): Promise<string> {
  if (process.env.VERCEL_ENV === "production") return siteUrl();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  return host ? `${proto}://${host}` : siteUrl();
}
