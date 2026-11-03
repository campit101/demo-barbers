// Checks what customers type. Names show in the shop's diary, so anything that could carry a link is refused.

export interface CustomerErrors {
  name?: string;
  email?: string;
}

export function readCustomer(rawName: unknown, rawEmail: unknown): { ok: true; name: string; email: string } | { ok: false; errors: CustomerErrors } {
  // Phones type a curly apostrophe; store the plain one.
  const name = String(rawName ?? "").trim().replace(/\s+/g, " ").replace(/[\u2018\u2019\u02BC]/g, "'");
  const email = String(rawEmail ?? "").trim().toLowerCase();
  const errors: CustomerErrors = {};
  if (name.length < 2) errors.name = "Please add your name.";
  else if (name.length > 60) errors.name = "That name is too long. Please use 60 characters or fewer.";
  else if (!/^[\p{L}\p{M}][\p{L}\p{M}' .-]*$/u.test(name) || /\.[\p{L}]{2,}/u.test(name)) errors.name = "Please use letters, spaces, hyphens and apostrophes only.";
  if (!email) errors.email = "Please add your email address.";
  else if (email.length > 254 || !/^[^@\s<>"]+@[^@\s<>"']+\.[^@\s<>"'.]{2,}$/.test(email) || /\.\.|^\.|\.@|@\./.test(email)) errors.email = "That email address does not look right. Check it and try again.";
  if (errors.name || errors.email) return { ok: false, errors };
  return { ok: true, name, email };
}

/** A start time from a form: only a full ISO instant is accepted. */
export function readStart(raw: unknown): Date | null {
  const v = String(raw ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** What to tell a customer when a time cannot be booked. */
export function slotMessage(reason: string): string {
  switch (reason) {
    case "taken":
      return "Someone has just taken that time. Please pick another.";
    case "past":
    case "too-soon":
      return "That time has passed. Please pick a later one.";
    case "too-far":
      return "That date is too far ahead. You can book in the next 14 days.";
    case "closed":
      return "The shop is closed that day. Please pick another.";
    case "past-closing":
      return "That service would run past closing. Please pick an earlier time.";
    case "payments-down":
      return "We could not reach the payment service. You have not been charged. Please try again in a moment.";
    default:
      return "That time cannot be booked. Please pick another.";
  }
}
