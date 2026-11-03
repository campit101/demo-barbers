// The booking journey up to Stripe's page. Card details are never typed: each test stops on arrival at checkout.stripe.com
// and follows Stripe's own Back link, which releases the held time for the next test.
import { SERVICES, depositFor } from "../../src/config/shop.ts";
import {
  backFromStripe,
  expect,
  test,
  chooseBarber,
  chooseService,
  fillDetailsAndReview,
  findOpenSlot,
  isClosedKey,
  londonDateKey,
  openFirstDayWithTimes,
  payAndReachStripe,
  resetRateLimits,
  slotsFor,
  uniqueEmail,
  walkToReview,
} from "./helpers.ts";

test.beforeAll(resetRateLimits);

const money = (pence: number) => `£${(pence / 100).toFixed(2)}`;

test.describe("the amount shown", () => {
  test.setTimeout(120_000);
  for (const service of SERVICES) {
    test(`${service.name} asks for 20% of ${money(service.pricePence)}, on the review step, the button and Stripe`, async ({ page }) => {
      const deposit = money(depositFor(service.pricePence));
      expect(depositFor(service.pricePence)).toBe(service.pricePence * 0.2);

      await walkToReview(page, { service: service.name });
      await expect(page.locator("dd.big")).toHaveText(deposit);
      await expect(page.locator("dd", { hasText: new RegExp(`^${money(service.pricePence).replace(".", "\\.")}$`) })).toBeVisible();
      await expect(page.locator("dd", { hasText: new RegExp(`^${money(service.pricePence - depositFor(service.pricePence)).replace(".", "\\.")}$`) })).toBeVisible();
      await expect(page.getByRole("button", { name: `Pay ${deposit} deposit` })).toBeVisible();

      await payAndReachStripe(page);
      await expect(page.locator("body")).toContainText(deposit, { timeout: 30_000 });
      await backFromStripe(page);
    });
  }
});

test.describe("choosing a day and a time", () => {
  test("Sunday and Monday are shut and cannot be chosen, and every other day can", async ({ page }) => {
    await page.goto("/book?service=cut&barber=marek");
    const days = page.locator('[aria-label="Choose a day"] .day');
    await expect(days.first()).toBeVisible();
    const total = await days.count();
    expect(total).toBeGreaterThanOrEqual(14);

    let closedSeen = 0;
    for (let i = 0; i < total; i++) {
      const shut = isClosedKey(londonDateKey(i));
      const day = days.nth(i);
      if (shut) {
        closedSeen++;
        await expect(day, `day ${i} (${londonDateKey(i)}) is a Sunday or Monday`).toBeDisabled();
        await expect(day).toContainText("Closed");
      } else {
        await expect(day, `day ${i} (${londonDateKey(i)}) is open`).toBeEnabled();
        await expect(day).not.toContainText("Closed");
      }
    }
    expect(closedSeen).toBeGreaterThanOrEqual(4);
  });

  test("a shut day in the address is not accepted as a preset", async ({ page }) => {
    let shut = "";
    for (let i = 1; i <= 13 && !shut; i++) if (isClosedKey(londonDateKey(i))) shut = londonDateKey(i);
    await page.goto(`/book?service=cut&barber=marek&date=${shut}`);
    await expect(page.getByRole("heading", { name: "When suits?" })).toBeVisible();
    await expect(page.locator(".day.sel")).toHaveCount(0);
    await expect(page.locator(".slot")).toHaveCount(0);
  });
});

test.describe("nothing is chosen for the visitor", () => {
  test("every step starts empty when there is no preset", async ({ page }) => {
    await page.goto("/book");
    await expect(page.getByRole("heading", { name: "What are you having?" })).toBeVisible();
    await expect(page.locator(".opt.sel")).toHaveCount(0);
    await expect(page.locator('.opt[aria-pressed="true"]')).toHaveCount(0);

    await chooseService(page, "Skin fade");
    await expect(page.getByRole("heading", { name: "Who's cutting?" })).toBeVisible();
    await expect(page.locator(".bar.sel")).toHaveCount(0);

    await chooseBarber(page, "Ailsa");
    await expect(page.getByRole("heading", { name: "When suits?" })).toBeVisible();
    await expect(page.locator(".day.sel")).toHaveCount(0);
    await expect(page.locator('.day[aria-pressed="true"]')).toHaveCount(0);
    await expect(page.locator(".slot")).toHaveCount(0);
    await expect(page.getByText(/Pick a day to see Ailsa's open times/)).toBeVisible();

    await openFirstDayWithTimes(page, 2).then((s) => s.click());
    await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
    await expect(page.getByLabel("Name")).toHaveValue("");
    await expect(page.getByLabel(/^Email/)).toHaveValue("");
  });

  test("the first step stays empty even after visiting another step and coming back", async ({ page }) => {
    await page.goto("/book");
    await chooseService(page, "Beard trim");
    await page.getByRole("button", { name: "Service" }).click();
    await expect(page.getByRole("heading", { name: "What are you having?" })).toBeVisible();
    // Going back shows what they chose, because they chose it.
    await expect(page.locator(".opt.sel")).toHaveCount(1);
    await expect(page.locator(".opt.sel")).toContainText("Beard trim");
  });
});

test.describe("presets in the address", () => {
  test("a service alone lands on the barber step", async ({ page }) => {
    await page.goto("/book?service=fade");
    await expect(page.getByRole("heading", { name: "Who's cutting?" })).toBeVisible();
    await expect(page.locator(".bar.sel")).toHaveCount(0);
  });

  test("a service and barber land on the time step with that barber", async ({ page }) => {
    await page.goto("/book?service=beard&barber=ailsa");
    await expect(page.getByRole("heading", { name: "When suits?" })).toBeVisible();
    await expect(page.getByText(/Pick a day to see Ailsa's open times/)).toBeVisible();
  });

  test("a date preset opens that day with its times", async ({ page, request }) => {
    const { date, slot } = await findOpenSlot(request, "marek", "cut");
    await page.goto(`/book?service=cut&barber=marek&date=${date}`);
    await expect(page.getByRole("heading", { name: "When suits?" })).toBeVisible();
    await expect(page.locator(".day.sel")).toHaveCount(1);
    await expect(page.locator(".slot", { hasText: slot.label }).first()).toBeVisible();
    await expect(page.locator(".slot.sel")).toHaveCount(0);
  });

  test("a full preset fills in service, barber and time and lands on the details step", async ({ page, request }) => {
    const { date, slot } = await findOpenSlot(request, "ailsa", "fade");
    await page.goto(`/book?service=fade&barber=ailsa&date=${date}&start=${encodeURIComponent(slot.start)}`);
    await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
    await expect(page.getByText(/Skin fade with Ailsa, .*/)).toContainText(slot.label);

    await fillDetailsAndReview(page, "Preset Person", uniqueEmail());
    await expect(page.locator("dd").nth(0)).toHaveText("Skin fade");
    await expect(page.locator("dd").nth(1)).toHaveText("Ailsa");
    await expect(page.locator("dd").nth(2)).toContainText(slot.label);
    await expect(page.locator("dd.big")).toHaveText(money(depositFor(2800)));
  });

  test("an unknown service or barber in the address is ignored and the flow starts at the beginning", async ({ page }) => {
    await page.goto("/book?service=nonsense&barber=nobody&start=not-a-date");
    await expect(page.getByRole("heading", { name: "What are you having?" })).toBeVisible();
    await expect(page.locator(".opt.sel")).toHaveCount(0);
  });

  test("a time in the past in the address is not accepted", async ({ page }) => {
    await page.goto(`/book?service=cut&barber=marek&start=${encodeURIComponent("2020-01-07T10:00:00.000Z")}`);
    await expect(page.getByRole("heading", { name: "When suits?" })).toBeVisible();
    await expect(page.locator(".slot.sel")).toHaveCount(0);
  });
});

test.describe("checking the details", () => {
  async function toDetails(page: import("@playwright/test").Page) {
    await page.goto("/book");
    await chooseService(page, "Haircut");
    await chooseBarber(page, "Marek");
    await (await openFirstDayWithTimes(page, 2)).click();
    await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
  }

  test("empty fields show both errors and stay on the details step", async ({ page }) => {
    await toDetails(page);
    await page.getByRole("button", { name: "Continue to review" }).click();
    await expect(page.locator("#f-name-err")).toBeVisible();
    await expect(page.locator("#f-email-err")).toBeVisible();
    await expect(page.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel(/^Email/)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Hold your chair" })).toHaveCount(0);
    await expect(page.getByLabel("Name")).toBeFocused();
  });

  for (const bad of ["not-an-email", "name@", "@example.com", "two words@example.com", "a@b"]) {
    test(`the email "${bad}" is refused with an error and does not advance`, async ({ page }) => {
      await toDetails(page);
      await page.getByLabel("Name").fill("Valid Name");
      await page.getByLabel(/^Email/).fill(bad);
      await page.getByRole("button", { name: "Continue to review" }).click();
      await expect(page.locator("#f-email-err")).toBeVisible();
      await expect(page.locator("#f-name-err")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Hold your chair" })).toHaveCount(0);
    });
  }

  test("a blank or spaces-only name is refused with an error and does not advance", async ({ page }) => {
    await toDetails(page);
    await page.getByLabel("Name").fill("   ");
    await page.getByLabel(/^Email/).fill(uniqueEmail());
    await page.getByRole("button", { name: "Continue to review" }).click();
    await expect(page.locator("#f-name-err")).toBeVisible();
    await expect(page.locator("#f-email-err")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Hold your chair" })).toHaveCount(0);
  });

  test("fixing the mistakes lets the visitor through to the review step", async ({ page }) => {
    await toDetails(page);
    await page.getByRole("button", { name: "Continue to review" }).click();
    await expect(page.locator("#f-name-err")).toBeVisible();
    const email = uniqueEmail();
    await fillDetailsAndReview(page, "Fixed Up", email);
    await expect(page.locator("dd").nth(3)).toHaveText("Fixed Up");
    await expect(page.locator("dd").nth(4)).toHaveText(email);
  });
});

test.describe("going back", () => {
  test("each step's Back button returns to the step before, all the way to the shop", async ({ page }) => {
    const email = uniqueEmail();
    await walkToReview(page, { name: "Back Walker", email });

    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();

    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "When suits?" })).toBeVisible();

    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Who's cutting?" })).toBeVisible();

    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "What are you having?" })).toBeVisible();

    await page.getByRole("link", { name: "Back to the shop" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("going back from the review step keeps what was typed", async ({ page }) => {
    const email = uniqueEmail();
    await walkToReview(page, { name: "Kept Name", email });
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByLabel("Name")).toHaveValue("Kept Name");
    await expect(page.getByLabel(/^Email/)).toHaveValue(email);
  });

  test("the browser's own Back button walks the same steps", async ({ page }) => {
    await walkToReview(page);
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "When suits?" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Who's cutting?" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "What are you having?" })).toBeVisible();
  });

  test("the step names along the top jump back to an earlier step and later ones are disabled", async ({ page }) => {
    await page.goto("/book");
    await chooseService(page, "Haircut");
    await chooseBarber(page, "Marek");
    await expect(page.getByRole("heading", { name: "When suits?" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Details" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Review" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Time" })).toHaveAttribute("aria-current", "step");
    await page.getByRole("button", { name: "Barber" }).click();
    await expect(page.getByRole("heading", { name: "Who's cutting?" })).toBeVisible();
  });
});

test.describe("leaving Stripe without paying", () => {
  test.setTimeout(120_000);

  test("Stripe's Back link shows the cancelled page, says nothing was charged, and the time is free again", async ({ page, request }) => {
    const { date, slot } = await findOpenSlot(request, "marek", "cut", 3);
    const offered = async () => (await slotsFor(request, "marek", "cut", date)).some((s) => s.start === slot.start);
    expect(await offered(), "the time is on offer before the hold").toBe(true);

    await page.goto(`/book?service=cut&barber=marek&date=${date}&start=${encodeURIComponent(slot.start)}`);
    await fillDetailsAndReview(page, "Cancel Check", uniqueEmail());
    await payAndReachStripe(page);

    await backFromStripe(page);
    await expect(page.getByRole("heading", { name: "Nothing was charged" })).toBeVisible();
    await expect(page.getByText(/nothing was charged|without paying|gone back on sale/i).first()).toBeVisible();
    await expect(page.locator("main, body").first()).toContainText("You left the payment page");
    expect(await offered(), "the time is on offer again once Stripe's Back link was followed").toBe(true);

    await page.getByRole("link", { name: "Pick a time" }).click();
    // The link keeps the service and barber, so the visitor lands straight on choosing a time again.
    await expect(page.getByRole("heading", { name: "When suits?" })).toBeVisible();
    await expect(page.getByText(/Pick a day to see Marek's open times/)).toBeVisible();
    await expect(page.locator(".slot.sel")).toHaveCount(0);
  });
});
