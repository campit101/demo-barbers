// The Auto / Light / Dark choice: it survives a reload, is shared by the shop and the diary, and Auto follows the device.
import type { Page } from "@playwright/test";
import { demoSignIn, expect, resetRateLimits, siteThemeSwitch, test, themeOf } from "./helpers.ts";

test.beforeAll(resetRateLimits);

const background = (page: Page) =>
  page.evaluate(() => {
    const solid = (c: string) => c !== "rgba(0, 0, 0, 0)" && c !== "transparent";
    const body = getComputedStyle(document.body).backgroundColor;
    return solid(body) ? body : getComputedStyle(document.documentElement).backgroundColor;
  });

async function waitForTheme(page: Page, theme: string) {
  await expect.poll(() => themeOf(page)).toBe(theme);
}

test("the switch goes Auto, Light, Dark and round again, and says which it is on", async ({ page }) => {
  await page.goto("/");
  const sw = siteThemeSwitch(page);
  await expect(sw).toHaveAccessibleName("Colour theme: Auto. Change");
  expect(await themeOf(page)).toBe("auto");

  await sw.click();
  await expect(sw).toHaveAccessibleName("Colour theme: Light. Change");
  expect(await themeOf(page)).toBe("light");

  await sw.click();
  await expect(sw).toHaveAccessibleName("Colour theme: Dark. Change");
  expect(await themeOf(page)).toBe("dark");

  await sw.click();
  await expect(sw).toHaveAccessibleName("Colour theme: Auto. Change");
  expect(await themeOf(page)).toBe("auto");
});

test("a chosen theme survives a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const lightBackground = await background(page);

  await siteThemeSwitch(page).click();
  await siteThemeSwitch(page).click();
  expect(await themeOf(page)).toBe("dark");
  const darkBackground = await background(page);
  expect(darkBackground).not.toBe(lightBackground);

  await page.reload();
  expect(await themeOf(page)).toBe("dark");
  await expect(siteThemeSwitch(page)).toHaveAccessibleName("Colour theme: Dark. Change");
  expect(await background(page)).toBe(darkBackground);
  expect(await page.evaluate(() => localStorage.getItem("db-theme"))).toBe("dark");

  // Another page of the shop starts in the same theme.
  await page.goto("/book");
  expect(await themeOf(page)).toBe("dark");
});

test("a theme chosen on the shop is used in the diary, and one chosen in the diary is used on the shop", async ({ page }) => {
  await page.goto("/");
  await siteThemeSwitch(page).click();
  expect(await themeOf(page)).toBe("light");

  await demoSignIn(page);
  expect(await themeOf(page)).toBe("light");
  const adminSwitch = page.getByRole("button", { name: /^Colour theme:/ });
  await expect(adminSwitch).toHaveAccessibleName("Colour theme: Light. Change");

  await adminSwitch.click();
  await expect(adminSwitch).toHaveAccessibleName("Colour theme: Dark. Change");
  const adminDark = await background(page);

  await page.reload();
  expect(await themeOf(page)).toBe("dark");
  expect(await background(page)).toBe(adminDark);

  await page.goto("/");
  expect(await themeOf(page)).toBe("dark");
  await expect(siteThemeSwitch(page)).toHaveAccessibleName("Colour theme: Dark. Change");
});

test("Auto follows the colour scheme the device asks for, live", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await waitForTheme(page, "auto");
  const autoLight = await background(page);

  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => background(page)).not.toBe(autoLight);
  const autoDark = await background(page);

  // The same colours as choosing Light and Dark by hand.
  await siteThemeSwitch(page).click();
  expect(await themeOf(page)).toBe("light");
  const chosenLight = await background(page);
  await siteThemeSwitch(page).click();
  expect(await themeOf(page)).toBe("dark");
  const chosenDark = await background(page);

  expect(autoLight).toBe(chosenLight);
  expect(autoDark).toBe(chosenDark);
  expect(chosenLight).not.toBe(chosenDark);

  // A chosen theme ignores the device.
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => background(page)).toBe(chosenDark);
});

test("Auto follows the device in the diary too", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await demoSignIn(page);
  expect(await themeOf(page)).toBe("auto");
  const light = await background(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => background(page)).not.toBe(light);
});

test("the shop still works when the browser refuses to store the choice", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await siteThemeSwitch(page).click();
  expect(await themeOf(page)).toBe("light");
  expect(errors).toEqual([]);
});
