"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { cancelBookingAction } from "@/booking/actions";

export function ManageActions(props: { token: string; rebookHref: string | null; canCancel: boolean; cancelLabel: string; confirmText: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, submit, busy] = useActionState(cancelBookingAction, {});

  return (
    <>
      {state.message && (
        <p className="err" role="alert">
          {state.message}
        </p>
      )}
      {confirming ? (
        <div className="empty" role="group" aria-label="Confirm cancelling">
          <p>{props.confirmText}</p>
          <form action={submit}>
            <input type="hidden" name="token" value={props.token} />
            <div className="acts">
              <button type="submit" className="btn" disabled={busy}>
                {busy ? "Cancelling" : "Yes, cancel it"}
              </button>
              <button type="button" className="btn2" disabled={busy} onClick={() => setConfirming(false)}>
                Keep my booking
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="acts">
          {props.rebookHref && (
            <Link className="btn2" href={props.rebookHref}>
              Rebook
            </Link>
          )}
          {props.canCancel && (
            <button type="button" className="btn" onClick={() => setConfirming(true)}>
              {props.cancelLabel}
            </button>
          )}
          <Link className="quiet" href="/">
            Back to the shop
          </Link>
        </div>
      )}
    </>
  );
}
