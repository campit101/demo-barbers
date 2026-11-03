import type { Metadata } from "next";
import Link from "next/link";
import { Outcome } from "@/components/site/Outcome";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <Outcome>
      <h1 className="disp book-h">That page is not here</h1>
      <p className="para">The link may be old or mistyped. The shop and the booking steps are still open.</p>
      <div className="acts">
        <Link className="btn" href="/book">
          Book a chair
        </Link>
        <Link className="btn2" href="/">
          Back to the shop
        </Link>
      </div>
    </Outcome>
  );
}
