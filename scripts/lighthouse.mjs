// Lighthouse, mobile, five runs per page, reporting the median of each score. Results are saved so nothing is quoted from memory.
// Playwright starts Chromium with a debugging port and Lighthouse attaches to it.
// Usage: npm run lighthouse -- <site address> [path ...]     Default paths: / and /book
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import lighthouse from "lighthouse";

const RUNS = 5;
const PORT = 9334;
const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];

const [site, ...rest] = process.argv.slice(2);
if (!site) {
  console.error("Say which site to test, for example: npm run lighthouse -- http://localhost:3210");
  process.exit(1);
}
const paths = rest.length ? rest : ["/", "/book"];
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const browser = await chromium.launch({ args: [`--remote-debugging-port=${PORT}`] });
const pages = [];
try {
  for (const path of paths) {
    const url = new URL(path, site).href;
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      // Lighthouse's default settings are its mobile preset: phone screen, slowed network and processor.
      const result = await lighthouse(url, { port: PORT, output: "json", logLevel: "error", onlyCategories: CATEGORIES });
      if (!result?.lhr || result.lhr.runtimeError) throw new Error(`Lighthouse failed on ${url}: ${result?.lhr?.runtimeError?.message ?? "no result"}`);
      runs.push(result.lhr);
    }
    const medians = Object.fromEntries(CATEGORIES.map((c) => [c, Math.round(median(runs.map((r) => r.categories[c].score)) * 100)]));
    const metrics = {
      lcpMs: Math.round(median(runs.map((r) => r.audits["largest-contentful-paint"].numericValue))),
      cls: Number(median(runs.map((r) => r.audits["cumulative-layout-shift"].numericValue)).toFixed(3)),
      tbtMs: Math.round(median(runs.map((r) => r.audits["total-blocking-time"].numericValue))),
    };
    const failing = [...new Set(runs.flatMap((r) => Object.values(r.categories).flatMap((c) => c.auditRefs.filter((a) => r.audits[a.id].score !== null && r.audits[a.id].score < 0.9 && a.weight > 0).map((a) => a.id))))];
    pages.push({ url, runs: RUNS, medians, metrics, failing });
    console.log(`${url}: ${CATEGORIES.map((c) => `${c} ${medians[c]}`).join(", ")}; LCP ${metrics.lcpMs} ms, CLS ${metrics.cls}, TBT ${metrics.tbtMs} ms; below 90 in any run: ${failing.join(", ") || "none"}`);
  }
} finally {
  await browser.close();
}

mkdirSync("docs", { recursive: true });
writeFileSync("docs/lighthouse.json", `${JSON.stringify({ measuredAt: new Date().toISOString(), site, lighthouse: "13.5.0", preset: "mobile", pages }, null, 2)}\n`);
console.log("Saved to docs/lighthouse.json");
