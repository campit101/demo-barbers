// The shop's diary, signed in with the public demo login. Desktop only and one test at a time: they share seeded bookings.
import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { ACCOUNTS, LIMITS } from "../../src/config/shop.ts";
import {
  actAsNewVisitor,
  backFromStripe,
  demoSignIn,
  expect,
  fillDetailsAndReview,
  findOpenSlot,
  londonDateKey,
  isClosedKey,
  payAndReachStripe,
  resetRateLimits,
  slotsFor,
  test,
  uniqueEmail,
} from "./helpers.ts";

test.describe.configure({ mode: "serial" });
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "Desktop only"));
test.beforeAll(() => {
  resetRateLimits();
  // Rebuilds the made-up diary only if it is missing or more than 24 hours old; otherwise it changes nothing.
  execFileSync("node", ["scripts/seed.ts"], { stdio: "ignore", timeout: 120_000 });
});

const pence = (text: string) => Math.round(Number(text.replace(/[^0-9.]/g, "")) * 100);

/** The three numbers above the diary. */
async function counts(page: Page) {
  const read = async (label: string) => (await page.locator(".count > div", { hasText: label }).locator("b").innerText()).trim();
  return {
    bookings: Number(await read("booking")),
    held: pence(await read("deposits held")),
    toPay: pence(await read("still to pay")),
  };
}

/** The first open day, from tomorrow, that has bookings which are still just "Booked". */
async function dayWithBookedEntries(page: Page): Promise<string> {
  for (let i = 1; i <= 13; i++) {
    const date = londonDateKey(i);
    if (isClosedKey(date)) continue;
    await page.goto(`/admin?date=${date}`);
    if ((await bookedEntries(page).count()) >= 4) return date;
  }
  throw new Error("No day with made-up bookings was found");
}

/** Diary entries for seeded customers that are plain "Booked" (not blocks, visitors, or ones already changed). */
const bookedEntries = (page: Page) => page.locator("a[id^='bk-']").filter({ hasText: /, Booked$/ }).filter({ hasNotText: "A visitor" });

/** Opens the Nth still-booked entry and returns its id. */
async function openBooked(page: Page, nth: number): Promise<string> {
  const entry = bookedEntries(page).nth(nth);
  const id = (await entry.getAttribute("id"))!.replace("bk-", "");
  await entry.click();
  await expect(page).toHaveURL(new RegExp(`b=${id}`));
  await expect(page.getByRole("region", { name: /^Selected:/ })).toBeVisible();
  return id;
}

const panel = (page: Page) => page.getByRole("region", { name: /^Selected:/ });

test("an unsigned visitor is sent to the sign-in page from every admin page", async ({ page }) => {
  for (const path of ["/admin", "/admin/week", "/admin/booked", "/admin/block", "/admin?date=2030-01-01"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/admin\/sign-in/);
    await expect(page.getByRole("button", { name: "Try the admin" })).toBeVisible();
  }
});

test("a wrong owner password is refused with a message and stays on the sign-in page", async ({ page }) => {
  await page.goto("/admin/sign-in");
  await page.getByLabel("Email").fill("someone@example.com");
  await page.getByLabel("Password").fill("definitely-not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/sign-in/);
});

test("Try the admin opens the diary with made-up bookings and a demo notice", async ({ page }) => {
  await demoSignIn(page);
  await expect(page).toHaveURL(/\/admin(\?|$)/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/\d{1,2} \w+/);
  await expect(page.getByText("Demo data. Resets every 24 hours.")).toBeVisible();
  await expect(page.getByRole("region", { name: /^Diary for/ })).toBeVisible();
  for (const name of ["Day", "Week", "What's booked", "Block time"]) await expect(page.getByRole("navigation", { name: "Diary" }).getByRole("link", { name })).toBeVisible();
  const date = await dayWithBookedEntries(page);
  const c = await counts(page);
  expect(c.bookings).toBeGreaterThan(0);
  expect(await bookedEntries(page).count(), `made-up bookings on ${date}`).toBeGreaterThan(0);
});

test("a visitor's booking shows as 'A visitor', with no name or email, and cannot be changed", async ({ page, browser, request, baseURL }) => {
  test.setTimeout(150_000);
  const { date, slot } = await findOpenSlot(request, "ailsa", "cut", 4);
  const name = "Hidden Harriet";
  const email = uniqueEmail();

  // A real visitor, in their own browser, holds a time and is on Stripe's page.
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  await actAsNewVisitor(ctx, new URL(baseURL ?? "").origin);
  const visitor = await ctx.newPage();
  try {
    await visitor.goto(`/book?service=cut&barber=ailsa&date=${date}&start=${encodeURIComponent(slot.start)}`);
    await fillDetailsAndReview(visitor, name, email);
    await payAndReachStripe(visitor);

    await demoSignIn(page);
    await page.goto(`/admin?date=${date}`);
    const entry = page.locator("a[id^='bk-']").filter({ hasText: "A visitor" }).filter({ hasText: slot.label });
    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText("Haircut");

    const html = await page.content();
    expect(html).not.toContain(email);
    expect(html).not.toContain(name);
    expect(html.toLowerCase()).not.toContain(email.split("@")[0]!.toLowerCase());

    await entry.click();
    await expect(panel(page).getByRole("heading", { name: "A visitor" })).toBeVisible();
    await expect(panel(page)).toContainText("Belongs to a visitor");
    await expect(page.getByRole("button", { name: "Completed" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "No-show" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Refund deposit" })).toBeDisabled();
    expect(await page.content()).not.toContain(email);

    // A time still being paid for is not "booked" yet, so the list may not show it, but it must never show the details.
    await page.goto("/admin/booked");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("What's booked");
    const booked = await page.content();
    expect(booked).not.toContain(email);
    expect(booked).not.toContain(name);

    await backFromStripe(visitor);
  } finally {
    await ctx.close();
  }
  expect((await slotsFor(request, "ailsa", "cut", date)).some((s) => s.start === slot.start)).toBe(true);
});

test.describe("marking and refunding made-up bookings", () => {
  test("Completed takes the customer off 'still to pay' and leaves the deposit held", async ({ page }) => {
    await demoSignIn(page);
    const date = await dayWithBookedEntries(page);
    const before = await counts(page);
    await openBooked(page, 0);
    await expect(panel(page).getByText("Booked", { exact: true })).toBeVisible();
    const price = pence(await panel(page).locator("dd").nth(3).innerText());
    const deposit = pence(await panel(page).locator("dd").nth(4).innerText());

    await page.getByRole("button", { name: "Completed" }).click();
    await expect(panel(page).getByText("Completed", { exact: true })).toBeVisible();
    await page.goto(`/admin?date=${date}`);
    const after = await counts(page);
    expect(after.bookings).toBe(before.bookings);
    expect(after.toPay).toBe(before.toPay - (price - deposit));
    expect(after.held).toBe(before.held);
  });

  test("No-show takes the customer off 'still to pay' and keeps the deposit", async ({ page }) => {
    await demoSignIn(page);
    const date = await dayWithBookedEntries(page);
    const before = await counts(page);
    await openBooked(page, 0);
    const price = pence(await panel(page).locator("dd").nth(3).innerText());
    const deposit = pence(await panel(page).locator("dd").nth(4).innerText());

    await page.getByRole("button", { name: "No-show" }).click();
    await expect(panel(page).getByText("No-show, deposit kept")).toBeVisible();
    await page.goto(`/admin?date=${date}`);
    const after = await counts(page);
    expect(after.bookings).toBe(before.bookings);
    expect(after.toPay).toBe(before.toPay - (price - deposit));
    expect(after.held).toBe(before.held);
  });

  test("Refund deposit sends the money back and lowers 'deposits held'", async ({ page }) => {
    await demoSignIn(page);
    const date = await dayWithBookedEntries(page);
    const before = await counts(page);
    const id = await openBooked(page, 0);
    const price = pence(await panel(page).locator("dd").nth(3).innerText());
    const deposit = pence(await panel(page).locator("dd").nth(4).innerText());

    await page.getByRole("button", { name: "Refund deposit" }).click();
    await expect(page.getByText("Refund sent to the customer.")).toBeVisible();
    // Refunding a booked customer frees their time, so they leave the diary and every number drops with them.
    await expect(page.locator(`#bk-${id}`)).toHaveCount(0);
    await page.goto(`/admin?date=${date}`);
    const after = await counts(page);
    expect(after.bookings).toBe(before.bookings - 1);
    expect(after.held).toBe(before.held - deposit);
    expect(after.toPay).toBe(before.toPay - (price - deposit));
  });

  test("a made-up booking that has been dealt with cannot be marked again", async ({ page }) => {
    await demoSignIn(page);
    const date = await dayWithBookedEntries(page);
    const id = await openBooked(page, 0);
    await page.getByRole("button", { name: "Completed" }).click();
    await expect(panel(page).getByText("Completed", { exact: true })).toBeVisible();
    await page.goto(`/admin?date=${date}&b=${id}`);
    await expect(page.getByRole("button", { name: "Completed" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "No-show" })).toBeDisabled();
  });
});

test.describe("blocking time off", () => {
  test("a block can be added, is refused when it overlaps, takes the time off sale, and can be removed", async ({ page, request }) => {
    const { date, slot } = await findOpenSlot(request, "ailsa", "cut", 5);
    const [h, m] = slot.label.split(":").map(Number) as [number, number];
    const end = h * 60 + m + 30;
    const to = `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
    const blockedEntry = () => page.locator("a[id^='bk-']").filter({ hasText: new RegExp(String.raw`${slot.label}\s*Blocked\s*until ${to}`) });

    await demoSignIn(page);
    const fillBlock = async () => {
      await page.goto(`/admin/block?date=${date}`);
      await page.locator("select[name=barberId]").selectOption("ailsa");
      await page.locator("input[name=date]").fill(date);
      await page.locator("input[name=from]").fill(slot.label);
      await page.locator("input[name=to]").fill(to);
    };

    await fillBlock();
    await page.getByRole("button", { name: "Block this time" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin\\?date=${date}`));
    await expect(blockedEntry()).toHaveCount(1);
    expect((await slotsFor(request, "ailsa", "cut", date)).some((s) => s.start === slot.start), "a blocked time is not offered").toBe(false);

    // The same time again overlaps the block.
    await fillBlock();
    await page.getByRole("button", { name: "Block this time" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toContainText("That overlaps a booking or another block");
    await expect(page).toHaveURL(/\/admin\/block/);
    // What was typed is kept, so the owner can change just one thing.
    await expect(page.locator("input[name=from]")).toHaveValue(slot.label);

    await page.goto(`/admin?date=${date}`);
    await expect(blockedEntry()).toHaveCount(1);
    await blockedEntry().click();
    await expect(panel(page).getByRole("heading", { name: "Blocked" })).toBeVisible();
    await page.getByRole("button", { name: "Remove block" }).click();
    await expect(page.getByText("Block removed.")).toBeVisible();
    await expect(blockedEntry()).toHaveCount(0);
    expect((await slotsFor(request, "ailsa", "cut", date)).some((s) => s.start === slot.start), "the time is offered again").toBe(true);
  });

  test("a block that ends before it starts, or sits on a closed day, is refused", async ({ page }) => {
    await demoSignIn(page);
    await page.goto("/admin/block");
    await page.locator("input[name=from]").fill("15:00");
    await page.locator("input[name=to]").fill("14:00");
    await page.getByRole("button", { name: "Block this time" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toContainText("Choose a start before the end");

    let shut = "";
    for (let i = 1; i <= 13 && !shut; i++) if (isClosedKey(londonDateKey(i))) shut = londonDateKey(i);
    await page.locator("input[name=date]").fill(shut);
    await page.locator("input[name=from]").fill("14:00");
    await page.locator("input[name=to]").fill("15:00");
    await page.getByRole("button", { name: "Block this time" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toContainText("The shop is closed that day");
  });
});

test.describe("the other diary pages", () => {
  test("the week page shows both barbers for seven days and each day opens the day page", async ({ page }) => {
    await demoSignIn(page);
    await page.getByRole("navigation", { name: "Diary" }).getByRole("link", { name: "Week" }).click();
    await expect(page).toHaveURL(/\/admin\/week/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This week");
    await expect(page.getByRole("columnheader")).toHaveCount(8);
    await expect(page.getByRole("row").filter({ hasText: "Marek" })).toHaveCount(1);
    await expect(page.getByRole("row").filter({ hasText: "Ailsa" })).toHaveCount(1);
    await page.getByRole("link", { name: "Next week" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/^From /);
    const day = page.getByRole("link", { name: /^Marek, .*: \d+ booked$/ }).first();
    await day.click();
    await expect(page).toHaveURL(/\/admin\?date=\d{4}-\d{2}-\d{2}/);
    await expect(page.getByRole("region", { name: /^Diary for/ })).toBeVisible();
  });

  test("What's booked lists the made-up bookings with their status", async ({ page }) => {
    await demoSignIn(page);
    await page.getByRole("link", { name: "What's booked" }).click();
    await expect(page).toHaveURL(/\/admin\/booked/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("What's booked");
    await expect(page.getByRole("columnheader")).toHaveText(["Day", "Time", "Customer", "Service", "Barber", "Deposit", "Status"]);
    expect(await page.getByRole("row").count()).toBeGreaterThan(5);
    await expect(page.getByRole("region", { name: "All bookings" })).toBeVisible();
  });

  test("Block time shows its form with both barbers and a Back link", async ({ page }) => {
    await demoSignIn(page);
    await page.getByRole("link", { name: "Block time", exact: true }).first().click();
    await expect(page).toHaveURL(/\/admin\/block/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Block time off");
    await expect(page.locator("select[name=barberId]").locator("option")).toHaveText(["Marek", "Ailsa"]);
    await expect(page.locator("input[name=date]")).toBeVisible();
    await expect(page.locator("input[name=from]")).toBeVisible();
    await expect(page.locator("input[name=to]")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to the day" })).toBeVisible();
  });

  test("the day page on a closed day says the shop is shut", async ({ page }) => {
    let shut = "";
    for (let i = 1; i <= 13 && !shut; i++) if (isClosedKey(londonDateKey(i))) shut = londonDateKey(i);
    await demoSignIn(page);
    await page.goto(`/admin?date=${shut}`);
    await expect(page.getByText("The shop is closed on Sunday and Monday")).toBeVisible();
  });
});

test("Sign out ends the session, and /admin then goes back to the sign-in page", async ({ page }) => {
  await demoSignIn(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/admin\/sign-in/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/sign-in/);
  await page.goto("/admin/week");
  await expect(page).toHaveURL(/\/admin\/sign-in/);
});

test("wrong passwords from one connection cannot lock the owner out from everywhere", async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  const tryOnce = async (p: Page) => {
    await p.goto("/admin/sign-in");
    const form = p.locator("form.owner");
    await form.getByLabel("Email").fill(ACCOUNTS.owner.email);
    await form.getByLabel("Password").fill("not-the-password");
    await form.getByRole("button", { name: "Sign in" }).click();
    return form;
  };
  for (let i = 0; i < LIMITS.signInsPerHourPerEmail; i++) await expect(await tryOnce(page)).toContainText("do not match");
  await expect(await tryOnce(page)).toContainText("Too many attempts for this account");

  // The real owner, on another connection, still gets an honest answer.
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  await actAsNewVisitor(ctx, new URL(baseURL ?? "").origin);
  try {
    await expect(await tryOnce(await ctx.newPage())).toContainText("do not match");
  } finally {
    await ctx.close();
  }
});