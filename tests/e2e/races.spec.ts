// Two people after one chair, held times disappearing for everyone else, and the availability route under bad input.
// Desktop only: the behaviour is the same on every screen size and each hold costs a real Stripe session.
import type { Page } from "@playwright/test";
import { SERVICES, SHOP } from "../../src/config/shop.ts";
import { actAsNewVisitor, newVisitorAddress, backFromStripe, expect, test, fillDetailsAndReview, findOpenSlot, isClosedKey, londonDateKey, payAndReachStripe, resetRateLimits, slotsFor, uniqueEmail } from "./helpers.ts";

test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "Desktop only"));
test.beforeAll(resetRateLimits);

const minutesOf = (label: string) => {
  const [h, m] = label.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

async function atReview(page: Page, presetUrl: string, name: string) {
  await page.goto(presetUrl);
  await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
  await fillDetailsAndReview(page, name, uniqueEmail());
}

const outcomeOf = (page: Page): Promise<"stripe" | "told"> =>
  Promise.race([
    page.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 }).then(() => "stripe" as const),
    page
      .getByRole("alert")
      .filter({ hasText: /\S/ })
      .first()
      .waitFor({ timeout: 45_000 })
      .then(() => "told" as const),
  ]);

test.describe("two people, one chair", () => {
  test.setTimeout(180_000);

  test("when both press Pay together, exactly one reaches Stripe and the other is sent back to pick another time", async ({ browser, request, baseURL }) => {
    const { date, slot } = await findOpenSlot(request, "ailsa", "cut", 3);
    const url = `/book?service=cut&barber=ailsa&date=${date}&start=${encodeURIComponent(slot.start)}`;

    const viewport = { width: 1440, height: 900 };
    const ctxA = await browser.newContext({ baseURL, viewport });
    const ctxB = await browser.newContext({ baseURL, viewport });
    await actAsNewVisitor(ctxA, new URL(baseURL ?? "").origin);
    await actAsNewVisitor(ctxB, new URL(baseURL ?? "").origin);
    try {
      const a = await ctxA.newPage();
      const b = await ctxB.newPage();
      await atReview(a, url, "Racer One");
      await atReview(b, url, "Racer Two");

      const payA = a.getByRole("button", { name: /^Pay £/ });
      const payB = b.getByRole("button", { name: /^Pay £/ });
      const results = Promise.all([outcomeOf(a), outcomeOf(b)]);
      await Promise.all([payA.click(), payB.click()]);
      const [ra, rb] = await results;

      expect([ra, rb].sort(), "exactly one person reaches Stripe").toEqual(["stripe", "told"]);
      const [winner, loser] = ra === "stripe" ? [a, b] : [b, a];

      await expect(loser.getByRole("alert").filter({ hasText: /\S/ }).first()).toContainText("Someone has just taken that time");
      await expect(loser.getByRole("heading", { name: "When suits?" })).toBeVisible();
      expect(loser.url()).not.toContain("checkout.stripe.com");
      expect(loser.url(), "the taken time is dropped from the address").not.toContain("start=");
      await expect(loser.locator(".slot.sel")).toHaveCount(0);

      // The time is held for the winner, so nobody is offered it.
      expect((await slotsFor(request, "ailsa", "cut", date)).some((s) => s.start === slot.start)).toBe(false);

      await backFromStripe(winner);
      expect((await slotsFor(request, "ailsa", "cut", date)).some((s) => s.start === slot.start), "the winner leaving Stripe frees the time").toBe(true);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});

test.describe("a hold takes the time off sale", () => {
  test.setTimeout(120_000);

  test("while someone is paying, other visitors are not offered that time, and it returns when they leave", async ({ page, playwright, request, baseURL }) => {
    const { date, slot } = await findOpenSlot(request, "marek", "fade", 3);
    const stranger = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": newVisitorAddress() } });
    try {
      expect((await slotsFor(stranger, "marek", "fade", date)).map((s) => s.start)).toContain(slot.start);

      await atReview(page, `/book?service=fade&barber=marek&date=${date}&start=${encodeURIComponent(slot.start)}`, "Holder");
      await payAndReachStripe(page);

      expect((await slotsFor(stranger, "marek", "fade", date)).map((s) => s.start)).not.toContain(slot.start);
      // A different service that would overlap the held time is cut off too, while the other barber is untouched.
      const overlapping = await slotsFor(stranger, "marek", "cut", date);
      expect(overlapping.map((s) => s.start)).not.toContain(slot.start);
      expect((await slotsFor(stranger, "ailsa", "fade", date)).length).toBeGreaterThan(0);

      await backFromStripe(page);
      expect((await slotsFor(stranger, "marek", "fade", date)).map((s) => s.start)).toContain(slot.start);
    } finally {
      await stranger.dispose();
    }
  });
});

test.describe("the end of the day", () => {
  test("no time is offered that would run past 18:00, for any service, barber or day", async ({ request }) => {
    let offered = 0;
    for (const service of SERVICES) {
      for (const barber of ["marek", "ailsa"]) {
        for (let i = 0; i <= 13; i++) {
          const date = londonDateKey(i);
          if (isClosedKey(date)) continue;
          for (const s of await slotsFor(request, barber, service.id, date)) {
            offered++;
            const start = minutesOf(s.label);
            expect(start + service.minutes, `${service.name} with ${barber} on ${date} at ${s.label} would finish after 18:00`).toBeLessThanOrEqual(SHOP.closeMinute);
            expect(start, `${s.label} is before opening`).toBeGreaterThanOrEqual(SHOP.openMinute);
          }
        }
      }
    }
    expect(offered).toBeGreaterThan(50);
  });

  test("the longest service (Cut plus beard, 50 minutes) is last offered at 17:10 or earlier", async ({ request }) => {
    let latest = 0;
    for (let i = 0; i <= 13; i++) {
      const date = londonDateKey(i);
      if (isClosedKey(date)) continue;
      for (const s of await slotsFor(request, "ailsa", "both", date)) latest = Math.max(latest, minutesOf(s.label));
    }
    expect(latest).toBeGreaterThan(0);
    expect(latest).toBeLessThanOrEqual(17 * 60 + 10);
  });
});

test.describe("bad input to /api/availability", () => {
  const good = { barber: "marek", service: "cut", date: londonDateKey(3) };
  const cases: [string, Record<string, string>][] = [
    ["an unknown barber", { ...good, barber: "nobody" }],
    ["an unknown service", { ...good, service: "hot-towel-massage" }],
    ["a date that is not a date", { ...good, date: "not-a-date" }],
    ["a date that cannot exist", { ...good, date: "2026-13-45" }],
    ["an empty date", { ...good, date: "" }],
    ["a date with trailing junk", { ...good, date: `${good.date}'; drop table bookings;--` }],
    ["a very long barber", { ...good, barber: "x".repeat(5000) }],
    ["all three wrong", { barber: "!!", service: "??", date: "??" }],
  ];

  for (const [label, params] of cases) {
    test(`${label} gets no times and no server error`, async ({ request }) => {
      const res = await request.get(`/api/availability?${new URLSearchParams(params)}`);
      expect(res.status(), "never a 5xx").toBeLessThan(500);
      const body = (await res.json().catch(() => ({}))) as { slots?: unknown[] };
      expect(body.slots ?? [], "no times are offered for it").toEqual([]);
    });
  }

  test("missing parameters get no times and no server error", async ({ request }) => {
    for (const q of ["", "?barber=marek", "?service=cut", "?date=2030-01-01", "?barber=marek&service=cut"]) {
      const res = await request.get(`/api/availability${q}`);
      expect(res.status(), `query "${q}"`).toBeLessThan(500);
      const body = (await res.json().catch(() => ({}))) as { slots?: unknown[] };
      expect(body.slots ?? []).toEqual([]);
    }
  });

  test("never answers with a 5xx to the wrong method either", async ({ request }) => {
    const res = await request.post("/api/availability", { data: {} });
    expect(res.status()).toBeLessThan(500);
  });
});

test.describe("the past", () => {
  test("days that have gone by offer no times", async ({ request }) => {
    for (const back of [1, 2, 7, 30]) {
      const date = londonDateKey(-back);
      for (const barber of ["marek", "ailsa"]) {
        expect(await slotsFor(request, barber, "cut", date), `${barber} on ${date}`).toEqual([]);
      }
    }
  });

  test("today offers only times at least 15 minutes ahead", async ({ request }) => {
    const before = Date.now();
    const today = londonDateKey(0);
    let seen = 0;
    for (const service of ["beard", "cut", "both"]) {
      for (const barber of ["marek", "ailsa"]) {
        for (const s of await slotsFor(request, barber, service, today)) {
          seen++;
          expect(new Date(s.start).getTime(), `${barber} ${service} at ${s.label} should not be in the past or inside the lead time`).toBeGreaterThanOrEqual(before + SHOP.leadMinutes * 60_000);
        }
      }
    }
    // On a Sunday or Monday there is nothing to see, which is also right.
    if (isClosedKey(today)) expect(seen).toBe(0);
  });

  test("a time already gone cannot be taken by putting it in the address", async ({ page }) => {
    await page.goto(`/book?service=cut&barber=marek&start=${encodeURIComponent(new Date(Date.now() - 3_600_000).toISOString())}`);
    await expect(page.getByRole("heading", { name: "When suits?" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your details" })).toHaveCount(0);
  });
});
