import "server-only";

// Kept out of the "use server" actions file, so it is a plain server function and not something a browser can call.
import { getBooking, isVisible } from "@/booking/service";
import { getDeps } from "@/lib/deps";
import { verifyBookingLink } from "@/lib/manage-link";

/** For the booking pages: the booking behind a private link, if it is genuine and still visible. */
export async function loadManaged(token: string) {
  const id = verifyBookingLink(token);
  if (!id) return null;
  const b = await getBooking(getDeps().db, id);
  return b && b.kind === "booking" && isVisible(b, new Date()) ? b : null;
}
