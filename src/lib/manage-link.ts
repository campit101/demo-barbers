// A customer's private link: the booking id plus a signature only this app can make. Nothing needs storing,
// and a guessed or altered link fails the check.
import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  const s = process.env.MANAGE_LINK_SECRET;
  if (!s) throw new Error("MANAGE_LINK_SECRET is not set");
  return s;
}

const sign = (id: string) => createHmac("sha256", secret()).update(`manage:${id}`).digest("base64url");

export const signBookingLink = (id: string) => `${id}.${sign(id)}`;

/** Returns the booking id if the link is genuine, otherwise null. */
export function verifyBookingLink(token: string | null | undefined): string | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const id = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(id));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return /^[0-9a-f-]{36}$/.test(id) ? id : null;
}
