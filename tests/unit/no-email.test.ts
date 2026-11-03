// This demo must never email anyone: visitors can type any address. Fails if a mail sender or mail setting comes back.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SENDERS = ["resend", "nodemailer", "@sendgrid/mail", "postmark", "mailgun.js", "@aws-sdk/client-ses", "brevo", "@getbrevo/brevo"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(tsx?|mjs|js)$/.test(name) ? [path] : [];
  });
}

describe("no email is ever sent", () => {
  it("has no mail-sending package", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as Record<string, Record<string, string> | undefined>;
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies });
    expect(names.filter((n) => SENDERS.includes(n))).toEqual([]);
  });

  it("has no code that imports one, or reads mail settings", () => {
    const hits = [...files("src"), ...files("scripts")].filter((f) => {
      const text = readFileSync(f, "utf8");
      return SENDERS.some((s) => text.includes(`from "${s}"`) || text.includes(`require("${s}")`)) || /RESEND_API_KEY|EMAIL_FROM|SMTP_/.test(text);
    });
    expect(hits).toEqual([]);
  });

  it("has no mail settings in the example environment file", () => {
    expect(readFileSync(".env.example", "utf8")).not.toMatch(/RESEND|EMAIL_FROM|SMTP/);
  });
});
