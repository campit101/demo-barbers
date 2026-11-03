import Link from "next/link";
import { ThemeSwitch } from "./ThemeSwitch";

export function SiteNav() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="nav">
        <Link className="logo" href="/">
          Demo Barbers
        </Link>
        <nav className="navr" aria-label="Main">
          <Link className="lnk" href="/#services">
            Services
          </Link>
          <Link className="lnk" href="/#shop">
            The shop
          </Link>
          <Link className="lnk" href="/#barbers">
            Barbers
          </Link>
          <Link className="lnk" href="/#questions">
            Questions
          </Link>
          <ThemeSwitch />
          <Link className="btn" href="/book">
            Book now
          </Link>
        </nav>
      </header>
    </>
  );
}
