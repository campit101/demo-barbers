"use server";

// Thin wrappers for the two cases where the row leaves the diary, so its form unmounts and could not show a message:
// refunding a booked customer frees the time, and removing a block deletes it. The message travels in the address instead.
import { redirect } from "next/navigation";
import { bookingAction, removeBlockAction, type AdminState } from "@/admin/actions";
import { isDateKey } from "@/lib/time";

// The page checks the row named by `b` before believing `done`, so a typed or reloaded address cannot claim something happened.
const dayHref = (form: FormData, done: string) => {
  const raw = form.get("date");
  const params = new URLSearchParams();
  if (isDateKey(raw)) params.set("date", raw);
  params.set("b", String(form.get("id") ?? ""));
  params.set("done", done);
  return `/admin?${params.toString()}`;
};

export async function bookingFormAction(prev: AdminState, form: FormData): Promise<AdminState> {
  const result = await bookingAction(prev, form);
  if (form.get("action") === "refund") {
    if (result.ok) redirect(dayHref(form, "refund"));
    if (result.message?.startsWith("Stripe")) redirect(dayHref(form, "refund-later"));
  }
  return result;
}

export async function removeBlockFormAction(prev: AdminState, form: FormData): Promise<AdminState> {
  const result = await removeBlockAction(prev, form);
  if (result.ok) redirect(dayHref(form, "removed"));
  return result;
}
