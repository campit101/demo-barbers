import type { Metadata } from "next";
import { Suspense } from "react";
import { BookFlow } from "@/components/site/BookFlow";
import { Photo, SHOP_ALT } from "@/components/site/Photo";
import { SiteNav } from "@/components/site/SiteNav";

export const metadata: Metadata = { title: "Book a chair" };

function Waiting() {
  return (
    <div className="book">
      <div className="book-side">
        <Photo className="shop-crop" src="/photos/shop.jpg" alt={SHOP_ALT} sizes="100vw" />
      </div>
      <div className="book-main">
        <h1 className="disp book-h">Book a chair</h1>
        <p className="para" role="status">
          Getting the booking steps ready.
        </p>
        <noscript>
          <p className="para">Picking a time needs JavaScript, which is switched off in this browser.</p>
        </noscript>
      </div>
    </div>
  );
}

export default function BookPage() {
  return (
    <>
      <SiteNav />
      <main id="main">
        <Suspense fallback={<Waiting />}>
          <BookFlow />
        </Suspense>
      </main>
    </>
  );
}
