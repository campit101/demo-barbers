// The real database and Stripe, in one place for routes and actions. This demo sends no email.
import "server-only";
import { getDb } from "@/db/client";
import type { Deps } from "@/payments/settle";
import { getStripe } from "@/payments/stripe";

export const getDeps = (): Deps => ({ db: getDb(), stripe: getStripe() });
