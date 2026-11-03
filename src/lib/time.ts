// London wall-clock time. All storage is UTC; everything a person reads or picks is Europe/London, so a 09:00 slot stays
// 09:00 either side of the clock change. A "date key" is a London calendar date, YYYY-MM-DD.
import { SHOP } from "../config/shop.ts";

const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: SHOP.timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export interface LondonParts {
  dateKey: string;
  year: number;
  month: number;
  day: number;
  /** Minutes since London midnight. */
  minute: number;
  /** 0 is Sunday. */
  weekday: number;
}

export function londonParts(at: Date): LondonParts {
  const p: Record<string, string> = {};
  for (const part of PARTS.formatToParts(at)) p[part.type] = part.value;
  const year = Number(p.year);
  const month = Number(p.month);
  const day = Number(p.day);
  return {
    dateKey: `${p.year}-${p.month}-${p.day}`,
    year,
    month,
    day,
    minute: Number(p.hour) * 60 + Number(p.minute),
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

/** How far London is ahead of UTC at this moment, in minutes (0 in winter, 60 in summer). */
function londonOffsetMinutes(at: Date): number {
  const p = londonParts(at);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, 0, p.minute);
  return Math.round((asIfUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

/** The instant of a London date and minute-of-day. */
export function londonToUtc(dateKey: string, minute: number): Date {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, 0, minute);
  const first = new Date(naive - londonOffsetMinutes(new Date(naive)) * 60000);
  return new Date(naive - londonOffsetMinutes(first) * 60000);
}

export function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** A real calendar date in a sensible range. 30 February is refused rather than rolling on to March. */
export function isDateKey(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const year = Number(v.slice(0, 4));
  if (year < 2020 || year > 2100) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const pad2 = (n: number) => String(n).padStart(2, "0");
export const clock = (minute: number) => `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`;
export const formatTime = (at: Date) => clock(londonParts(at).minute);

function keyParts(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  return { month: m, day: d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** "Tue 3 Nov" */
export function shortDate(dateKey: string): string {
  const k = keyParts(dateKey);
  return `${DAY[k.weekday]} ${k.day} ${MONTH[k.month - 1]}`;
}

/** "Tuesday 3 November" */
export function longDate(dateKey: string): string {
  const k = keyParts(dateKey);
  return `${DAY_LONG[k.weekday]} ${k.day} ${MONTH_LONG[k.month - 1]}`;
}

/** "Today", "Tomorrow" or "Tue 3 Nov". */
export function friendlyDate(dateKey: string, now: Date): string {
  const today = londonParts(now).dateKey;
  if (dateKey === today) return "Today";
  if (dateKey === addDaysToKey(today, 1)) return "Tomorrow";
  return shortDate(dateKey);
}

/** "Tue 3 Nov, 14:00" */
export const formatWhen = (at: Date, now?: Date) => {
  const p = londonParts(at);
  return `${now ? friendlyDate(p.dateKey, now) : shortDate(p.dateKey)}, ${clock(p.minute)}`;
};

export const formatMoney = (pence: number) => `£${(pence / 100).toFixed(2)}`;
export const formatPrice = (pence: number) => (pence % 100 === 0 ? `£${pence / 100}` : formatMoney(pence));
