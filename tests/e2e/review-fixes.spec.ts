// The fresh reviewer's findings, each pinned so it stays fixed. Mostly desktop with set window sizes, because each hold costs a real
// Stripe session and the refund tests use up made-up bookings. The refund journey runs on the phone project, where the bug lived.
import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import pg from "pg";
import { LIMITS } from "../../src/config/shop.ts";
import { withVerifiedTls } from "../../src/db/url.ts";
import { assertTestDatabaseUrl } from "../../src/lib/guards.ts";
import { signBookingLink } from "../../src/lib/manage-link.ts";
import {
  backFromStripe,
  demoSignIn,
  expect,
  fillDetailsAndReview,
  findOpenSlot,
  isClosedKey,
  londonDateKey,
  payAndReachStripe,
  resetRateLimits,
  restoreViewport,
  setTheme,
  test,
  uniqueEmail,
  walkToReview,
} from "./helpers.ts";

const desktopOnly = (info: { project: { name: string } }) => test.skip(info.project.name !== "desktop", "Desktop only");
const phoneOnly = (info: { project: { name: string } }) => test.skip(info.project.name !== "phone", "Phone only");

test.beforeAll(async () => {
  await resetRateLimits();
  execFileSync("node", ["scripts/seed.ts"], { stdio: "ignore", timeout: 120_000 });
});

const NOT_AVAILABLE = "That time is not available. Please pick another.";
const NOT_PAID = "This time is not booked, because the deposit was not paid. Nothing was charged.";

/** A customer's private link, signed the way the app signs it, for the booking a test just started. */
async function manageLinkFor(email: string): Promise<string> {
  const url = assertTestDatabaseUrl(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
  const client = new pg.Client({ connectionString: withVerifiedTls(url) });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>("select id from bookings where customer_email = $1 order by created_at desc limit 1", [email]);
    return `/manage/${encodeURIComponent(signBookingLink(rows[0]!.id))}`;
  } finally {
    await client.end();
  }
}

const bookedEntries = (page: Page) => page.locator("a[id^='bk-']").filter({ hasText: /, Booked$/ }).filter({ hasNotText: "A visitor" });
const panel = (page: Page) => page.getByRole("region", { name: /^Selected:/ });

async function dayWithBookedEntries(page: Page, atLeast = 3): Promise<string> {
  for (let i = 1; i <= 13; i++) {
    const date = londonDateKey(i);
    if (isClosedKey(date)) continue;
    await page.goto(`/admin?date=${date}`);
    if ((await bookedEntries(page).count()) >= atLeast) return date;
  }
  throw new Error("No day with made-up bookings was found");
}

const firstOpenDay = (from = 1) => {
  for (let i = from; i <= 13; i++) if (!isClosedKey(londonDateKey(i))) return londonDateKey(i);
  throw new Error("No open day");
};

test.describe("1. Back from Stripe keeps what was typed", () => {
  test.setTimeout(180_000);
  test.beforeEach(({}, info) => desktopOnly(info));

  test("name and email come back on the details step, and Pay reaches Stripe again", async ({ page }) => {
    const email = uniqueEmail();
    await walkToReview(page, { name: "Backing Out", email });
    await payAndReachStripe(page);

    await page.goBack();
    await restoreViewport(page);
    await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Hold your chair" })).toHaveCount(0);
    await expect(page.getByLabel("Name")).toHaveValue("Backing Out");
    await expect(page.getByLabel(/^Email/)).toHaveValue(email);
    await expect(page.getByText(NOT_AVAILABLE)).toHaveCount(0);

    await page.getByRole("button", { name: "Continue to review" }).click();
    await expect(page.getByRole("heading", { name: "Hold your chair" })).toBeVisible();
    await payAndReachStripe(page);
    await backFromStripe(page);
  });

  test("the flow still works when the browser refuses storage", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "sessionStorage", {
        get() {
          throw new Error("Storage is blocked");
        },
      });
    });
    await walkToReview(page, { name: "No Storage" });
    await expect(page.getByRole("button", { name: /^Pay £/ })).toBeVisible();
  });
});

test.describe("2. The diary's styles stand alone", () => {
  test.beforeEach(({}, info) => desktopOnly(info));

  for (const width of [390, 1440]) {
    test(`hour labels sit on their gridlines and a 13:00 block starts level with 13:00, at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await demoSignIn(page);
      await page.goto(`/admin?date=${firstOpenDay()}`);
      const rows = await page.evaluate(() => {
        const labels = [...document.querySelectorAll<HTMLElement>(".ad-hours span")];
        const lines = [...document.querySelector(".col")!.querySelectorAll<HTMLElement>(".hl")];
        return labels.map((l, i) => ({ label: l.textContent, gap: l.getBoundingClientRect().top - lines[i]!.getBoundingClientRect().top, top: l.getBoundingClientRect().top }));
      });
      expect(rows).toHaveLength(9);
      for (const r of rows) {
        expect(r.gap, r.label ?? "").toBeGreaterThanOrEqual(0);
        expect(r.gap, r.label ?? "").toBeLessThanOrEqual(4);
      }
      const lunch = await page.locator("a[id^='bk-']").filter({ hasText: /^13:00/ }).first().boundingBox();
      expect(Math.abs(lunch!.y - rows.find((r) => r.label === "13:00")!.top)).toBeLessThanOrEqual(4);
    });
  }

  test("no admin element uses a class name the customer stylesheet also styles", async ({ page }) => {
    await demoSignIn(page);
    for (const path of ["/admin", "/admin/week", "/admin/booked", "/admin/block"]) {
      await page.goto(path);
      const clashes = await page.evaluate(() => document.querySelectorAll(".ad .acts,.ad .btn,.ad .btn2,.ad .disp,.ad .empty,.ad .err,.ad .fld,.ad .hours,.ad .nav,.ad .note,.ad .logo").length);
      expect(clashes, path).toBe(0);
    }
  });

  test("the admin menu scrolls away under 800 px instead of piling up", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await demoSignIn(page);
    await page.goto(`/admin?date=${firstOpenDay()}`);
    const links = page.getByRole("navigation", { name: "Diary" }).getByRole("link");
    expect(await links.first().evaluate((el) => getComputedStyle(el).position)).toBe("static");
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(links.first()).not.toBeInViewport();
  });
});

test.describe("3. After an action on /admin the result is in front of the reader", () => {
  test.setTimeout(120_000);
  test.beforeEach(({}, info) => phoneOnly(info));

  async function expectRefundShown(page: Page) {
    const message = page.getByText("Refund sent to the customer.");
    await expect(message).toBeVisible();
    await expect(message).toBeFocused();
    await expect(message).toBeInViewport();
    await expect(page).not.toHaveURL(/done=/);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(message).toHaveCount(0);
  }

  test("a booked customer, by tap", async ({ page }) => {
    await demoSignIn(page);
    await dayWithBookedEntries(page);
    await bookedEntries(page).first().tap();
    await expect(panel(page)).toBeInViewport();
    await panel(page).getByRole("button", { name: "Refund deposit" }).tap();
    await expectRefundShown(page);
  });

  test("a booked customer, by keyboard", async ({ page }) => {
    await demoSignIn(page);
    await dayWithBookedEntries(page);
    await bookedEntries(page).first().focus();
    await page.keyboard.press("Enter");
    await expect(panel(page)).toBeFocused();
    await panel(page).getByRole("button", { name: "Refund deposit" }).focus();
    await page.keyboard.press("Enter");
    await expectRefundShown(page);
  });

  for (const [status, button, words] of [
    ["completed", "Completed", "Marked completed."],
    ["no-show", "No-show", "Marked no-show. The deposit is kept."],
  ] as const) {
    test(`a ${status} customer, by tap, for both the mark and the refund`, async ({ page }) => {
      await demoSignIn(page);
      await dayWithBookedEntries(page);
      await bookedEntries(page).first().tap();
      await panel(page).getByRole("button", { name: button }).tap();
      const marked = page.getByText(words);
      await expect(marked).toBeFocused();
      await expect(marked).toBeInViewport();
      await panel(page).getByRole("button", { name: "Refund deposit" }).tap();
      await expectRefundShown(page);
    });
  }
});

test.describe("4. Diary links say whose column they are in", () => {
  test.beforeEach(({}, info) => desktopOnly(info));

  test("each name includes the barber, the two lunch blocks differ, and headings label their columns", async ({ page }) => {
    await demoSignIn(page);
    await page.goto(`/admin?date=${firstOpenDay()}`);
    for (const barber of ["Marek", "Ailsa"]) {
      await expect(page.getByRole("heading", { level: 2, name: barber, exact: true })).toBeVisible();
      const column = page.getByRole("group", { name: barber, exact: true });
      const links = column.getByRole("link");
      expect(await links.count()).toBeGreaterThan(0);
      for (let i = 0; i < (await links.count()); i++) await expect(links.nth(i)).toHaveAccessibleName(new RegExp(barber));
      await expect(column.getByRole("link", { name: new RegExp(`^13:00\\s*Blocked\\s*until 13:40\\s*,\\s*${barber}$`) })).toHaveCount(1);
    }
  });

  test("the key is under the diary, and a status has a shape as well as a colour", async ({ page }) => {
    await demoSignIn(page);
    await dayWithBookedEntries(page);
    const key = page.getByRole("list", { name: "What the diary shows" });
    for (const word of ["Booked", "Paying now", "Completed", "No-show", "Refunded", "Blocked"]) await expect(key.getByText(word, { exact: true })).toBeVisible();
    await bookedEntries(page).first().click();
    const id = (await panel(page).locator("a.back").getAttribute("href"))?.replace("#", "");
    await page.getByRole("button", { name: "Completed" }).click();
    await expect(page.getByText("Marked completed.")).toBeVisible();
    await expect(page.locator(`#${id} svg.mark`)).toHaveCount(1);
  });
});

test.describe("5. The time picker speaks up and keeps focus", () => {
  test.beforeEach(({}, info) => desktopOnly(info));

  /** Answers the availability check from `mode` until it is set back to "real". */
  function controlTimes(page: Page) {
    const state = { mode: "real" as "real" | "empty" | "broken" };
    return page.route("**/api/availability*", async (route) => {
      if (state.mode === "empty") return route.fulfill({ json: { slots: [] } });
      if (state.mode === "broken") return route.fulfill({ status: 500, body: "{}" });
      return route.fallback();
    }).then(() => state);
  }

  test("one status region is always there and says how many times were found", async ({ page, request }) => {
    const { date } = await findOpenSlot(request, "marek", "cut");
    await page.goto("/book?service=cut&barber=marek");
    const status = page.locator("p.sr[role=status]");
    await expect(status).toHaveCount(1);
    await expect(status).toHaveAttribute("aria-live", "polite");
    const day = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    await page.locator(".day").filter({ hasText: new RegExp(`\\D${day}`) }).click();
    await expect(status).toHaveText(/^\d+ open times? found for /);
    await expect(status).toHaveCount(1);
  });

  test("Try the next open day keeps focus, and says when nothing is found", async ({ page, request }) => {
    const { date } = await findOpenSlot(request, "marek", "cut");
    const times = await controlTimes(page);
    times.mode = "empty";
    await page.goto(`/book?service=cut&barber=marek&date=${date}`);
    await expect(page.locator("p.sr[role=status]")).toHaveText(/^No open times found for /);
    const next = page.getByRole("button", { name: "Try the next open day" });
    await next.click();
    await expect(next).toBeFocused();
    times.mode = "real";
    await next.click();
    await expect(page.locator(".slot").first()).toBeFocused();
  });

  test("Try again keeps focus, and looks like a button in both themes", async ({ page, request }) => {
    const { date } = await findOpenSlot(request, "marek", "cut");
    const times = await controlTimes(page);
    times.mode = "broken";
    await page.goto(`/book?service=cut&barber=marek&date=${date}`);
    const again = page.getByRole("button", { name: "Try again" });
    await expect(again).toBeVisible();
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      const [button, box] = await again.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el.parentElement!).backgroundColor]);
      expect(button, theme).not.toBe(box);
    }
    await again.click();
    await expect(again).toBeFocused();
    times.mode = "real";
    await again.click();
    await expect(page.locator(".slot").first()).toBeFocused();
  });
});

test.describe("6, 8, 9, 10, 12. Layout at the edges", () => {
  test.beforeEach(({}, info) => desktopOnly(info));

  test("the tables say they scroll only when they do", async ({ page }) => {
    await demoSignIn(page);
    for (const path of ["/admin/week", "/admin/booked"]) {
      await page.setViewportSize({ width: 320, height: 700 });
      await page.goto(path);
      await expect(page.getByText("Swipe sideways to see more"), path).toBeVisible();
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.getByText("Swipe sideways to see more"), path).toBeHidden();
    }
  });

  test("the public menu stays on one line with no overflow from 721 to 1024 px", async ({ page }) => {
    for (const width of [721, 760, 799, 800, 860, 899, 900, 960, 1024]) {
      await page.setViewportSize({ width, height: 700 });
      await page.goto("/");
      for (const name of ["Services", "The shop", "Barbers", "Questions", "Book now"]) {
        const box = await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name }).boundingBox();
        expect(box!.height, `${name} at ${width}`).toBeLessThanOrEqual(48);
        expect(box!.x + box!.width, `${name} at ${width}`).toBeLessThanOrEqual(width);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}`).toBeLessThanOrEqual(width);
    }
  });

  test("booking step buttons are at least 44 px wide and on one row at 320 px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/book?service=cut&barber=marek");
    await expect(page.getByRole("heading", { name: "When suits?" })).toBeVisible();
    const boxes = await page.getByRole("navigation", { name: "Booking steps" }).getByRole("button").evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ w: r.width, y: r.y })));
    for (const b of boxes) expect(b.w).toBeGreaterThanOrEqual(44);
    expect(new Set(boxes.map((b) => b.y)).size).toBe(1);
    const back = await page.getByRole("button", { name: "Back", exact: true }).boundingBox();
    expect(back!.width).toBeGreaterThanOrEqual(44);
  });

  for (const width of [390, 1024]) {
    test(`Shift+Tab never leaves focus under the sticky header at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await page.locator(".foot a").last().focus();
      const hidden: string[] = [];
      for (let i = 0; i < 25; i++) {
        await page.keyboard.press("Shift+Tab");
        const stop = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement;
          const header = document.querySelector("header.nav") as HTMLElement;
          if (!el || el === document.body || header.contains(el) || el.classList.contains("skip")) return null;
          return { what: (el.textContent ?? "").trim().slice(0, 30), top: el.getBoundingClientRect().top, under: header.getBoundingClientRect().bottom };
        });
        if (stop && stop.top < stop.under) hidden.push(`${stop.what} at ${stop.top}, header ends ${stop.under}`);
      }
      expect(hidden).toEqual([]);
    });
  }

  test("admin has a skip link, first in the tab order and visible on focus, that lands on the diary", async ({ page }) => {
    await demoSignIn(page);
    await page.goto(`/admin?date=${firstOpenDay()}`);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to the diary" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    const box = await skip.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("region", { name: /^Diary for/ })).toBeFocused();
  });
});

test.describe("13. An impossible time in a typed link", () => {
  test.beforeEach(({}, info) => desktopOnly(info));

  async function expectSentBack(page: Page) {
    await expect(page.getByRole("heading", { name: "When suits?" })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: NOT_AVAILABLE })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Your details" })).toHaveCount(0);
    await expect(page).not.toHaveURL(/start=/);
  }

  test("a time off the grid goes back to the time step, without showing details", async ({ page, request }) => {
    const { date, slot } = await findOpenSlot(request, "marek", "cut");
    const offGrid = new Date(new Date(slot.start).getTime() + 7 * 60_000).toISOString();
    await page.goto(`/book?service=cut&barber=marek&date=${date}&start=${encodeURIComponent(offGrid)}`);
    await expectSentBack(page);
  });

  test("a time on a closed day goes back to the time step", async ({ page }) => {
    let shut = "";
    for (let i = 1; i <= 13 && !shut; i++) if (isClosedKey(londonDateKey(i))) shut = londonDateKey(i);
    await page.goto(`/book?service=cut&barber=marek&start=${encodeURIComponent(`${shut}T11:00:00.000Z`)}`);
    await expectSentBack(page);
  });

  test("a good time still lands on the details step", async ({ page, request }) => {
    const { date, slot } = await findOpenSlot(request, "marek", "cut");
    await page.goto(`/book?service=cut&barber=marek&date=${date}&start=${encodeURIComponent(slot.start)}`);
    await expect(page.getByLabel("Name")).toBeVisible();
    await expect(page.getByText(NOT_AVAILABLE)).toHaveCount(0);
  });
});

test.describe("14, 15, 18, 20. Admin addresses and titles", () => {
  test.beforeEach(({}, info) => desktopOnly(info));

  test("impossible dates fall back to the default day with no crash", async ({ page }) => {
    await demoSignIn(page);
    await page.goto("/admin");
    const heading = await page.getByRole("heading", { level: 1 }).innerText();
    for (const bad of ["9999-12-31", "2026-02-30"]) {
      const res = await page.goto(`/admin?date=${bad}`);
      expect(res?.status(), bad).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      await expect(page.getByText("Something went wrong")).toHaveCount(0);
    }
  });

  test("a typed done=refund says nothing and leaves the address", async ({ page }) => {
    await demoSignIn(page);
    const words = page.getByText("Refund sent to the customer.");
    await page.goto("/admin?done=refund");
    await expect(page).not.toHaveURL(/done=/);
    await expect(words).toHaveCount(0);

    const date = await dayWithBookedEntries(page);
    const id = (await bookedEntries(page).first().getAttribute("id"))!.replace("bk-", "");
    await page.goto(`/admin?date=${date}&b=${id}&done=refund`);
    await expect(page).not.toHaveURL(/done=/);
    await expect(page).toHaveURL(new RegExp(`b=${id}`));
    await expect(words).toHaveCount(0);
    await expect(panel(page)).toBeVisible();
  });

  test("every admin page's title has the same shape", async ({ page }) => {
    await page.goto("/admin/sign-in");
    await expect(page).toHaveTitle("Sign in | The shop's diary | Demo Barbers");
    await demoSignIn(page);
    for (const [path, title] of [
      ["/admin", "Day"],
      ["/admin/week", "Week"],
      ["/admin/booked", "What's booked"],
      ["/admin/block", "Block time"],
    ] as const) {
      await page.goto(path);
      await expect(page, path).toHaveTitle(`${title} | The shop's diary | Demo Barbers`);
    }
  });

  test("the Today button tells the truth when today is shut", async ({ page }) => {
    await demoSignIn(page);
    await page.goto("/admin");
    await page.getByRole("link", { name: "Today" }).click();
    await expect(page).toHaveURL(new RegExp(`date=${londonDateKey(0)}`));
    if (isClosedKey(londonDateKey(0))) {
      await expect(page.getByText("Closed today")).toBeVisible();
      await page.getByRole("link", { name: /^Next open day/ }).click();
      await expect(page.getByRole("region", { name: /^Diary for/ })).toBeVisible();
    } else {
      await expect(page.getByRole("region", { name: /^Diary for/ })).toBeVisible();
    }
  });
});

test.describe("16. Hold wording on the private link", () => {
  test.setTimeout(120_000);
  test.beforeEach(({}, info) => desktopOnly(info));

  test("one honest message while paying and after backing out", async ({ page, browser, request, baseURL }) => {
    const { date, slot } = await findOpenSlot(request, "ailsa", "beard", 3);
    const email = uniqueEmail();
    await page.goto(`/book?service=beard&barber=ailsa&date=${date}&start=${encodeURIComponent(slot.start)}`);
    await fillDetailsAndReview(page, "Hold Words", email);
    await payAndReachStripe(page);
    const link = await manageLinkFor(email);

    const other = await browser.newContext({ baseURL });
    try {
      const reader = await other.newPage();
      await reader.goto(link);
      await expect(reader.getByText(NOT_PAID)).toBeVisible();
      await expect(reader.getByText("Payment not finished")).toHaveCount(0);

      await backFromStripe(page);
      await reader.goto(link);
      await expect(reader.getByText(NOT_PAID)).toBeVisible();
      await expect(reader.getByText("ran out")).toHaveCount(0);
    } finally {
      await other.close();
    }
  });
});

test.describe("17. Sign-in refusals", () => {
  test.beforeEach(({}, info) => desktopOnly(info));

  test("a refused sign-in keeps the email, and 'too many' is said once", async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto("/admin/sign-in");
    const email = page.getByLabel("Email");
    const owner = page.getByRole("button", { name: "Sign in", exact: true });
    const tooMany = page.getByRole("alert").filter({ hasText: "Too many attempts from this connection" });

    await email.fill(uniqueEmail());
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await owner.click();
    await expect(page.getByRole("alert").filter({ hasText: "do not match" })).toBeVisible();
    await expect(email).not.toHaveValue("");

    for (let i = 0; i < LIMITS.signInsPerHourPerConnection; i++) {
      await email.fill(uniqueEmail());
      await page.getByLabel("Password").fill("definitely-not-the-password");
      await owner.click();
      await expect(owner).toBeEnabled();
      if (await tooMany.count()) break;
    }
    await expect(tooMany).toHaveCount(1);

    // The demo button has its own count. Use it up, then refuse both forms on the same page, so both hold the same words.
    const signedIn = page.getByRole("heading", { level: 1 }).filter({ hasNotText: "The shop's diary" });
    for (let i = 0; i <= LIMITS.signInsPerHourPerConnection; i++) {
      await page.context().clearCookies();
      await page.goto("/admin/sign-in");
      await page.getByRole("button", { name: "Try the admin" }).click();
      await expect(signedIn.or(tooMany).first()).toBeVisible({ timeout: 30_000 });
      if (await tooMany.count()) break;
    }
    await expect(tooMany).toHaveCount(1);
    await expect(page.locator(".owner").getByRole("alert")).toHaveCount(0);

    await email.fill(uniqueEmail());
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await owner.click();
    await expect(page.locator(".owner").getByRole("alert").filter({ hasText: "Too many attempts from this connection" })).toBeVisible();
    await expect(tooMany).toHaveCount(1);
  });
});

test.describe("A made-up Stripe link", () => {
  test.beforeEach(({}, info) => desktopOnly(info));

  test("says the link is not valid", async ({ page }) => {
    await page.goto("/booking/done?session_id=cs_test_madeup");
    await expect(page.getByRole("heading", { name: "This link is not valid" })).toBeVisible();
  });

  test("cannot be used over and over to wear out the payment account", async ({ page, request }) => {
    // Each visit asks Stripe, so one connection gets a fixed number of checks an hour. Uses this test's own visitor address.
    for (let i = 0; i < LIMITS.returnChecksPerHourPerConnection; i++) {
      // Real-looking ids only: anything shorter is refused before Stripe is asked, so it costs nothing.
      const r = await request.get(`/booking/done?session_id=cs_test_madeuplink${i}`);
      expect(await r.text()).not.toContain("Too many checks");
    }
    await page.goto("/booking/done?session_id=cs_test_madeuplink_last");
    await expect(page.getByRole("heading", { name: "Too many checks" })).toBeVisible();
  });
});
