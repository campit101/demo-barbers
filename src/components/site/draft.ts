// What someone typed before pressing Pay, so the browser's Back button from Stripe does not blank it. This tab only, never
// localStorage or a cookie, and cleared after a successful return. Storage can be blocked, so every step here may quietly do nothing.
const KEY = "db-book-draft";

export interface BookingDraft {
  name: string;
  email: string;
  /** The time and barber Pay was pressed for. This visitor may hold that time themselves, so it being off sale proves nothing. */
  start: string;
  barber: string;
}

export function saveDraft(draft: BookingDraft): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // The flow works without it.
  }
}

export function readDraft(): BookingDraft | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Partial<BookingDraft> | null;
    if (!raw || typeof raw.name !== "string" || typeof raw.email !== "string") return null;
    return { name: raw.name, email: raw.email, start: String(raw.start ?? ""), barber: String(raw.barber ?? "") };
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing was saved, then.
  }
}
