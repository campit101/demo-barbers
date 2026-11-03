// No cookies for visitors, no third parties, and only the session cookie once someone signs in to the demo diary.
import { demoSignIn, expect, resetRateLimits, test, walkToReview } from "./helpers.ts";

test.beforeAll(resetRateLimits);

/** Every address the page asked for that is not this site. Inline data: and blob: addresses stay in the page. */
function foreignRequests(urls: string[], origin: string): string[] {
  return urls.filter((u) => !u.startsWith("data:") && !u.startsWith("blob:") && new URL(u).origin !== origin);
}

test("a visitor who walks from the home page to the review step is given no cookies", async ({ page, context, baseURL }) => {
  const seen: string[] = [];
  page.on("request", (r) => seen.push(r.url()));

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Book now" })).toBeVisible();
  await walkToReview(page);
  await page.waitForLoadState("networkidle");

  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).toBe("");
  expect(seen.length).toBeGreaterThan(5);
  expect(foreignRequests(seen, new URL(baseURL ?? "").origin)).toEqual([]);
});

test("the pages a visitor can land on make no requests to other sites and set no cookies", async ({ page, context, baseURL }) => {
  const seen: string[] = [];
  page.on("request", (r) => seen.push(r.url()));
  for (const path of ["/", "/book", "/admin/sign-in", "/manage/not-a-real-link", "/this-page-does-not-exist"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  expect(await context.cookies()).toEqual([]);
  expect(foreignRequests(seen, new URL(baseURL ?? "").origin)).toEqual([]);
});

test("signing in as the demo sets only the session cookie the sign-in needs", async ({ page, context, baseURL }) => {
  const seen: string[] = [];
  page.on("request", (r) => seen.push(r.url()));
  expect(await context.cookies()).toEqual([]);

  await demoSignIn(page);
  await page.waitForLoadState("networkidle");

  const cookies = await context.cookies();
  const names = cookies.map((c) => c.name);
  test.info().annotations.push({ type: "cookie names after demo sign-in", description: names.join(", ") });
  console.log(`Cookies after demo sign-in: ${names.join(", ")}`);

  expect(names).toEqual(["better-auth.session_token"]);
  // Only session cookies: nothing for analytics, ads or preferences.
  for (const c of cookies) {
    expect(c.name, `cookie ${c.name} should be a session cookie`).toMatch(/session/i);
    expect(c.httpOnly, `cookie ${c.name} should be httpOnly`).toBe(true);
    expect(c.sameSite, `cookie ${c.name} should be SameSite`).not.toBe("None");
    expect(new URL(baseURL ?? "").hostname).toContain(c.domain.replace(/^\./, ""));
  }
  expect(foreignRequests(seen, new URL(baseURL ?? "").origin)).toEqual([]);

  // Signing out takes the session away again.
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/admin\/sign-in/);
  const left = (await context.cookies()).filter((c) => c.value !== "" && (c.expires === -1 || c.expires > Date.now() / 1000));
  expect(left.map((c) => c.name)).toEqual([]);
});
