import { isClosedDateKey } from "@/booking/slots";
import { addDaysToKey, isDateKey, londonParts } from "@/lib/time";

/** This date if it is open, otherwise the next day the shop opens. */
export function nextOpenKey(dateKey: string): string {
  let key = dateKey;
  while (isClosedDateKey(key)) key = addDaysToKey(key, 1);
  return key;
}

/** Today in London, skipping the days the shop is shut. */
export const defaultDateKey = (now: Date) => nextOpenKey(londonParts(now).dateKey);

/** A date from the address, normalised, or null if it is not one. */
export const dateFromParam = (raw: unknown): string | null => (isDateKey(raw) ? addDaysToKey(raw, 0) : null);
