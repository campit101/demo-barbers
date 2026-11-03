// Every export of a "use server" file can be called by anyone who learns its id, so only deliberate actions may live there.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

const serverFiles = files("src").filter((f) => /^\s*["']use server["']/.test(readFileSync(f, "utf8")));

describe("server action files", () => {
  it("exist", () => expect(serverFiles.length).toBeGreaterThan(0));

  it.each(serverFiles)("%s exports only functions named ...Action, plus types", (file) => {
    const source = readFileSync(file, "utf8");
    const names = [...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
    expect(names.filter((n) => !n!.endsWith("Action"))).toEqual([]);
  });
});
