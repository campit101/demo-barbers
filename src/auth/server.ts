// Better Auth, for the shop's admin only: email and password, no sign-ups, no emails sent, no IP addresses kept.
// There is no public /api/auth endpoint: sign-in goes through server actions that apply limits first.
// Created lazily so builds without a database still work.
import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { ACCOUNTS } from "@/config/shop";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { siteUrl } from "@/lib/site";

function createAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  return betterAuth({
    appName: "Demo Barbers",
    baseURL: siteUrl(),
    secret,
    database: drizzleAdapter(getDb(), { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: ACCOUNTS.passwordMinLength,
      maxPasswordLength: ACCOUNTS.passwordMaxLength,
    },
    session: { expiresIn: ACCOUNTS.sessionDays * 24 * 60 * 60 },
    user: { additionalFields: { role: { type: "string", input: false, defaultValue: "demo" } } },
    // Sessions keep no browser or device details.
    databaseHooks: {
      session: { create: { before: async (s) => ({ data: { ...s, userAgent: null, ipAddress: null } }) } },
    },
    // Limits are ours (hashed keys); Better Auth's own limiter would store raw IP addresses.
    rateLimit: { enabled: false },
    advanced: { ipAddress: { disableIpTracking: true }, useSecureCookies: process.env.VERCEL === "1" || undefined },
    plugins: [nextCookies()],
  });
}

let auth: ReturnType<typeof createAuth> | undefined;
export const getAuth = () => (auth ??= createAuth());
