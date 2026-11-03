// Every public page: the demo banner, no sideways scroll at five widths, tap targets of 44 px, and a clean console.
import type { Page } from "@playwright/test";
import { BANNER, expect, test, chooseBarber, chooseService, fillDetailsAndReview, openFirstDayWithTimes, resetRateLimits, uniqueEmail, watchConsole } from "./helpers.ts";

test.beforeAll(resetRateLimits);

const WIDTHS = [320, 390, 820, 1440, 1920];

const PAGES = [
  { name: "home", path: "/", heading: /Demo\s*Barbers/ },
  { name: "book, first step", path: "/book", heading: /What are you having\?/ },
  { name: "admin sign-in", path: "/admin/sign-in", heading: /The shop's diary/ },
  { name: "404", path: "/this-page-does-not-exist", heading: /That page is not here/ },
  { name: "bad manage link", path: "/manage/not-a-real-link", heading: /Booking not found/ },
] as const;

/** Visible links, buttons, summaries and fields that are shorter than 44 px. Off-screen skip links are not visible. */
async function shortTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    let checked = 0;
    const nodes = document.querySelectorAll<HTMLElement>("a[href], button, summary, input:not([type=hidden]), select, textarea");
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const shown = r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0;
      const onPage = r.bottom > 0 && r.right > 0 && r.left < document.documentElement.scrollWidth && r.top < document.documentElement.scrollHeight;
      if (shown && onPage) checked++;
      if (shown && onPage && r.height < 43.5) {
        const label = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("name") || "").trim().replace(/\s+/g, " ").slice(0, 40);
        out.push(`${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ").join(".") : ""} "${label}" is ${Math.round(r.height * 10) / 10}px tall`);
      }
    }
    if (checked === 0) out.push("no visible targets were found, so the check proved nothing");
    return out;
  });
}

async function overflowAt(page: Page, width: number): Promise<number> {
  const height = page.viewportSize()?.height ?? 900;
  await page.setViewportSize({ width, height });
  // Let layout and any resize listeners settle before measuring.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

for (const p of PAGES) {
  test.describe(p.name, () => {
    test("shows the demo banner and the right heading, with no console errors", async ({ page }) => {
      const errors = watchConsole(page);
      await page.goto(p.path);
      await expect(page.getByRole("heading", { level: 1 }).filter({ hasText: p.heading })).toBeVisible();
      await expect(page.getByText(BANNER)).toBeVisible();
      await page.waitForLoadState("networkidle");
      // Chrome itself logs the 404 status of the page address when a page really is missing. That is not an app error.
      const own = p.name === "404" ? errors.filter((e) => !e.includes("status of 404")) : errors;
      expect(own).toEqual([]);
    });

    test("does not scroll sideways at 320, 390, 820, 1440 and 1920 px", async ({ page }) => {
      await page.goto(p.path);
      await page.waitForLoadState("networkidle");
      for (const w of WIDTHS) {
        expect.soft(await overflowAt(page, w), `${p.name} overflows sideways at ${w}px`).toBeLessThanOrEqual(0);
      }
    });

    test("every visible link, button, summary and input is at least 44 px tall", async ({ page }) => {
      await page.goto(p.path);
      await page.waitForLoadState("networkidle");
      expect(await shortTargets(page)).toEqual([]);
    });
  });
}

test.describe("book, every step", () => {
  test("banner, width, tap targets and console are right on each step", async ({ page }) => {
    const errors = watchConsole(page);
    const problems: string[] = [];

    const audit = async (step: string) => {
      await expect(page.getByText(BANNER)).toBeVisible();
      await page.waitForLoadState("networkidle");
      const keep = page.viewportSize() ?? { width: 1440, height: 900 };
      for (const w of WIDTHS) {
        const extra = await overflowAt(page, w);
        if (extra > 0) problems.push(`${step}: sideways scroll of ${extra}px at ${w}px`);
      }
      await page.setViewportSize(keep);
      for (const s of await shortTargets(page)) problems.push(`${step}: ${s}`);
    };

    await page.goto("/book");
    await expect(page.getByRole("heading", { name: "What are you having?" })).toBeVisible();
    await audit("service");

    await chooseService(page, "Haircut");
    await expect(page.getByRole("heading", { name: "Who's cutting?" })).toBeVisible();
    await expect(page.locator(".bar").first()).toContainText(/Next free|Nothing free|See open times/);
    await audit("barber");

    await chooseBarber(page, "Marek");
    await expect(page.getByRole("heading", { name: "When suits?" })).toBeVisible();
    const slot = await openFirstDayWithTimes(page, 2);
    await audit("time");

    await slot.click();
    await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
    await audit("details");

    await fillDetailsAndReview(page, "Page Check", uniqueEmail());
    await audit("review");

    expect(problems).toEqual([]);
    expect(errors).toEqual([]);
  });
});
