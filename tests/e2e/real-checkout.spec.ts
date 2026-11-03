// The whole journey through Stripe's real hosted page in test mode, using Stripe's published test card. Slower and needs the
// internet, so it only runs when asked: E2E_REAL_STRIPE=1 npx playwright test real-checkout --project=desktop
import { expect, test, type Page } from "@playwright/test";
import Stripe from "stripe";
import { loadEnvLocal } from "../../scripts/env.ts";
import { ACCOUNTS } from "../../src/config/shop.ts";
import { freshEmail, resetRateLimits } from "./helpers.ts";

loadEnvLocal();
test.skip(!process.env.E2E_REAL_STRIPE, "Set E2E_REAL_STRIPE=1 to run against Stripe's test mode");
test.setTimeout(180_000);
test.beforeAll(resetRateLimits);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");

/** Picks the first time on an open day at least `skipDays` chips along, so free-cancel rules apply. */
async function pickTime(page: Page, skipDays = 3) {
  const days = page.locator('[aria-label="Choose a day"] .day:not([disabled])');
  await expect(days.first()).toBeVisible();
  const total = await days.count();
  for (let i = skipDays; i < total; i++) {
    await days.nth(i).click();
    const slots = page.locator(".slot");
    const none = page.getByText(/has nothing left that day/);
    await expect(slots.first().or(none)).toBeVisible();
    if (await slots.count()) {
      await slots.first().click();
      return;
    }
  }
  throw new Error("No open times found");
}

async function bookAndPay(page: Page, name: string): Promise<string> {
  await page.goto("/book");
  await page.locator(".opt").first().click();
  await page.locator(".bar", { hasText: "Marek" }).click();
  await pickTime(page);
  await page.getByLabel("Name").fill(name);
  await page.getByLabel(/^Email/).fill(freshEmail());
  await page.getByRole("button", { name: "Continue to review" }).click();
  await page.getByRole("button", { name: /^Pay £/ }).click();

  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
  // Stripe's own accordion: the real button is invisible and sits over the row, so ordinary clicks do not land on it.
  await page.getByRole("button", { name: "Pay with card", includeHidden: true }).dispatchEvent("click", {}, { timeout: 20_000 });
  await page.locator("#cardNumber").fill("4242424242424242", { timeout: 20_000 });
  await page.locator("#cardExpiry").fill("12 / 34");
  await page.locator("#cardCvc").fill("123");
  await page.locator("#billingName").fill(name);
  const postcode = page.locator("#billingPostalCode");
  if (await postcode.isVisible().catch(() => false)) await postcode.fill("SW1A 1AA");
  await page.locator(".SubmitButton").click();

  await page.waitForURL(/\/booking\/done/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: new RegExp(`You're booked, ${name.split(" ")[0]}`) })).toBeVisible();
  const sessionId = new URL(page.url()).searchParams.get("session_id");
  expect(sessionId).toMatch(/^cs_test_/);
  return sessionId as string;
}

/** Turns "Fri 6 Nov, 13:45" into 2026-11-06 by looking through the booking window. */
function dateKeyOf(when: string): string {
  const wanted = when.split(",")[0];
  for (let i = 0; i < 20; i++) {
    const d = new Date(Date.now() + i * 86_400_000);
    const label = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" }).replace(",", "");
    if (label === wanted) return d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  }
  throw new Error(`Could not read the date in "${when}"`);
}

async function chargeOf(sessionId: string) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent.latest_charge"] });
  expect(session.livemode).toBe(false);
  return (session.payment_intent as Stripe.PaymentIntent).latest_charge as Stripe.Charge;
}

test("pay, reload safely, cancel free of charge, and Stripe really refunds", async ({ page }) => {
  const sessionId = await bookAndPay(page, "Riley Cancel");
  expect((await chargeOf(sessionId)).amount).toBe(480);

  await page.reload();
  await expect(page.getByRole("heading", { name: /You're booked, Riley/ })).toBeVisible();
  // No email is ever sent, so the private link is shown in full to save, and it opens this booking.
  const link = await page.getByLabel("Your private link").inputValue();
  expect(link).toMatch(/^http:\/\/localhost:\d+\/manage\/.+/);
  await expect(page.getByText("This demo sends no emails")).toBeVisible();

  await page.getByRole("link", { name: "Manage your booking" }).click();
  await page.getByRole("button", { name: "Cancel and refund £4.80" }).click();
  await page.getByRole("button", { name: "Yes, cancel it" }).click();
  await expect(page.getByRole("heading", { name: "Booking cancelled" })).toBeVisible();
  await expect(page.getByText(/deposit (has been|is being) refunded/)).toBeVisible();
  await expect.poll(async () => (await chargeOf(sessionId)).refunded, { timeout: 30_000 }).toBe(true);
});

test("pay, move the booking, then the owner refunds it from the diary", async ({ page }) => {
  const sessionId = await bookAndPay(page, "Riley Move");
  await page.getByRole("link", { name: "Manage your booking" }).click();
  const before = await page.locator("dd").nth(2).innerText();

  await page.getByRole("link", { name: "Rebook" }).click();
  await pickTime(page, 4);
  await page.getByRole("button", { name: "Move my booking" }).click();
  await expect(page.getByRole("heading", { name: "Your booking" })).toBeVisible();
  const after = await page.locator("dd").nth(2).innerText();
  expect(after).not.toBe(before);
  expect((await chargeOf(sessionId)).refunded).toBe(false);

  await page.goto("/admin/sign-in");
  await page.getByLabel("Email").fill(ACCOUNTS.owner.email);
  await page.getByLabel("Password").fill(process.env.OWNER_PASSWORD ?? "");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/admin(\?|$)/);
  await page.goto(`/admin?date=${dateKeyOf(after)}`);
  await page.getByRole("link", { name: /Riley Move/ }).first().click();
  await page.getByRole("button", { name: "Refund deposit" }).click();
  await expect.poll(async () => (await chargeOf(sessionId)).refunded, { timeout: 30_000 }).toBe(true);
});
