// What the admin screens show. The public demo login never sees a visitor's name, email or reference, and cannot act on them.
import { BARBERS, SHOP, barberById, serviceById } from "../config/shop.ts";
import { listBooked, listDiary, type Booking, type Db } from "../booking/service.ts";
import { addDaysToKey, clock, formatMoney, londonParts, londonToUtc, shortDate } from "../lib/time.ts";
import { isClosedDateKey } from "../booking/slots.ts";

export type Role = "owner" | "demo";

export interface DiaryEntry {
  id: string;
  kind: "booking" | "block";
  barberId: string;
  dateKey: string;
  startMinute: number;
  endMinute: number;
  /** "09:00 to 09:30" */
  span: string;
  who: string;
  what: string;
  barber: string;
  status: string;
  statusText: string;
  price: string;
  deposit: string;
  pricePence: number;
  depositPence: number;
  /** Paid and not refunded, so the shop has this money. */
  depositHeld: boolean;
  reference: string;
  /** May this login change this row at all? */
  canAct: boolean;
  canMark: boolean;
  canRefund: boolean;
}

export function statusText(b: Pick<Booking, "kind" | "status" | "depositStatus" | "outcome">): string {
  if (b.kind === "block") return "Blocked";
  if (b.status === "held") return "Paying now (held for 10 minutes)";
  if (b.depositStatus === "refund_pending") return "Refund on its way";
  if (b.depositStatus === "refunded") return b.status === "cancelled" ? "Cancelled, deposit refunded" : "Deposit refunded";
  if (b.status === "no_show") return "No-show, deposit kept";
  if (b.status === "completed") return "Completed";
  if (b.status === "cancelled") return "Cancelled, deposit kept";
  return "Booked";
}

export function toEntry(b: Booking, role: Role, now: Date): DiaryEntry {
  const start = londonParts(b.startsAt);
  const end = londonParts(b.endsAt);
  const visitorHidden = role === "demo" && !b.isSeed;
  const canAct = b.kind === "booking" && !visitorHidden;
  const started = b.isSeed || b.startsAt.getTime() <= now.getTime();
  return {
    id: b.id,
    kind: b.kind === "block" ? "block" : "booking",
    barberId: b.barberId,
    dateKey: start.dateKey,
    startMinute: start.minute,
    endMinute: end.minute,
    span: `${clock(start.minute)} to ${clock(end.minute)}`,
    who: b.kind === "block" ? "Blocked" : visitorHidden ? "A visitor" : (b.customerName ?? ""),
    what: b.kind === "block" ? `until ${clock(end.minute)}` : (serviceById(b.serviceId ?? "")?.name ?? ""),
    barber: barberById(b.barberId)?.name ?? b.barberId,
    status: b.status,
    statusText: statusText(b),
    price: formatMoney(b.pricePence ?? 0),
    deposit: formatMoney(b.depositPence ?? 0),
    pricePence: b.pricePence ?? 0,
    depositPence: b.depositPence ?? 0,
    depositHeld: b.depositStatus === "paid" || b.depositStatus === "kept",
    reference: visitorHidden ? "" : (b.reference ?? ""),
    canAct,
    canMark: canAct && b.status === "confirmed" && started,
    canRefund: canAct && (b.depositStatus === "paid" || b.depositStatus === "kept"),
  };
}

const dayBounds = (dateKey: string) => [londonToUtc(dateKey, 0), londonToUtc(addDaysToKey(dateKey, 1), 0)] as const;

export interface DayView {
  dateKey: string;
  title: string;
  closed: boolean;
  isToday: boolean;
  prevKey: string;
  nextKey: string;
  columns: { barberId: string; name: string; entries: DiaryEntry[] }[];
  count: number;
  depositsHeld: string;
  stillToPay: string;
}

export async function dayView(db: Db, dateKey: string, role: Role, now: Date): Promise<DayView> {
  const [from, to] = dayBounds(dateKey);
  const rows = (await listDiary(db, from, to, now)).map((b) => toEntry(b, role, now));
  const bookings = rows.filter((e) => e.kind === "booking");
  const held = bookings.filter((e) => e.depositHeld).reduce((a, e) => a + e.depositPence, 0);
  const due = bookings.filter((e) => e.status === "confirmed").reduce((a, e) => a + e.pricePence - e.depositPence, 0);
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const long = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return {
    dateKey,
    title: long.replace(",", ""),
    closed: isClosedDateKey(dateKey),
    isToday: dateKey === londonParts(now).dateKey,
    prevKey: addDaysToKey(dateKey, -1),
    nextKey: addDaysToKey(dateKey, 1),
    columns: BARBERS.map((b) => ({ barberId: b.id, name: b.name, entries: rows.filter((e) => e.barberId === b.id) })),
    count: bookings.length,
    depositsHeld: formatMoney(held),
    stillToPay: formatMoney(due),
  };
}

export interface WeekView {
  startKey: string;
  prevKey: string;
  nextKey: string;
  days: { dateKey: string; label: string; closed: boolean; isToday: boolean }[];
  rows: { barberId: string; name: string; cells: { dateKey: string; closed: boolean; count: number; entries: DiaryEntry[] }[] }[];
}

export async function weekView(db: Db, startKey: string, role: Role, now: Date): Promise<WeekView> {
  const keys = Array.from({ length: 7 }, (_, i) => addDaysToKey(startKey, i));
  const from = dayBounds(keys[0]!)[0];
  const to = dayBounds(keys[6]!)[1];
  const rows = (await listDiary(db, from, to, now)).map((b) => toEntry(b, role, now));
  const today = londonParts(now).dateKey;
  return {
    startKey,
    prevKey: addDaysToKey(startKey, -7),
    nextKey: addDaysToKey(startKey, 7),
    days: keys.map((k) => ({ dateKey: k, label: shortDate(k).split(" ").slice(0, 2).join(" "), closed: isClosedDateKey(k), isToday: k === today })),
    rows: BARBERS.map((b) => ({
      barberId: b.id,
      name: b.name,
      cells: keys.map((k) => {
        const entries = rows.filter((e) => e.barberId === b.id && e.dateKey === k);
        return { dateKey: k, closed: isClosedDateKey(k), count: entries.filter((e) => e.kind === "booking").length, entries };
      }),
    })),
  };
}

export interface BookedRow {
  id: string;
  day: string;
  dateKey: string;
  time: string;
  who: string;
  what: string;
  barber: string;
  deposit: string;
  statusText: string;
}

export async function bookedView(db: Db, role: Role, now: Date) {
  const today = londonParts(now).dateKey;
  const from = londonToUtc(today, 0);
  const to = londonToUtc(addDaysToKey(today, SHOP.bookingWindowDays), 0);
  const rows = await listBooked(db, from, to, now);
  const list: BookedRow[] = rows.map((b) => {
    const e = toEntry(b, role, now);
    return { id: e.id, day: shortDate(e.dateKey), dateKey: e.dateKey, time: clock(e.startMinute), who: e.who, what: e.what, barber: e.barber, deposit: e.deposit, statusText: e.statusText };
  });
  const heldPence = rows.filter((b) => b.depositStatus === "paid" || b.depositStatus === "kept").reduce((a, b) => a + (b.depositPence ?? 0), 0);
  return { rows: list, count: list.length, depositsHeld: formatMoney(heldPence) };
}
