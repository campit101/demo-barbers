"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { rebookAction, type ManageState } from "@/booking/actions";
import { BARBERS, barberById } from "@/config/shop";
import { formatWhen } from "@/lib/time";
import { TimePicker } from "./TimePicker";

export function RebookFlow(props: { token: string; serviceId: string; serviceName: string; minutes: number; barberId: string; currentWhen: string }) {
  const [barberId, setBarberId] = useState(props.barberId);
  const [date, setDate] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | undefined>();
  const [reviewing, setReviewing] = useState(false);
  const [now] = useState(() => new Date());
  const backHref = `/manage/${encodeURIComponent(props.token)}`;
  const barberName = barberById(barberId)?.name ?? "";

  const [, submit, busy] = useActionState(async (prev: ManageState, form: FormData): Promise<ManageState> => {
    const result = await rebookAction(prev, form);
    setNotice(result.message);
    if (result.slotGone) {
      setStart(null);
      setReviewing(false);
    }
    return result;
  }, {});

  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [reviewing]);

  if (reviewing && start) {
    return (
      <div key="review">
        <h1 className="disp book-h" ref={heading} tabIndex={-1}>
          Move your booking
        </h1>
        {notice && (
          <p className="err" role="alert">
            {notice}
          </p>
        )}
        <dl className="sum">
          <dt>Service</dt>
          <dd>{props.serviceName}</dd>
          <dt>From</dt>
          <dd>{props.currentWhen}</dd>
          <dt>To</dt>
          <dd>{formatWhen(new Date(start), now)}</dd>
          <dt>Barber</dt>
          <dd>{barberName}</dd>
        </dl>
        <p className="para">Your deposit moves with you, so there is nothing more to pay today.</p>
        <form action={submit}>
          <input type="hidden" name="token" value={props.token} />
          <input type="hidden" name="barberId" value={barberId} />
          <input type="hidden" name="start" value={start} />
          <div className="acts">
            <button type="submit" className="btn" disabled={busy}>
              {busy ? "Moving your booking" : "Move my booking"}
            </button>
            <button type="button" className="quiet" disabled={busy} onClick={() => setReviewing(false)}>
              Back
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div key="pick">
      <h1 className="disp book-h" ref={heading} tabIndex={-1}>
        Pick a new time
      </h1>
      <p className="para">
        {props.serviceName}, currently {props.currentWhen}.
      </p>
      {notice && (
        <p className="notice" role="alert">
          {notice}
        </p>
      )}
      <div className="days" role="group" aria-label="Choose a barber">
        {BARBERS.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`day${b.id === barberId ? " sel" : ""}`}
            aria-pressed={b.id === barberId}
            onClick={() => {
              setBarberId(b.id);
              setStart(null);
              setNotice(undefined);
            }}
          >
            {b.name}
          </button>
        ))}
      </div>
      <TimePicker
        barberId={barberId}
        barberName={barberName}
        serviceId={props.serviceId}
        minutes={props.minutes}
        date={date}
        start={start}
        onDay={(d) => {
          setDate(d);
          setStart(null);
          setNotice(undefined);
        }}
        onSlot={(s) => {
          setStart(s);
          setNotice(undefined);
          setReviewing(true);
        }}
      />
      <div className="acts">
        <Link className="quiet" href={backHref}>
          Back
        </Link>
      </div>
    </div>
  );
}
