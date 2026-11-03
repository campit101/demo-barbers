"use server";

// What the customer screens call. Each applies its per-connection limit first. Forms work with or without JavaScript.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LIMITS, barberById, serviceById } from "@/config/shop";
import { cancelBooking, rebook } from "@/booking/service";
import { getDeps } from "@/lib/deps";
import { verifyBookingLink } from "@/lib/manage-link";
import { clientAddress, consume, limitKey } from "@/lib/rate-limit";
import { requestOrigin } from "@/lib/origin";
import { refundDeposit, startCheckout } from "@/payments/settle";
import { readCustomer, readStart, slotMessage } from "./validate";

export interface BookState {
  message?: string;
  errors?: { name?: string; email?: string };
  /** The chosen time has gone: the screen should send the customer back to pick another. */
  slotGone?: boolean;
}

const HOUR = 3600;
const TOO_MANY = "Too many attempts from this connection. Please wait a while and try again.";

/** Holds the slot and sends the customer to Stripe. Fields: barberId, serviceId, start (ISO), name, email. */
export async function startBookingAction(_prev: BookState, form: FormData): Promise<BookState> {
  const customer = readCustomer(form.get("name"), form.get("email"));
  if (!customer.ok) return { errors: customer.errors };
  const start = readStart(form.get("start"));
  const barberId = String(form.get("barberId") ?? "");
  const serviceId = String(form.get("serviceId") ?? "");
  if (!start || !barberById(barberId) || !serviceById(serviceId)) return { message: slotMessage("bad-input"), slotGone: true };

  const deps = getDeps();
  const h = await headers();
  const byConnection = await consume(deps.db as never, limitKey("hold", clientAddress(h)), { max: LIMITS.holdsPerHourPerConnection, windowSeconds: HOUR });
  if (!byConnection.allowed) return { message: TOO_MANY };
  const byEmail = await consume(deps.db as never, limitKey("hold-email", customer.email), { max: LIMITS.holdsPerHourPerEmail, windowSeconds: HOUR });
  if (!byEmail.allowed) return { message: "Too many attempts for this email address. Please wait a while and try again." };

  const holdOwner = limitKey("hold-owner", clientAddress(h));
  const result = await startCheckout(deps, { barberId, serviceId, start, name: customer.name, email: customer.email, holdOwner }, await requestOrigin(), new Date());
  if (!result.ok) return { message: slotMessage(result.reason), slotGone: result.reason !== "payments-down" };
  redirect(result.url);
}

export interface ManageState {
  message?: string;
  slotGone?: boolean;
}

async function manageAllowed(): Promise<boolean> {
  const h = await headers();
  const r = await consume(getDeps().db as never, limitKey("manage", clientAddress(h)), { max: LIMITS.manageActionsPerHourPerConnection, windowSeconds: HOUR });
  return r.allowed;
}

/** Cancels from the private link. Field: token. */
export async function cancelBookingAction(_prev: ManageState, form: FormData): Promise<ManageState> {
  const token = String(form.get("token") ?? "");
  const id = verifyBookingLink(token);
  if (!id) return { message: "This link is not valid." };
  if (!(await manageAllowed())) return { message: TOO_MANY };
  const deps = getDeps();
  const now = new Date();
  const result = await cancelBooking(deps.db, id, now);
  if (!result.ok) {
    const words = { "not-found": "This demo booking has been deleted.", "not-active": "This booking is no longer active.", "already-started": "This booking has already started, so it cannot be cancelled." };
    return { message: words[result.reason] };
  }
  if (result.refund) await refundDeposit(deps, result.booking, now);
  redirect(`/manage/${encodeURIComponent(token)}`);
}

/** Moves a booking from the private link. Fields: token, barberId, start (ISO). */
export async function rebookAction(_prev: ManageState, form: FormData): Promise<ManageState> {
  const token = String(form.get("token") ?? "");
  const id = verifyBookingLink(token);
  if (!id) return { message: "This link is not valid." };
  if (!(await manageAllowed())) return { message: TOO_MANY };
  const start = readStart(form.get("start"));
  const barberId = String(form.get("barberId") ?? "");
  if (!start) return { message: slotMessage("bad-input"), slotGone: true };
  const deps = getDeps();
  const now = new Date();
  const result = await rebook(deps.db, id, { barberId, start }, now);
  if (!result.ok) {
    if (result.reason === "too-late") return { message: "This booking is less than 24 hours away, so it can no longer be moved." };
    if (result.reason === "not-found") return { message: "This demo booking has been deleted." };
    if (result.reason === "not-active") return { message: "This booking is no longer active." };
    return { message: slotMessage(result.reason), slotGone: true };
  }
  redirect(`/manage/${encodeURIComponent(token)}`);
}
