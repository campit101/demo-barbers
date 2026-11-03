"use client";

import { useEffect, useRef, useState } from "react";

/** A table's scrolling box, with a small cue above it only while the table is actually wider than the box. */
export function ScrollTable({ label, children }: { label: string; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const watcher = new ResizeObserver(() => setOverflows(el.scrollWidth > el.clientWidth + 1));
    watcher.observe(el);
    if (el.firstElementChild) watcher.observe(el.firstElementChild);
    return () => watcher.disconnect();
  }, []);
  return (
    <>
      <p className="tbl-hint" hidden={!overflows}>
        Swipe sideways to see more
      </p>
      <div ref={box} className="tbl-wrap" tabIndex={0} role="region" aria-label={label}>
        {children}
      </div>
    </>
  );
}
