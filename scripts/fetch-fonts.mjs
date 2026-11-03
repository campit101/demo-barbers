// Downloads the official web fonts from Fontshare into public/fonts. The licence (ITF Free Font License 2.0) allows self-hosting
// on our own site but not redistributing the files through a public repository, so they are git-ignored and fetched here.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WANTED = [
  { family: "gambarino", file: "Gambarino-Regular.woff2" },
  { family: "general-sans", file: "GeneralSans-Regular.woff2" },
  { family: "general-sans", file: "GeneralSans-Medium.woff2" },
];
const out = join("public", "fonts");
mkdirSync(out, { recursive: true });
if (WANTED.every((w) => existsSync(join(out, w.file)))) {
  console.log("Fonts already in place.");
  process.exit(0);
}

function find(dir, name) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      const hit = find(p, name);
      if (hit) return hit;
    } else if (entry === name) return p;
  }
  return null;
}

const work = mkdtempSync(join(tmpdir(), "fonts-"));
try {
  for (const family of new Set(WANTED.map((w) => w.family))) {
    const res = await fetch(`https://api.fontshare.com/v2/fonts/download/${family}`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`Fontshare answered ${res.status} for ${family}`);
    const zip = join(work, `${family}.zip`);
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    const dest = join(work, family);
    mkdirSync(dest);
    // Windows' own tar reads zip files; Git Bash's tar, which may come first on PATH, cannot.
    const tool = process.platform === "win32" ? [join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", zip, "-C", dest]] : ["unzip", ["-oq", zip, "-d", dest]];
    const r = spawnSync(tool[0], tool[1], { stdio: "inherit" });
    if (r.status !== 0) throw new Error(`Could not unpack ${family}`);
    for (const w of WANTED.filter((x) => x.family === family)) {
      const found = find(dest, w.file);
      if (!found) throw new Error(`${w.file} not found in the download`);
      copyFileSync(found, join(out, w.file));
    }
  }
  console.log(`Fonts ready in ${out}.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
