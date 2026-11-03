import type { Metadata } from "next";
import Link from "next/link";
import { Outcome } from "@/components/site/Outcome";
import { releaseFromCancel } from "@/booking/return";

export const metadata: Metadata = { title: "Payment cancelled" };

export default async function CancelledPage({ searchParams }: { searchParams: Promise<{ b?: string | string[] }> }) {
  const raw = (await searchParams).b;
  const token = typeof raw === "string" ? raw : null;
  const booking = await releaseFromCancel(token);

  // An old tab can land here after the deposit was paid after all: saying "nothing was charged" would then be untrue.
  if (booking && booking.depositStatus !== "none") {
    return (
      <Outcome>
        <h1 className="disp book-h">This booking was paid</h1>
        <p className="para">The deposit for this booking has already been taken, so it was not released. Your private link has the details.</p>
        <div className="acts">
          <Link className="btn" href={`/manage/${encodeURIComponent(token ?? "")}`}>
            See your booking
          </Link>
          <Link className="btn2" href="/">
            Back to the shop
          </Link>
        </div>
      </Outcome>
    );
  }

  const back = new URLSearchParams({ notice: "cancelled" });
  if (booking?.serviceId) {
    back.set("service", booking.serviceId);
    back.set("barber", booking.barberId);
  }
  return (
    <Outcome>
      <h1 className="disp book-h">Nothing was charged</h1>
      <p className="para">{booking ? "You left the payment page, so the time you picked has gone back on sale." : "You left the payment page without paying."} You can pick a time again whenever you like.</p>
      <div className="acts">
        <Link className="btn" href={`/book?${back}`}>
          Pick a time
        </Link>
        <Link className="btn2" href="/">
          Back to the shop
        </Link>
      </div>
    </Outcome>
  );
}
