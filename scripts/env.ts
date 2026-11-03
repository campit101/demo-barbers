// Loads .env.local into process.env for local scripts (values already set win). Prints nothing.
// Vercel's own markers (VERCEL, VERCEL_ENV and the like, which `vercel env pull` can write) are never loaded: scripts
// use VERCEL=1 to decide whether the test-database guard applies, so only a real Vercel build may set it.
// VERCEL_OIDC_TOKEN is the one exception (the photo script's gateway sign-in).
import { existsSync, readFileSync } from "node:fs";

export function loadEnvLocal(file = ".env.local", env: Record<string, string | undefined> = process.env): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    if (key.startsWith("VERCEL") && key !== "VERCEL_OIDC_TOKEN") continue;
    if (env[key] === undefined) env[key] = m[2]!.replace(/^"|"$/g, "");
  }
}
