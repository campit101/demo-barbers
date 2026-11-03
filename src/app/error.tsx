"use client";

import Link from "next/link";
import { Outcome } from "@/components/site/Outcome";

export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return (
    <Outcome>
      <h1 className="disp book-h">Something went wrong</h1>
      <p className="para" role="alert">
        This page could not load. If you were paying, a payment that went through is never lost: try again to reach the page with your private link.
      </p>
      <div className="acts">
        <button type="button" className="btn" onClick={() => retry()}>
          Try again
        </button>
        <Link className="btn2" href="/">
          Back to the shop
        </Link>
      </div>
    </Outcome>
  );
}
