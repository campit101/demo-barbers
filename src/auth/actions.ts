"use server";

// Admin sign-in. Each attempt counts against a per-connection limit first, and against the account for typed passwords.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ACCOUNTS, LIMITS } from "@/config/shop";
import { getDb } from "@/db/client";
import { ensureSeedFresh } from "@/booking/seed";
import { clientAddress, consume, limitKey } from "@/lib/rate-limit";
import { getAuth } from "./server";

export interface SignInState {
  message?: string;
}

const HOUR = 3600;
const TOO_MANY = "Too many attempts from this connection. Please wait a while and try again.";

async function allowed(action: "sign-in" | "demo-sign-in"): Promise<boolean> {
  const r = await consume(getDb() as never, limitKey(action, clientAddress(await headers())), { max: LIMITS.signInsPerHourPerConnection, windowSeconds: HOUR });
  return r.allowed;
}

/** The normal sign-in form. Fields: email, password. */
export async function signInAction(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { message: "Please enter your email and password." };
  if (!(await allowed("sign-in"))) return { message: TOO_MANY };
  // Counted per account and connection: wrong guesses from one place must not lock the owner out from everywhere else.
  const perEmail = await consume(getDb() as never, limitKey("sign-in-email", `${email} ${clientAddress(await headers())}`), { max: LIMITS.signInsPerHourPerEmail, windowSeconds: HOUR });
  if (!perEmail.allowed) return { message: "Too many attempts for this account. Please wait a while and try again." };
  try {
    await getAuth().api.signInEmail({ body: { email, password }, headers: await headers() });
  } catch {
    return { message: "That email and password do not match." };
  }
  redirect("/admin");
}

/** "Try the admin": one button into the public demo account, with the demo diary rebuilt if it has gone stale. */
export async function demoSignInAction(): Promise<SignInState> {
  if (!(await allowed("demo-sign-in"))) return { message: TOO_MANY };
  await ensureSeedFresh(getDb(), new Date());
  try {
    await getAuth().api.signInEmail({ body: { email: ACCOUNTS.demo.email, password: ACCOUNTS.demo.password }, headers: await headers() });
  } catch {
    return { message: "The demo is not available just now. Please try again in a moment." };
  }
  redirect("/admin");
}

export async function signOutAction(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/admin/sign-in");
}
