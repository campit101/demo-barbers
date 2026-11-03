import Link from "next/link";
import { signOutAction } from "@/auth/actions";
import type { AdminUser } from "@/auth/session";
import { ThemeSwitch } from "./theme-switch";

const NAV = [
  { id: "day", label: "Day", href: "/admin" },
  { id: "week", label: "Week", href: "/admin/week" },
  { id: "booked", label: "What's booked", href: "/admin/booked" },
  { id: "block", label: "Block time", href: "/admin/block" },
] as const;

export function AdminShell({ user, active, skip = { href: "#main", label: "Skip to content" }, children }: { user: AdminUser; active: (typeof NAV)[number]["id"]; skip?: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <div className="shell">
      <a className="ad-skip" href={skip.href}>
        {skip.label}
      </a>
      <aside className="side" aria-label="Sections">
        <div className="ad-disp ad-logo">Demo Barbers</div>
        <nav className="side-nav" aria-label="Diary">
          {NAV.map((n) => (
            <Link key={n.id} href={n.href} className={n.id === active ? "ad-nav on" : "ad-nav"} aria-current={n.id === active ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <ThemeSwitch />
        <form action={signOutAction}>
          <button type="submit" className="ad-nav">
            Sign out
          </button>
        </form>
        {user.role === "demo" ? <p className="side-foot">Demo data. Resets every 24 hours.</p> : null}
      </aside>
      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
