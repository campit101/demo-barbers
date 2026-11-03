// Runs every quality check in order and exits non-zero if any fails.
// Usage: npm run verify
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const root = process.cwd();
const require = createRequire(join(root, "package.json"));

/** Path to a locally installed CLI's JavaScript entry, run with node directly (no shell). */
function bin(pkg, name) {
  const manifest = require.resolve(`${pkg}/package.json`);
  const { bin: bins } = require(manifest);
  const entry = typeof bins === "string" ? bins : bins[name];
  return join(dirname(manifest), entry);
}

function run(label, command, args, env = {}) {
  const started = Date.now();
  process.stdout.write(`\n=== ${label} ===\n`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...env },
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.status !== 0) {
    process.stderr.write(`\nVERIFY FAILED at step "${label}" (${seconds}s).\n`);
    process.exit(result.status ?? 1);
  }
  process.stdout.write(`--- ${label} passed (${seconds}s)\n`);
}

const node = (label, pkg, name, args, env) => run(label, process.execPath, [bin(pkg, name), ...args], env);

// Start from clean builds: stale generated route types in old build folders referenced deleted routes (23 Oct).
// .next-e2e is the browser tests' build; Playwright rebuilds it on its next run.
for (const dir of [".next-verify", ".next-e2e"]) rmSync(join(root, dir), { recursive: true, force: true });
rmSync(join(root, "tsconfig.tsbuildinfo"), { force: true });

node("lint", "eslint", "eslint", [".", "--max-warnings=0"]);
node("route types", "next", "next", ["typegen"]);
node("typecheck", "typescript", "tsc", ["--noEmit"]);
node("unit tests", "vitest", "vitest", ["run"]);
node("build", "next", "next", ["build"], { NEXT_DIST_DIR: ".next-verify" });
run("secret scan", process.execPath, [join("scripts", "secret-scan.mjs")]);

process.stdout.write("\nVERIFY PASSED: all checks green.\n");
