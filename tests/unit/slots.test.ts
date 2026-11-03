import { describe, expect, it } from "vitest";
import { bookingDays, isFreeToChange, openSlots, slotProblem } from "@/booking/slots";
import { readCustomer } from "@/booking/validate";
import { NEON } from "@/config/shop";
import { assertTestDatabaseUrl, assertTestStripeKey, fingerprint } from "@/lib/guards";
import { formatPrice, formatTime, friendlyDate, isDateKey, londonParts, londonToUtc, shortDate } from "@/lib/time";

// 1 Nov 2026 is a Sunday. Tue 3 Nov is the first open day; clocks went back on Sun 25 Oct 2026 and go forward on Sun 28 Mar 2027.
const NOW = new Date("2026-11-01T10:00:00Z");

describe("what customers type", () => {
  const person = (name: string, email = "sam@example.com") => readCustomer(name, email);

  it("accepts the curly apostrophe phones type, and stores it straight", () => {
    expect(person("O’Brien")).toMatchObject({ ok: true, name: "O'Brien" });
    expect(person("Marie-Thérèse d’Arc")).toMatchObject({ ok: true, name: "Marie-Thérèse d'Arc" });
    expect(person("O'Brien")).toMatchObject({ ok: true });
  });

  it("still refuses names that could carry a link or markup", () => {
    for (const bad of ["see evil.com", "<b>Sam</b>", "Sam http://x", "1234"]) expect(person(bad).ok).toBe(false);
  });

  it("accepts an apostrophe in an email, and refuses addresses that cannot arrive", () => {
    expect(person("Sam", "o'brien@example.com")).toMatchObject({ ok: true });
    for (const bad of ["a@example..com", ".a@example.com", "a.@example.com", "a..b@example.com", "a@.example.com", "a@example.com'", "a@b"]) expect(person("Sam", bad).ok).toBe(false);
  });
});

describe("dates in addresses", () => {
  it("accepts real dates only, in a sensible range", () => {
    expect(isDateKey("2026-11-03")).toBe(true);
    expect(isDateKey("2028-02-29")).toBe(true);
    for (const bad of ["2026-02-30", "2027-02-29", "0000-01-01", "9999-12-31", "2026-13-01", "garbage"]) expect(isDateKey(bad)).toBe(false);
  });
});

describe("London time across the clock change", () => {
  it("09:00 is 08:00 UTC in summer time and 09:00 UTC in winter", () => {
    expect(londonToUtc("2026-10-24", 540).toISOString()).toBe("2026-10-24T08:00:00.000Z");
    expect(londonToUtc("2026-10-27", 540).toISOString()).toBe("2026-10-27T09:00:00.000Z");
    expect(londonToUtc("2027-03-27", 540).toISOString()).toBe("2027-03-27T09:00:00.000Z");
    expect(londonToUtc("2027-03-30", 540).toISOString()).toBe("2027-03-30T08:00:00.000Z");
  });

  it("round-trips the same wall clock on both sides", () => {
    for (const key of ["2026-10-24", "2026-10-27", "2027-03-27", "2027-03-30"]) {
      const at = londonToUtc(key, 600);
      expect(londonParts(at).dateKey).toBe(key);
      expect(formatTime(at)).toBe("10:00");
    }
  });

  it("offers the same 09:00 to 18:00 grid the day before and after the change", () => {
    const earlier = new Date("2026-10-20T10:00:00Z");
    const before = openSlots("2026-10-24", 30, [], earlier).map(formatTime);
    const after = openSlots("2026-10-27", 30, [], earlier).map(formatTime);
    expect(before).toEqual(after);
    expect(before[0]).toBe("09:00");
    expect(before.at(-1)).toBe("17:30");
  });

  it("counts 24 hours as real elapsed time across the change", () => {
    const start = londonToUtc("2026-10-27", 540);
    // 09:00 on Mon 26 Oct is exactly 24 hours before, both in GMT.
    expect(isFreeToChange(start, new Date("2026-10-26T09:00:00Z"))).toBe(true);
    expect(isFreeToChange(start, new Date("2026-10-26T09:00:01Z"))).toBe(false);
  });
});

describe("which times can be booked", () => {
  const tue = "2026-11-03";

  it("offers nothing on closed days", () => {
    expect(openSlots("2026-11-01", 30, [], NOW)).toEqual([]);
    expect(openSlots("2026-11-02", 30, [], NOW)).toEqual([]);
    expect(slotProblem(londonToUtc("2026-11-02", 600), 30, NOW)).toBe("closed");
  });

  it("never offers a service that would run past closing", () => {
    const slots = openSlots(tue, 50, [], NOW).map(formatTime);
    expect(slots.at(-1)).toBe("17:00");
    expect(slots).not.toContain("17:15");
    expect(slotProblem(londonToUtc(tue, 17 * 60 + 15), 50, NOW)).toBe("past-closing");
    expect(slotProblem(londonToUtc(tue, 17 * 60), 50, NOW)).toBeNull();
  });

  it("never offers a service that would overlap the next booking", () => {
    const busy = [{ start: londonToUtc(tue, 600), end: londonToUtc(tue, 630) }];
    const slots = openSlots(tue, 45, busy, NOW).map(formatTime);
    expect(slots).toContain("09:15");
    expect(slots).not.toContain("09:30");
    expect(slots).not.toContain("10:00");
    expect(slots).toContain("10:30");
  });

  it("drops past times and times inside the 15 minute lead", () => {
    const midday = londonToUtc(tue, 12 * 60);
    expect(slotProblem(londonToUtc(tue, 11 * 60), 30, midday)).toBe("past");
    expect(slotProblem(londonToUtc(tue, 12 * 60), 30, midday)).toBe("past");
    expect(slotProblem(new Date(midday.getTime() + 10 * 60000), 30, midday)).toBe("too-soon");
    const slots = openSlots(tue, 30, [], midday).map(formatTime);
    expect(slots[0]).toBe("12:15");
  });

  it("refuses off-grid times, times before opening and times beyond the window", () => {
    expect(slotProblem(londonToUtc(tue, 9 * 60 + 7), 30, NOW)).toBe("off-grid");
    expect(slotProblem(londonToUtc(tue, 8 * 60 + 45), 30, NOW)).toBe("before-open");
    expect(slotProblem(londonToUtc("2026-12-01", 600), 30, NOW)).toBe("too-far");
  });

  it("lists 14 days starting today", () => {
    const days = bookingDays(NOW);
    expect(days).toHaveLength(14);
    expect(days[0]).toBe("2026-11-01");
    expect(days[13]).toBe("2026-11-14");
  });
});

describe("words people read", () => {
  it("formats dates and money", () => {
    expect(shortDate("2026-11-03")).toBe("Tue 3 Nov");
    expect(friendlyDate("2026-11-01", NOW)).toBe("Today");
    expect(friendlyDate("2026-11-02", NOW)).toBe("Tomorrow");
    expect(friendlyDate("2026-11-03", NOW)).toBe("Tue 3 Nov");
    expect(formatPrice(2400)).toBe("£24");
    expect(formatPrice(480)).toBe("£4.80");
  });
});

describe("safety guards", () => {
  it("refuses live and malformed Stripe keys", () => {
    expect(assertTestStripeKey("sk_test_abc123")).toBe("sk_test_abc123");
    expect(assertTestStripeKey("rk_test_abc123")).toBe("rk_test_abc123");
    expect(() => assertTestStripeKey("sk_live_abc123")).toThrow(/not a test key/);
    expect(() => assertTestStripeKey("rk_live_abc123")).toThrow(/not a test key/);
    expect(() => assertTestStripeKey("")).toThrow(/missing/);
    expect(() => assertTestStripeKey(undefined)).toThrow(/missing/);
  });

  it("refuses the live database from local scripts", () => {
    const pw = "postgresql://u:p@";
    const tail = ".eu-west-2.aws.neon.tech/neondb";
    // Made-up endpoint names with their own fingerprints, so the tests never name the real databases.
    const known = { test: fingerprint("ep-made-up-test-abc123"), live: fingerprint("ep-made-up-live-def456") };
    expect(assertTestDatabaseUrl(`${pw}ep-made-up-test-abc123-pooler${tail}`, known)).toContain("ep-made-up-test");
    expect(() => assertTestDatabaseUrl(`${pw}ep-made-up-live-def456${tail}`, known)).toThrow(/live database/);
    expect(() => assertTestDatabaseUrl(`${pw}ep-other-thing-abc${tail}`, known)).toThrow(/not the test/);
  });

  it("keeps only fingerprints of the real database names", () => {
    for (const print of [NEON.test, NEON.live]) expect(print).toMatch(/^[0-9a-f]{64}$/);
    expect(NEON.test).not.toBe(NEON.live);
  });
});
