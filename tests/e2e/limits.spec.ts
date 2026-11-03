// One email address cannot ask for holds without end. Desktop only: each attempt is a full pass through the review step.
import { LIMITS } from "../../src/config/shop.ts";
import { backFromStripe, expect, fillDetailsAndReview, findOpenSlot, pressPay, resetRateLimits, test, uniqueEmail } from "./helpers.ts";

test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "Desktop only"));
test.beforeAll(resetRateLimits);
// Leave nothing behind for the next run, which would otherwise start already counted.
test.afterAll(resetRateLimits);

test("more than the allowed holds from one email get 'Too many attempts' and never reach Stripe", async ({ page, request }) => {
  test.setTimeout(240_000);
  const allowed = LIMITS.holdsPerHourPerEmail;
  const email = uniqueEmail();
  const { date, slot } = await findOpenSlot(request, "marek", "beard", 3);
  const preset = `/book?service=beard&barber=marek&date=${date}&start=${encodeURIComponent(slot.start)}`;
  const alert = page.getByRole("alert").filter({ hasText: /\S/ }).first();

  // Someone else holds the time, on their own tab. A different email, because a person may always retake their own hold.
  const first = await page.context().newPage();
  await first.goto(preset);
  await fillDetailsAndReview(first, "Holder", uniqueEmail());
  await pressPay(first);
  await first.waitForURL(/checkout\.stripe\.com/, { timeout: 45_000 });

  // The screens would now send a preset for a held time back to the picker, so show it as open: this tests the server's limit.
  await page.route("**/api/availability*", (route) => route.fulfill({ json: { slots: [slot] } }));

  // Attempts up to the limit are refused because the time is held, but each still counts.
  for (let attempt = 1; attempt <= allowed; attempt++) {
    await page.goto(preset);
    await fillDetailsAndReview(page, "Limit Tester", email);
    await pressPay(page);
    await expect(alert, `attempt ${attempt}`).toContainText("Someone has just taken that time");
    await expect(page).not.toHaveURL(/checkout\.stripe\.com/);
  }

  // The next one is over the limit.
  await page.goto(preset);
  await fillDetailsAndReview(page, "Limit Tester", email);
  await pressPay(page);
  await expect(alert, `attempt ${allowed + 1}`).toContainText("Too many attempts");
  await expect(page).not.toHaveURL(/checkout\.stripe\.com/);
  await expect(page.getByRole("heading", { name: "Hold your chair" })).toBeVisible();

  // The limit follows the email address: a different address is still welcome (it is told the time is taken, not 'too many').
  await page.goto(preset);
  await fillDetailsAndReview(page, "Someone Else", uniqueEmail());
  await pressPay(page);
  await expect(alert).toContainText("Someone has just taken that time");

  await backFromStripe(first);
});
