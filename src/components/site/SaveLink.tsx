"use client";

import { useState } from "react";

/** The private link in full, with a copy button, because this demo never emails it. */
export function SaveLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="save-link">
      <label htmlFor="private-link">Your private link</label>
      <div className="save-row">
        <input id="private-link" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          className="btn2"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      <p className="tiny" aria-live="polite">
        {copied ? "Copied. Keep it somewhere safe, such as a note or a bookmark." : "Copy it, or bookmark the next page."}
      </p>
    </div>
  );
}
