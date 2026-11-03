import type { Metadata } from "next";
import Link from "next/link";
import { loadManaged } from "@/booking/managed";
import { manageView, type Booking } from "@/booking/service";
import { ManageActions } from "@/components/site/ManageActions";
import { Outcome } from "@/components/site/Outcome";
import { barberById, serviceById } from "@/config/shop";
import { formatMoney, formatWhen } from "@/lib/time";

export const metadata: Metadata = { title: "Your booking" };
export const dynamic = "force-dynamic";

function Gone({ title, text }: { title: string; text: string }) {
  return (
    <Outcome>
      <h1 className="disp book-h">{title}</h1>
      <p className="para">{text}</p>
      <div className="acts">
        <Link className="btn" href="/book">
          Book again
        </Link>
        <Link className="btn2" href="/">
          Back to the shop
        </Link>
      </div>
    </Outcome>
  );
}

function cancelledWords(b: Booking, deposit: string): string {
  if (b.outcome === "late-payment-lost-slot") return `The time went while you were paying, so your ${deposit} deposit is refunded in full.`;
  if (b.depositStatus === "refunded") return `Your ${deposit} deposit has been refunded and the time is free again.`;
  if (b.depositStatus === "refund_pending") return `Your ${deposit} deposit is being refunded and the time is free again.`;
  if (b.depositStatus === "kept") return `The time is free again. The ${deposit} deposit was kept because it was less than 24 hours away.`;
  return "The time is free again.";
}

export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const booking = await loadManaged(token);
  if (!booking) return <Gone title="Booking not found" text="This demo booking has been deleted, or the link is not valid. Demo data is removed after 24 hours." />;

  const now = new Date();
  const service = serviceById(booking.serviceId ?? "");
  const barber = barberById(booking.barberId);
  const deposit = formatMoney(booking.depositPence ?? 0);

  // One message for both: someone can back out in seconds or let the 10 minutes run out, and the row cannot always tell which.
  if (booking.status === "held" || booking.status === "expired") return <Gone title="Not booked" text="This time is not booked, because the deposit was not paid. Nothing was charged." />;
  if (booking.status === "cancelled") return <Gone title="Booking cancelled" text={cancelledWords(booking, deposit)} />;

  const view = manageView(booking, now);
  let rule = "This booking has already started, so it can no longer be changed.";
  if (booking.status !== "confirmed") rule = "This visit is finished, so there is nothing left to change.";
  else if (view.canChange) rule = `This is more than 24 hours away, so you can move it, or cancel for free and have your ${deposit} deposit refunded.`;
  else if (view.canCancel) rule = `This is less than 24 hours away, so it can no longer be moved, and if you cancel the ${deposit} deposit is kept.`;

  return (
    <Outcome>
      <h1 className="disp book-h">Your booking</h1>
      <dl className="sum">
        <dt>Service</dt>
        <dd>{service?.name}</dd>
        <dt>Barber</dt>
        <dd>{barber?.name}</dd>
        <dt>When</dt>
        <dd>{formatWhen(booking.startsAt, now)}</dd>
        <dt>Deposit paid</dt>
        <dd>{deposit}</dd>
        <dt>Pay in the shop</dt>
        <dd>{formatMoney((booking.pricePence ?? 0) - (booking.depositPence ?? 0))}</dd>
      </dl>
      <p className="para">{rule}</p>
      <ManageActions
        token={token}
        rebookHref={view.canChange ? `/manage/${encodeURIComponent(token)}/rebook` : null}
        canCancel={view.canCancel}
        cancelLabel={view.canChange ? `Cancel and refund ${deposit}` : "Cancel and lose deposit"}
        confirmText={view.canChange ? `Cancel this booking? Your ${deposit} deposit will be refunded and the time goes back on sale.` : `Cancel this booking? It is less than 24 hours away, so you will not get the ${deposit} deposit back.`}
      />
    </Outcome>
  );
}
