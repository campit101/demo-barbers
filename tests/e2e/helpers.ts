// Browser-test setup. The guard makes it impossible for these to touch the live database.
import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";
import { loadEnvLocal } from "../../scripts/env.ts";
import { withVerifiedTls } from "../../src/db/url.ts";
import { assertTestDatabaseUrl } from "../../src/lib/guards.ts";

loadEnvLocal();

async function onTestDb(sql: string): Promise<void> {
  const url = assertTestDatabaseUrl(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL);
  const client = new pg.Client({ connectionString: withVerifiedTls(url) });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

/** Repeated runs would otherwise hit the same limits a real visitor does. */
export const resetRateLimits = () => onTestDb("delete from rate_limits");

/** A different address each run, so limits per email never carry over. */
export const freshEmail = () => `e2e-${Date.now()}@example.com`;

// ---------------------------------------------------------------------------------------------------------------------
// Shared browser helpers for the specs in this folder.
// ---------------------------------------------------------------------------------------------------------------------

export const BANNER = "Demo. Nothing is sold, test payments only";

/**
 * The app counts holds, searches and sign-ins per visitor address, and keeps part of that count in the server's memory,
 * which clearing the database cannot reach. Every test is therefore its own visitor, using the forwarded-address header
 * the app reads on Vercel. Only requests to this site carry it, so Stripe never sees a header it did not expect.
 */
let visitorCounter = 0;
export const newVisitorAddress = () => `10.${Math.floor(Math.random() * 256)}.${(++visitorCounter + Math.floor(Math.random() * 100)) % 256}.${1 + Math.floor(Math.random() * 253)}`;

export async function actAsNewVisitor(context: BrowserContext, siteOrigin: string, address = newVisitorAddress()): Promise<string> {
  await context.route(
    (url) => url.origin === siteOrigin,
    (route) => route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": address } }),
  );
  return address;
}

export const test = base.extend<{ visitorAddress: string }>({
  visitorAddress: async ({}, give) => give(newVisitorAddress()),
  context: async ({ context, baseURL, visitorAddress }, give) => {
    await actAsNewVisitor(context, new URL(baseURL ?? "http://localhost").origin, visitorAddress);
    await give(context);
  },
  request: async ({ playwright, baseURL, visitorAddress }, give) => {
    const api = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": visitorAddress } });
    await give(api);
    await api.dispose();
  },
});

export { expect };

let emailCounter = 0;
/** Like freshEmail, but safe to call many times in the same millisecond. */
export const uniqueEmail = () => `e2e-${Date.now()}-${++emailCounter}@example.com`;

/** London calendar date for "today plus n days", as YYYY-MM-DD. */
export function londonDateKey(plusDays = 0): string {
  const d = new Date(Date.now() + plusDays * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

/** Sunday (0) and Monday (1) are closed, taken from the London calendar date itself. */
export function isClosedKey(key: string): boolean {
  const day = new Date(`${key}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 1;
}

export interface ApiSlot {
  start: string;
  label: string;
}

export async function slotsFor(request: APIRequestContext, barber: string, service: string, date: string): Promise<ApiSlot[]> {
  const res = await request.get(`/api/availability?${new URLSearchParams({ barber, service, date })}`);
  expect(res.status(), `availability for ${barber}/${service}/${date}`).toBe(200);
  return ((await res.json()) as { slots: ApiSlot[] }).slots;
}

/** The first offered time on an open day at least `skipDays` days away (so it is also outside the 24 hour rule). */
export async function findOpenSlot(request: APIRequestContext, barber: string, service: string, skipDays = 2): Promise<{ date: string; slot: ApiSlot }> {
  for (let i = skipDays; i <= 13; i++) {
    const date = londonDateKey(i);
    if (isClosedKey(date)) continue;
    const slots = await slotsFor(request, barber, service, date);
    if (slots[0]) return { date, slot: slots[0] };
  }
  throw new Error("No open times found in the booking window");
}

/** Clicks the first open day that has at least one time, then returns that time's button. Does not click the time. */
export async function openFirstDayWithTimes(page: Page, skipDays = 0) {
  const days = page.locator('[aria-label="Choose a day"] .day:not([disabled])');
  await expect(days.first()).toBeVisible();
  const total = await days.count();
  for (let i = skipDays; i < total; i++) {
    await days.nth(i).click();
    const slots = page.locator(".slot");
    const none = page.getByText(/has nothing left that day/);
    await expect(slots.first().or(none)).toBeVisible();
    if (await slots.count()) return slots.first();
  }
  throw new Error("No open times found");
}

export async function chooseService(page: Page, name: string) {
  await page.locator(".opt", { hasText: name }).click();
}

export async function chooseBarber(page: Page, name = "Marek") {
  await page.locator(".bar", { hasText: name }).click();
}

export interface Walk {
  service: string;
  barber: string;
  name: string;
  email: string;
}

export async function fillDetailsAndReview(page: Page, name: string, email: string) {
  await page.getByLabel("Name").fill(name);
  await page.getByLabel(/^Email/).fill(email);
  await page.getByRole("button", { name: "Continue to review" }).click();
  await expect(page.getByRole("heading", { name: "Hold your chair" })).toBeVisible();
}

/** Walks /book from the first step to the review step, choosing a time from what the page offers. */
export async function walkToReview(page: Page, opts: Partial<Walk> & { skipDays?: number } = {}): Promise<Walk & { when: string }> {
  const walk = { service: "Haircut", barber: "Marek", name: "Test Visitor", email: uniqueEmail(), ...opts };
  await page.goto("/book");
  await chooseService(page, walk.service);
  await chooseBarber(page, walk.barber);
  const slot = await openFirstDayWithTimes(page, opts.skipDays ?? 2);
  await slot.click();
  await fillDetailsAndReview(page, walk.name, walk.email);
  const when = await page.locator("dd").nth(2).innerText();
  return { ...walk, when };
}

export async function pressPay(page: Page) {
  await page.getByRole("button", { name: /^Pay £/ }).click();
}

/** Presses Pay and waits for Stripe's page. Never types card details. */
export async function payAndReachStripe(page: Page) {
  await pressPay(page);
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 });
}

/** Follows Stripe's own link back to the shop, which is what releases the held time. */
export async function backFromStripe(page: Page) {
  const link = page.locator('[data-testid="business-link"]').or(page.getByRole("link", { name: /^back$/i }));
  await link.first().click({ timeout: 30_000 });
  await page.waitForURL(/\/booking\/cancelled/, { timeout: 30_000 });
  await restoreViewport(page);
}

/**
 * Coming back from another site (Stripe) can leave Chromium reporting a 0 x 0 window, so everything counts as hidden.
 * That is a browser-automation quirk, not the app: setting the size again fixes it.
 */
export async function restoreViewport(page: Page) {
  const size = page.viewportSize();
  if (!size) return;
  const inner = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  if (inner.w === size.width && inner.h === size.height) return;
  await page.setViewportSize({ width: size.width + 1, height: size.height });
  await page.setViewportSize(size);
}

/** The theme switch on the customer site. */
export const siteThemeSwitch = (page: Page) => page.getByRole("button", { name: /^Colour theme:/ });

export const themeOf = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);

export async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
}

/** Runs axe over the page as it now is and returns a readable list of violations. */
export async function axeViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(" ")}`);
}

export async function demoSignIn(page: Page) {
  await page.goto("/admin/sign-in");
  await page.getByRole("button", { name: "Try the admin" }).click();
  await page.waitForURL(/\/admin(\?|$)/);
}

/** Collects console errors and uncaught page errors so a spec can assert there are none. */
export function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}
