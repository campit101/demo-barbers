// The rules for which times can be booked. Pure functions: no database, so every edge case can be tested directly.
import { SHOP } from "../config/shop.ts";
import { addDaysToKey, londonParts, londonToUtc } from "../lib/time.ts";

export interface Span {
  start: Date;
  end: Date;
}

export type SlotProblem = "past" | "too-soon" | "too-far" | "closed" | "before-open" | "past-closing" | "off-grid";

export const isClosedDay = (weekday: number) => SHOP.closedDays.includes(weekday);

export function isClosedDateKey(dateKey: string): boolean {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  return isClosedDay(new Date(Date.UTC(y, m - 1, d)).getUTCDay());
}

/** Why a start time cannot be booked, or null if the shop's hours allow it. Says nothing about other bookings. */
export function slotProblem(start: Date, minutes: number, now: Date): SlotProblem | null {
  const at = londonParts(start);
  if (start.getTime() <= now.getTime()) return "past";
  if (start.getTime() < now.getTime() + SHOP.leadMinutes * 60000) return "too-soon";
  const lastDay = addDaysToKey(londonParts(now).dateKey, SHOP.bookingWindowDays - 1);
  if (at.dateKey > lastDay) return "too-far";
  if (isClosedDay(at.weekday)) return "closed";
  if (at.minute < SHOP.openMinute) return "before-open";
  if (at.minute + minutes > SHOP.closeMinute) return "past-closing";
  if (start.getUTCSeconds() !== 0 || start.getUTCMilliseconds() !== 0 || (at.minute - SHOP.openMinute) % SHOP.slotStepMinutes !== 0) return "off-grid";
  return null;
}

export const overlaps = (a: Span, b: Span) => a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();

/** Every start time on a London date that fits this service, the shop's hours and the busy spans. */
export function openSlots(dateKey: string, minutes: number, busy: readonly Span[], now: Date): Date[] {
  if (isClosedDateKey(dateKey)) return [];
  const out: Date[] = [];
  for (let m = SHOP.openMinute; m + minutes <= SHOP.closeMinute; m += SHOP.slotStepMinutes) {
    const start = londonToUtc(dateKey, m);
    if (slotProblem(start, minutes, now)) continue;
    const span = { start, end: new Date(start.getTime() + minutes * 60000) };
    if (!busy.some((b) => overlaps(span, b))) out.push(start);
  }
  return out;
}

/** The London dates a customer can choose from, starting today. */
export function bookingDays(now: Date): string[] {
  const today = londonParts(now).dateKey;
  return Array.from({ length: SHOP.bookingWindowDays }, (_, i) => addDaysToKey(today, i));
}

/** May this booking be cancelled with a refund, or moved? */
export const isFreeToChange = (startsAt: Date, now: Date) => startsAt.getTime() - now.getTime() >= SHOP.freeCancelHours * 3600000;
