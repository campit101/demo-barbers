// Stripe's signed webhook. Refuses anything unsigned, wrongly signed or live; repeats are harmless.
import Stripe from "stripe";
import { getDeps } from "@/lib/deps";
import { requestOrigin } from "@/lib/origin";
import { handleEvent } from "@/payments/settle";

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook is not set up here", { status: 503 });
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });
  // The signature covers the exact bytes Stripe sent, so read the body as text before anything parses it.
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(body, signature, secret);
  } catch {
    return new Response("Bad signature", { status: 400 });
  }
  const result = await handleEvent(getDeps(), event, new Date(), await requestOrigin());
  return new Response(result.body, { status: result.status });
}
