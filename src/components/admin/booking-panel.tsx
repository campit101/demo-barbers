"use client";

import { useActionState, useEffect, useRef } from "react";
import { bookingFormAction, removeBlockFormAction } from "@/app/admin/actions";
import type { AdminState } from "@/admin/actions";

const EMPTY: AdminState = {};

/** Puts a result message in front of the reader: on a phone the panel can be far below the diary, and the button pressed may have gone. */
function reveal(message: HTMLElement | null) {
  if (!message) return;
  message.focus({ preventScroll: true });
  message.closest(".rail")?.scrollIntoView({ block: "nearest" });
  message.scrollIntoView({ block: "nearest" });
}

/** The panel beside (or, on smaller screens, under) the diary. Brings itself into view when something is picked. */
export function Rail({ reveal: show, label, children }: { reveal: boolean; label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!show || !ref.current) return;
    ref.current.focus({ preventScroll: true });
    ref.current.scrollIntoView({ block: "nearest" });
  }, [show]);
  return (
    <div ref={ref} className="rail" tabIndex={-1} role="region" aria-label={label}>
      {children}
    </div>
  );
}

/**
 * A result that travelled in the address, after a redirect. Shown once: it takes itself out of the address, so a reload cannot repeat it.
 * The second reveal is for the browser's own scroll to the top after a redirect, should it land after this effect.
 */
export function DoneNotice({ text, dropSelection }: { text: string; dropSelection: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("done");
    if (dropSelection) url.searchParams.delete("b");
    window.history.replaceState(null, "", url);
    reveal(ref.current);
    const frame = requestAnimationFrame(() => reveal(ref.current));
    return () => cancelAnimationFrame(frame);
  }, [dropSelection]);
  return (
    <p ref={ref} className="msg first" role="status" tabIndex={-1}>
      {text}
    </p>
  );
}

function Message({ state }: { state: AdminState }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.message) reveal(ref.current);
  }, [state]);
  if (!state.message) return null;
  return state.ok ? (
    <p ref={ref} className="msg" role="status" tabIndex={-1}>
      {state.message}
    </p>
  ) : (
    <p ref={ref} className="msg ad-err" role="alert" tabIndex={-1}>
      {state.message}
    </p>
  );
}

export function BookingActions({ id, date, canMark, canRefund }: { id: string; date: string; canMark: boolean; canRefund: boolean }) {
  const [state, action, pending] = useActionState(bookingFormAction, EMPTY);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="date" value={date} />
      <div className="ad-acts">
        <button type="submit" name="action" value="completed" className="ad-btn" disabled={!canMark || pending}>
          Completed
        </button>
        <button type="submit" name="action" value="no_show" className="ad-btn2" disabled={!canMark || pending}>
          No-show
        </button>
        <button type="submit" name="action" value="refund" className="ad-btn2" disabled={!canRefund || pending}>
          Refund deposit
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}

export function RemoveBlock({ id, date }: { id: string; date: string }) {
  const [state, action, pending] = useActionState(removeBlockFormAction, EMPTY);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="date" value={date} />
      <div className="ad-acts">
        <button type="submit" className="ad-btn" disabled={pending}>
          Remove block
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}
