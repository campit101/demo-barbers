"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Chair {
  barberId: string;
  name?: string;
  start: string | null;
  date: string | null;
  when: string;
}

// The hero and the barber cards share one request.
let pending: { at: number; result: Promise<Chair[] | null> } | null = null;

function loadChairs(): Promise<Chair[] | null> {
  if (pending && Date.now() - pending.at < 60_000) return pending.result;
  const result = fetch("/api/next-free", { cache: "no-store", signal: AbortSignal.timeout(8000) })
    .then(async (r) => {
      if (!r.ok) return null;
      const body = (await r.json()) as { chairs?: Chair[] };
      return Array.isArray(body.chairs) ? body.chairs : null;
    })
    .catch(() => null);
  pending = { at: Date.now(), result };
  return result;
}

function useChairs() {
  const [chairs, setChairs] = useState<Chair[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadChairs().then((c) => {
      if (live) setChairs(c);
    });
    return () => {
      live = false;
    };
  }, []);
  return chairs;
}

const hrefFor = (c: Chair) => `/book?${new URLSearchParams({ barber: c.barberId, service: "cut", date: c.date ?? "", start: c.start ?? "" })}`;

/** The hero's two rows. Until they arrive, or if they never do, a plain link means this is never blank. */
export function NextFreeRows() {
  const chairs = useChairs();
  const open = chairs?.filter((c) => c.start) ?? [];
  return (
    <div className="chair-rows">
      {open.length === 0 ? (
        <Link className="when-btn" href="/book">
          See all times
        </Link>
      ) : (
        chairs!.map((c) =>
          c.start ? (
            <Link key={c.barberId} className="when-btn" href={hrefFor(c)}>
              <span>{c.name}</span>
              <span className="w">{c.when}</span>
            </Link>
          ) : (
            <div key={c.barberId} className="when-btn when-off">
              <span>{c.name}</span>
              <span className="w">Nothing free</span>
            </div>
          ),
        )
      )}
    </div>
  );
}

/** The small "Next free" text on a barber card. Says nothing rather than guessing. */
export function BarberNextFree({ barberId }: { barberId: string }) {
  const chairs = useChairs();
  const chair = chairs?.find((c) => c.barberId === barberId);
  return <>{chair ? ` Next free: ${chair.when}` : ""}</>;
}
