"use server";

// What the admin screens call. Every action checks who is signed in first. The demo login may touch seeded rows only.
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { LIMITS } from "@/config/shop";
import { requireAdmin } from "@/auth/session";
import { adminAct, blockTime, removeBlock, type AdminAction } from "@/booking/service";
import { getDeps } from "@/lib/deps";
import { clientAddress, consume, limitKey } from "@/lib/rate-limit";
import { refundDeposit } from "@/payments/settle";

export interface AdminState {
  message?: string;
  ok?: boolean;
}

const WORDS = {
  "not-found": "That booking no longer exists.",
  "not-allowed": "That cannot be done to this booking now.",
  "not-yet": "This booking has not started yet.",
  "seed-only": "The demo login can only change the made-up bookings. This one belongs to a visitor.",
} as const;

const DONE: Record<AdminAction, string> = { completed: "Marked completed.", no_show: "Marked no-show. The deposit is kept.", refund: "Refund sent to the customer." };

async function guard() {
  const user = await requireAdmin();
  const deps = getDeps();
  if (user.role === "demo") {
    const r = await consume(deps.db as never, limitKey("demo-action", clientAddress(await headers())), { max: LIMITS.demoActionsPerHourPerConnection, windowSeconds: 3600 });
    if (!r.allowed) return { user, deps, blocked: true as const };
  }
  return { user, deps, blocked: false as const };
}

/** Fields: id, action (completed | no_show | refund). */
export async function bookingAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  const { user, deps, blocked } = await guard();
  if (blocked) return { message: "Too many changes from this connection. Please wait a while." };
  const action = String(form.get("action") ?? "") as AdminAction;
  if (!["completed", "no_show", "refund"].includes(action)) return { message: "Unknown action." };
  const now = new Date();
  const r = await adminAct(deps.db, String(form.get("id") ?? ""), action, { seedOnly: user.role === "demo" }, now);
  if (!r.ok) return { message: WORDS[r.reason] };
  if (r.refund && !(await refundDeposit(deps, r.booking, now))) {
    revalidatePath("/admin", "layout");
    return { message: "Stripe did not respond. The refund will be retried automatically." };
  }
  revalidatePath("/admin", "layout");
  return { ok: true, message: DONE[action] };
}

const BLOCK_WORDS = {
  taken: "That overlaps a booking or another block. Move it or refund it first.",
  "bad-input": "Choose a start before the end.",
  closed: "The shop is closed that day.",
  "outside-hours": "Choose a time between 09:00 and 18:00.",
  past: "That time has already gone.",
  "too-far": "That date is too far ahead.",
  "too-long": "The demo login can block up to 2 hours at a time.",
} as const;

const minuteOf = (v: unknown) => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(v ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** Fields: barberId, date (YYYY-MM-DD), from (HH:MM), to (HH:MM). */
export async function blockAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  const { user, deps, blocked } = await guard();
  if (blocked) return { message: "Too many changes from this connection. Please wait a while." };
  const dateKey = String(form.get("date") ?? "");
  const r = await blockTime(
    deps.db,
    { barberId: String(form.get("barberId") ?? ""), dateKey, fromMinute: minuteOf(form.get("from")), toMinute: minuteOf(form.get("to")), isSeed: user.role === "demo" },
    new Date(),
  );
  if (!r.ok) return { message: BLOCK_WORDS[r.reason] };
  revalidatePath("/admin", "layout");
  redirect(`/admin?date=${dateKey}`);
}

/** Field: id. */
export async function removeBlockAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  const { user, deps, blocked } = await guard();
  if (blocked) return { message: "Too many changes from this connection. Please wait a while." };
  const gone = await removeBlock(deps.db, String(form.get("id") ?? ""), { seedOnly: user.role === "demo" });
  revalidatePath("/admin", "layout");
  return gone ? { ok: true, message: "Block removed." } : { message: "That block cannot be removed." };
}
