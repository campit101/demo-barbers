// Takes the README's screenshots, phone and desktop, light and dark, from a running build.
// Usage: node scripts/shoot-readme.mjs <site address>     Run after `node scripts/seed.ts`, so the demo diary is fresh.
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const site = process.argv[2];
if (!site) throw new Error("Say which site to shoot, for example: node scripts/shoot-readme.mjs http://localhost:3210");
const OUT = "docs/screenshots";
mkdirSync(OUT, { recursive: true });

const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const browser = await chromium.launch();
for (const [device, viewport] of Object.entries(SIZES)) {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport, colorScheme: theme, deviceScaleFactor: device === "phone" ? 2 : 1, reducedMotion: "reduce" });
    const page = await context.newPage();
    const shot = async (name) => {
      await page.waitForLoadState("networkidle");
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `${OUT}/${name}-${device}${theme === "dark" ? "-dark" : ""}.png` });
    };

    await page.goto(new URL("/", site).href);
    await shot("home");

    await page.goto(new URL("/book", site).href);
    await page.locator(".opt").first().click();
    await page.locator(".bar", { hasText: "Ailsa" }).click();
    const days = page.locator('[aria-label="Choose a day"] .day:not([disabled])');
    await days.first().waitFor();
    await days.nth(3).click();
    await page.locator(".slot").first().waitFor();
    await shot("times");

    await page.locator(".slot").first().click();
    await page.getByLabel("Name").fill("Sam Taylor");
    await page.getByLabel(/^Email/).fill("sam@example.com");
    await page.getByRole("button", { name: "Continue to review" }).click();
    await page.getByRole("heading", { name: "Hold your chair" }).waitFor();
    await shot("review");

    await page.goto(new URL("/admin/sign-in", site).href);
    await page.getByRole("button", { name: "Try the admin" }).click();
    await page.waitForURL(/\/admin(\?|$)/);
    await shot("diary");

    await context.close();
    console.log(`${device} ${theme} done`);
  }
}
await browser.close();
