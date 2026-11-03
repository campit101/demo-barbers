"use client";

import { useEffect, useRef, useState } from "react";
import { bookingDays, isClosedDateKey } from "@/booking/slots";
import { friendlyDate, shortDate } from "@/lib/time";

export interface Slot {
  start: string;
  label: string;
}

type Times = { status: "loading" } | { status: "error" } | { status: "ready"; slots: Slot[] };

export async function fetchSlots(barberId: string, serviceId: string, date: string, signal?: AbortSignal): Promise<Slot[]> {
  const q = new URLSearchParams({ barber: barberId, service: serviceId, date });
  const r = await fetch(`/api/availability?${q}`, { cache: "no-store", signal });
  if (!r.ok) throw new Error(`availability ${r.status}`);
  return ((await r.json()) as { slots: Slot[] }).slots;
}

function useTimes(barberId: string, serviceId: string, date: string | null): { times: Times; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const key = `${barberId}|${serviceId}|${date}|${attempt}`;
  const [result, setResult] = useState<{ key: string; times: Times } | null>(null);

  useEffect(() => {
    if (!date) return;
    const ac = new AbortController();
    let cleanedUp = false;
    const timer = setTimeout(() => ac.abort(), 10_000);
    fetchSlots(barberId, serviceId, date, ac.signal)
      .then((slots) => setResult({ key, times: { status: "ready", slots } }))
      .catch(() => {
        if (!cleanedUp) setResult({ key, times: { status: "error" } });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      cleanedUp = true;
      clearTimeout(timer);
      ac.abort();
    };
  }, [key, barberId, serviceId, date]);

  return { times: result?.key === key ? result.times : { status: "loading" }, retry: () => setAttempt((a) => a + 1) };
}

/** What a screen reader hears when a day is picked. The region is always there, because one that appears with its words may go unread. */
function statusWords(date: string | null, times: Times, now: Date): string {
  if (!date) return "";
  const day = friendlyDate(date, now);
  if (times.status === "loading") return `Finding open times for ${day}.`;
  if (times.status === "error") return "";
  const n = times.slots.length;
  if (n === 0) return `No open times found for ${day}.`;
  return `${n} open ${n === 1 ? "time" : "times"} found for ${day}.`;
}

export function TimePicker(props: { barberId: string; barberName: string; serviceId: string; minutes: number; date: string | null; start: string | null; onDay: (date: string) => void; onSlot: (start: string) => void }) {
  const { date, start } = props;
  const [now] = useState(() => new Date());
  const days = bookingDays(now);
  const { times, retry } = useTimes(props.barberId, props.serviceId, date);
  const nextOpen = date ? days.find((d) => d > date && !isClosedDateKey(d)) : undefined;

  // A date that came with the link may be off the right of the scrolling row: bring it into view without moving the page.
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = row.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (row.current && on) row.current.scrollLeft = on.offsetLeft - row.current.offsetLeft - 3;
  }, [date]);

  // "Try again" and "Try the next open day" vanish when pressed. Focus waits on the panel, then moves to the first thing to press in the result.
  const panel = useRef<HTMLDivElement>(null);
  const placeFocus = useRef(false);
  const holdFocus = () => {
    placeFocus.current = true;
    panel.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!placeFocus.current || times.status === "loading") return;
    placeFocus.current = false;
    panel.current?.querySelector("button")?.focus({ preventScroll: true });
  }, [times.status, date]);

  return (
    <>
      <div className="days" role="group" aria-label="Choose a day" ref={row}>
        {days.map((d, i) => {
          const closed = isClosedDateKey(d);
          const parts = shortDate(d).split(" ");
          const label = i < 2 ? friendlyDate(d, now) : parts[0];
          return (
            <button key={d} type="button" className={`day${d === date ? " sel" : ""}`} disabled={closed} aria-pressed={d === date} onClick={() => props.onDay(d)}>
              {label}
              <br />
              {closed ? "Closed" : `${parts[1]} ${parts[2]}`}
            </button>
          );
        })}
      </div>

      <p className="sr" role="status" aria-live="polite">
        {statusWords(date, times, now)}
      </p>

      <div className="times-panel" ref={panel} tabIndex={-1}>
        {!date && (
          <div className="empty">
            <p>Pick a day to see {props.barberName}&apos;s open times.</p>
          </div>
        )}
        {date && times.status === "loading" && (
          <div className="empty">
            <p>Finding open times for {friendlyDate(date, now)}.</p>
          </div>
        )}
        {date && times.status === "error" && (
          <div className="empty" role="alert">
            <p>We could not load the times just now. Nothing has been booked.</p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                holdFocus();
                retry();
              }}
            >
              Try again
            </button>
          </div>
        )}
        {date && times.status === "ready" && times.slots.length === 0 && (
          <div className="empty">
            <p>
              {props.barberName} has nothing left that day for a {props.minutes} minute booking. Times that would run past 18:00 are never offered.
            </p>
            {nextOpen ? (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  holdFocus();
                  props.onDay(nextOpen);
                }}
              >
                Try the next open day
              </button>
            ) : (
              <p>That is the last day you can book in the next 14 days.</p>
            )}
          </div>
        )}
        {date && times.status === "ready" && times.slots.length > 0 && (
          <div className="slots" role="group" aria-label="Choose a time">
            {times.slots.map((s) => (
              <button key={s.start} type="button" className={`slot${s.start === start ? " sel" : ""}`} aria-pressed={s.start === start} onClick={() => props.onSlot(s.start)}>
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
