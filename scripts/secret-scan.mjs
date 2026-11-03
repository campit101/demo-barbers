// Scans every file git would commit (tracked plus new, not ignored) for secrets.
// Ignored files such as .env.local are deliberately skipped: they are meant to hold secrets.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const list = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
if (list.status !== 0) {
  process.stderr.write(list.stderr || "git ls-files failed\n");
  process.exit(1);
}

const files = list.stdout
  .split("\0")
  .filter(Boolean)
  .filter((file) => !/\.(png|jpe?g|gif|webp|ico|mp4|webm|woff2?|ttf)$/i.test(file))
  .filter((file) => file !== "package-lock.json");

// Call the CLI through node directly (no shell) and keep each command line well under Windows limits.
const secretlint = join("node_modules", "secretlint", "bin", "secretlint.js");
const chunkSize = 100;
let failed = false;
for (let i = 0; i < files.length; i += chunkSize) {
  const chunk = files.slice(i, i + chunkSize);
  const result = spawnSync(process.execPath, [secretlint, "--maskSecrets", ...chunk], {
    stdio: "inherit",
  });
  if (result.status !== 0) failed = true;
}

if (failed) {
  process.stderr.write("\nSecret scan found something that looks like a secret. Remove it before committing.\n");
  process.exit(1);
}
process.stdout.write(`Secret scan clean (${files.length} files).\n`);
