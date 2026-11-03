import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { ClearDraft } from "@/components/site/ClearDraft";
import { Outcome } from "@/components/site/Outcome";
import { SaveLink } from "@/components/site/SaveLink";
import { confirmReturn } from "@/booking/return";
import { barberById, serviceById } from "@/config/shop";
import { clientAddress } from "@/lib/rate-limit";
import { requestOrigin } from "@/lib/origin";
import { formatMoney, formatWhen } from "@/lib/time";

export const metadata: Metadata = { title: "Your booking" };

function Plain({ title, text, action, href }: { title: string; text: string; action: string; href: string }) {
  return (
    <Outcome>
      <h1 className="disp book-h">{title}</h1>
      <p className="para">{text}</p>
      <div className="acts">
        <Link className="btn" href={href}>
          {action}
        </Link>
        <Link className="btn2" href="/">
          Back to the shop
        </Link>
      </div>
    </Outcome>
  );
}

export default async function DonePage({ searchParams }: { searchParams: Promise<{ session_id?: string | string[] }> }) {
  const raw = (await searchParams).session_id;
  const sessionId = typeof raw === "string" ? raw : null;
  const { outcome, booking, manageHref } = await confirmReturn(sessionId, clientAddress(await headers()));

  switch (outcome) {
    case "refunded-lost":
    case "refunded-missing":
      return <Plain title="That time has gone" text="The time went while you were paying, so your deposit is being refunded in full. You do not need to do anything." action="Pick another time" href="/book" />;
    case "unpaid":
      return <Plain title="Payment not finished" text="Your payment is not finished, so this time is not booked yet. Nothing has been charged." action="Pick a time" href="/book" />;
    case "released":
      return <Plain title="Nothing was booked" text="The payment page closed before you paid, so the time has gone back on sale. Nothing was charged." action="Pick a time" href="/book" />;
    case "ignored":
      return <Plain title="Nothing to show here" text="This payment does not belong to a booking at this shop." action="Book a chair" href="/book" />;
    case "bad-link":
      return <Plain title="This link is not valid" text="We cannot find a payment from this link. If you have paid, the private link you saved after paying still works." action="Book a chair" href="/book" />;
    case "too-many":
      return <Plain title="Too many checks" text="This connection has checked a lot of payments in the last hour. If you paid, your booking is safe. Try this page again in an hour to see your private link." action="Back to booking" href="/book" />;
    case "unreachable":
      return <Plain title="We could not check your payment" text="We could not reach the payment service just now. If you paid, your booking is safe. Try this page again in a moment." action="Try again" href={`/booking/done?session_id=${encodeURIComponent(sessionId ?? "")}`} />;
  }

  // Confirmed, or already confirmed on an earlier visit.
  if (!booking || !manageHref) return <Plain title="We could not find that booking" text="It may have been deleted: demo data is removed after 24 hours." action="Book a chair" href="/book" />;
  const service = serviceById(booking.serviceId ?? "");
  const barber = barberById(booking.barberId);
  const price = booking.pricePence ?? 0;
  const deposit = booking.depositPence ?? 0;

  if (booking.status === "cancelled") {
    return (
      <Outcome>
        <h1 className="disp book-h">Booking cancelled</h1>
        <p className="para">This booking has since been cancelled. Your private link has the details.</p>
        <div className="acts">
          <Link className="btn" href={manageHref}>
            See your booking
          </Link>
          <Link className="btn2" href="/book">
            Book again
          </Link>
        </div>
      </Outcome>
    );
  }

  return (
    <Outcome>
      <ClearDraft />
      <span className="done-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <h1 className="disp book-h">You&apos;re booked, {(booking.customerName ?? "friend").split(" ")[0]}</h1>
      <dl className="sum">
        <dt>Service</dt>
        <dd>{service?.name}</dd>
        <dt>Barber</dt>
        <dd>{barber?.name}</dd>
        <dt>When</dt>
        <dd>{formatWhen(booking.startsAt, new Date())}</dd>
        <dt>Deposit paid</dt>
        <dd>{formatMoney(deposit)}</dd>
        <dt>Pay in the shop</dt>
        <dd>{formatMoney(price - deposit)}</dd>
      </dl>
      <p className="notice">
        Save your private link now. This demo sends no emails, so the link is the only way to cancel or move this booking. A real shop would email it to you.
      </p>
      <SaveLink url={new URL(manageHref, await requestOrigin()).href} />
      <div className="acts">
        <Link className="btn" href={manageHref}>
          Manage your booking
        </Link>
        <Link className="btn2" href="/">
          Back to the shop
        </Link>
      </div>
    </Outcome>
  );
}
