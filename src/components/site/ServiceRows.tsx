"use client";

import Link from "next/link";
import { useState } from "react";
import { SERVICES } from "@/config/shop";
import { formatPrice } from "@/lib/time";
import { Photo } from "./Photo";

export function ServiceRows() {
  const [peek, setPeek] = useState<string>("cut");
  return (
    <div className="svc-grid">
      <div className="svc-pics reveal">
        {SERVICES.map((s) => (
          <Photo key={s.id} className={s.id === peek ? "on" : ""} src={s.photo} alt={s.alt} sizes="(max-width: 1023px) 75vw, 50vw" style={{ objectPosition: s.focus }} />
        ))}
      </div>
      <div>
        {SERVICES.map((s) => (
          <Link key={s.id} className="row" href={`/book?service=${s.id}`} onMouseEnter={() => setPeek(s.id)} onFocus={() => setPeek(s.id)}>
            <span className="row-thumb">
              <Photo src={s.photo} alt="" sizes="72px" style={{ objectPosition: s.focus }} />
            </span>
            <span className="svc-name">{s.name}</span>
            <span className="mins">{s.minutes} minutes</span>
            <span className="price">{formatPrice(s.pricePence)}</span>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 10h12M11 5l5 5-5 5" />
            </svg>
          </Link>
        ))}
        <p className="svc-note">Pay 20% now and the rest in the shop. Free to cancel up to 24 hours before.</p>
      </div>
    </div>
  );
}
