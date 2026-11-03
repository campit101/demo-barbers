// axe finds nothing on any page, in light and in dark. Reduced motion is on so no page is measured half way through an entrance.
import type { Page } from "@playwright/test";
import { axeViolations, expect, test, chooseBarber, chooseService, demoSignIn, fillDetailsAndReview, openFirstDayWithTimes, resetRateLimits, themeOf, uniqueEmail } from "./helpers.ts";

test.beforeAll(resetRateLimits);

const THEMES = ["light", "dark"] as const;

async function useTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // The same storage key the real switch writes, set before the first paint, so the page starts in this theme.
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("db-theme", t);
    } catch {
      // Storage unavailable: the test will fail on the theme check below, which is the right outcome.
    }
  }, theme);
}

async function expectClean(page: Page, theme: string, label: string) {
  await page.waitForLoadState("networkidle");
  expect(await themeOf(page), `${label} should be in ${theme}`).toBe(theme);
  expect(await axeViolations(page), `${label} in ${theme}`).toEqual([]);
}

for (const theme of THEMES) {
  test.describe(`axe in ${theme}`, () => {
    test("home has no violations", async ({ page }) => {
      await useTheme(page, theme);
      await page.goto("/");
      await expectClean(page, theme, "home");
    });

    test("every /book step has no violations", async ({ page }) => {
      await useTheme(page, theme);
      await page.goto("/book");
      await expect(page.getByRole("heading", { name: "What are you having?" })).toBeVisible();
      await expectClean(page, theme, "service step");

      await chooseService(page, "Haircut");
      await expect(page.getByRole("heading", { name: "Who's cutting?" })).toBeVisible();
      await expect(page.locator(".bar").first()).toContainText(/Next free|Nothing free|See open times/);
      await expectClean(page, theme, "barber step");

      await chooseBarber(page, "Marek");
      await expect(page.getByRole("heading", { name: "When suits?" })).toBeVisible();
      const slot = await openFirstDayWithTimes(page, 2);
      await expectClean(page, theme, "time step");

      await slot.click();
      await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
      await expectClean(page, theme, "details step");

      // The error state is a separate screen state worth checking too.
      await page.getByRole("button", { name: "Continue to review" }).click();
      await expect(page.getByRole("alert").first()).toBeVisible();
      await expectClean(page, theme, "details step with errors");

      await fillDetailsAndReview(page, "Axe Check", uniqueEmail());
      await expectClean(page, theme, "review step");
    });

    test("admin sign-in has no violations", async ({ page }) => {
      await useTheme(page, theme);
      await page.goto("/admin/sign-in");
      await expectClean(page, theme, "sign-in");
    });

    test("404 and a bad manage link have no violations", async ({ page }) => {
      await useTheme(page, theme);
      await page.goto("/this-page-does-not-exist");
      await expectClean(page, theme, "404");
      await page.goto("/manage/not-a-real-link");
      await expectClean(page, theme, "bad manage link");
    });

    test("each admin page has no violations", async ({ page }) => {
      await useTheme(page, theme);
      await demoSignIn(page);
      for (const [label, path] of [
        ["day", "/admin"],
        ["week", "/admin/week"],
        ["what's booked", "/admin/booked"],
        ["block time", "/admin/block"],
      ] as const) {
        await page.goto(path);
        await expectClean(page, theme, `admin ${label}`);
      }
      // A booking picked in the diary opens the side panel, which has its own buttons and text.
      await page.goto("/admin");
      await page.locator("a.entry, .col a[id^='bk-']").first().click();
      await expect(page.getByRole("button", { name: "Completed" })).toBeVisible();
      await expectClean(page, theme, "admin day with a booking selected");
    });
  });
}
