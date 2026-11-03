// The whole booking, from the first step to the review step, with the keyboard alone. Desktop only.
import type { Page } from "@playwright/test";
import { expect, findOpenSlot, resetRateLimits, test, uniqueEmail } from "./helpers.ts";

test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop", "Desktop only"));
test.beforeAll(resetRateLimits);

interface Target {
  selector: string;
  /** The element's own text must equal this (after trimming), or contain it when `contains` is set. */
  text?: string;
  contains?: boolean;
}

interface Stop {
  label: string;
  outline: string;
  focused: boolean;
}

/** Presses Tab until the target has focus, checking that every element passed on the way shows a focus outline. */
async function tabTo(page: Page, target: Target, stops: Stop[], maxTabs = 60) {
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate((t) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return { label: "(nothing)", outline: "none", focused: false, hit: false };
      const s = getComputedStyle(el);
      const label = `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || el.id).trim().replace(/\s+/g, " ").slice(0, 40)}"`;
      const text = el.textContent?.trim() ?? "";
      const hit = el.matches(t.selector) && (t.text === undefined || (t.contains ? text.includes(t.text) : text === t.text));
      const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0 ? `${s.outlineWidth} ${s.outlineStyle}` : "none";
      return { label, outline, focused: el.matches(":focus-visible"), hit };
    }, target);
    stops.push({ label: stop.label, outline: stop.outline, focused: stop.focused });
    if (stop.hit) return;
  }
  throw new Error(`Tab never reached ${JSON.stringify(target)}. Stops: ${stops.map((s) => s.label).join(" > ")}`);
}

const dayText = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

test("a visitor can book as far as the review step using only the keyboard, and always sees where focus is", async ({ page, request }) => {
  const { date, slot } = await findOpenSlot(request, "marek", "cut", 2);
  const stops: Stop[] = [];
  const email = uniqueEmail();

  await page.goto("/book");
  await expect(page.getByRole("heading", { name: "What are you having?" })).toBeVisible();

  // Service
  await tabTo(page, { selector: ".opt", text: "Haircut", contains: true }, stops);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Who's cutting?" })).toBeFocused();

  // Barber
  await tabTo(page, { selector: ".bar", text: "Marek", contains: true }, stops);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "When suits?" })).toBeFocused();

  // Day, then time
  await tabTo(page, { selector: ".day", text: dayText(date), contains: true }, stops);
  await page.keyboard.press("Enter");
  await expect(page.locator(".slot").first()).toBeVisible();
  await tabTo(page, { selector: ".slot", text: slot.label }, stops);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Your details" })).toBeFocused();

  // Details
  await tabTo(page, { selector: "#f-name" }, stops);
  await page.keyboard.type("Keyboard Only");
  await page.keyboard.press("Tab");
  await expect(page.locator("#f-email")).toBeFocused();
  await page.keyboard.type(email);
  await tabTo(page, { selector: "button.btn", text: "Continue to review" }, stops);
  await page.keyboard.press("Enter");

  // Review
  await expect(page.getByRole("heading", { name: "Hold your chair" })).toBeFocused();
  await tabTo(page, { selector: "button.btn", contains: true, text: "Pay £" }, stops);
  await expect(page.locator("dd").nth(3)).toHaveText("Keyboard Only");
  await expect(page.locator("dd").nth(4)).toHaveText(email);

  const blind = stops.filter((s) => s.outline === "none");
  expect(blind.map((s) => s.label), "every stop on the way should show a focus outline").toEqual([]);
  expect(stops.filter((s) => !s.focused).map((s) => s.label)).toEqual([]);
  expect(stops.length).toBeGreaterThan(8);
});

test("the Skip to content link is the first stop, appears when focused, and works", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  const box = await skip.boundingBox();
  expect(box && box.y >= 0 && box.height >= 44, "visible on screen and tall enough while focused").toBe(true);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("the theme switch can be used with the keyboard", async ({ page }) => {
  await page.goto("/");
  const sw = page.getByRole("button", { name: /^Colour theme:/ });
  await sw.focus();
  await page.keyboard.press("Enter");
  await expect(sw).toHaveAccessibleName("Colour theme: Light. Change");
  await page.keyboard.press("Space");
  await expect(sw).toHaveAccessibleName("Colour theme: Dark. Change");
});
