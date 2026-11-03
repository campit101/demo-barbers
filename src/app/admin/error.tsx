"use client";

import Link from "next/link";

export default function AdminErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return (
    <main className="main">
      <div className="title-row">
        <h1 className="ad-disp">Something went wrong</h1>
      </div>
      <div className="ad-empty">
        <p role="alert">The diary could not load this page. Please try again, or go back to the day view.</p>
        <div className="ad-acts">
          <button type="button" className="ad-btn" onClick={() => retry()}>
            Try again
          </button>
          <Link className="ad-btn2" href="/admin">
            Back to the diary
          </Link>
        </div>
      </div>
    </main>
  );
}
