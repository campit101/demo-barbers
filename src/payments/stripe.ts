// Stripe, in sandbox mode only: a live key is refused here and in the build. Hosted Checkout, so no card data touches this app.
import Stripe from "stripe";
import { APP_TAG, SHOP, barberById, serviceById } from "../config/shop.ts";
import type { Booking } from "../booking/service.ts";
import { assertTestStripeKey } from "../lib/guards.ts";
import { signBookingLink } from "../lib/manage-link.ts";
import { formatWhen } from "../lib/time.ts";

let client: Stripe | undefined;

export function getStripe(): Stripe {
  client ??= new Stripe(assertTestStripeKey(process.env.STRIPE_SECRET_KEY), { maxNetworkRetries: 2, timeout: 8000 });
  return client;
}

/** Just the parts of Stripe this app uses, so tests can stand in for it. */
export interface PaymentsApi {
  checkout: {
    sessions: {
      create: (params: Stripe.Checkout.SessionCreateParams, options?: Stripe.RequestOptions) => Promise<Pick<Stripe.Checkout.Session, "id" | "url">>;
      retrieve: (id: string) => Promise<Stripe.Checkout.Session>;
      expire: (id: string) => Promise<unknown>;
    };
  };
  refunds: {
    create: (params: Stripe.RefundCreateParams, options?: Stripe.RequestOptions) => Promise<unknown>;
  };
}

export function sessionParams(booking: Booking, origin: string, now: Date): Stripe.Checkout.SessionCreateParams {
  const service = serviceById(booking.serviceId ?? "");
  const barber = barberById(booking.barberId);
  if (!service || !barber || booking.depositPence == null || !booking.customerEmail) throw new Error("Booking cannot be paid for");
  const metadata = { app: APP_TAG, bookingId: booking.id, reference: booking.reference ?? "" };
  return {
    mode: "payment",
    locale: "en-GB",
    customer_email: booking.customerEmail,
    client_reference_id: booking.id,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: booking.depositPence,
          product_data: {
            name: `${SHOP.depositPercent}% deposit: ${service.name} with ${barber.name}`,
            description: `${formatWhen(booking.startsAt)}. Demo shop, test payments only.`,
          },
        },
      },
    ],
    metadata,
    payment_intent_data: { metadata },
    // Stripe's minimum is 30 minutes. The app's own hold is 10; a payment landing later is handled in settle.ts.
    expires_at: Math.floor(now.getTime() / 1000) + SHOP.stripeSessionMinutes * 60 + 30,
    success_url: `${origin}/booking/done?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/booking/cancelled?b=${encodeURIComponent(signBookingLink(booking.id))}`,
  };
}
