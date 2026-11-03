import type { Metadata } from "next";
import Link from "next/link";
import { loadManaged } from "@/booking/managed";
import { manageView } from "@/booking/service";
import { Outcome } from "@/components/site/Outcome";
import { RebookFlow } from "@/components/site/RebookFlow";
import { serviceById } from "@/config/shop";
import { formatWhen } from "@/lib/time";

export const metadata: Metadata = { title: "Move your booking" };
export const dynamic = "force-dynamic";

export default async function RebookPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const booking = await loadManaged(token);
  const now = new Date();

  if (!booking) {
    return (
      <Outcome>
        <h1 className="disp book-h">Booking not found</h1>
        <p className="para">This demo booking has been deleted, or the link is not valid. Demo data is removed after 24 hours.</p>
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

  const service = serviceById(booking.serviceId ?? "");
  if (!service || !manageView(booking, now).canChange) {
    return (
      <Outcome>
        <h1 className="disp book-h">This booking cannot be moved</h1>
        <p className="para">A booking can only be moved while it is active and more than 24 hours away.</p>
        <div className="acts">
          <Link className="btn" href={`/manage/${encodeURIComponent(token)}`}>
            Back to your booking
          </Link>
        </div>
      </Outcome>
    );
  }

  return (
    <Outcome>
      <RebookFlow token={token} serviceId={service.id} serviceName={service.name} minutes={service.minutes} barberId={booking.barberId} currentWhen={formatWhen(booking.startsAt, now)} />
    </Outcome>
  );
}
