// Connection strings from Neon say sslmode=require. Ask for full certificate checks instead,
// so the connection is both encrypted and proven to be Neon's server (and pg stops warning).
export function withVerifiedTls(url: string): string {
  const u = new URL(url);
  u.searchParams.set("sslmode", "verify-full");
  return u.toString();
}
