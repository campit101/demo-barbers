import type { ReactNode } from "react";
import { Photo, SHOP_ALT } from "./Photo";
import { SiteNav } from "./SiteNav";

/** The shared frame for booking results and the private link: the booking layout with the shop photo beside it. */
export function Outcome({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteNav />
      <main id="main">
        <div className="book">
          <div className="book-side">
            <Photo className="shop-crop" src="/photos/shop.jpg" alt={SHOP_ALT} sizes="100vw" />
          </div>
          <div className="book-main">{children}</div>
        </div>
      </main>
    </>
  );
}
