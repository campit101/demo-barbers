"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { blockAction, type AdminState } from "@/admin/actions";
import { BARBERS, SHOP } from "@/config/shop";
import { clock } from "@/lib/time";

const EMPTY: AdminState = {};

// Controlled fields, because React clears a form after its action runs and a refused block should keep what was typed.
export function BlockForm({ date: initialDate, today }: { date: string; today: string }) {
  const [state, action, pending] = useActionState(blockAction, EMPTY);
  const [barberId, setBarberId] = useState<string>(BARBERS[0].id);
  const [date, setDate] = useState(initialDate);
  const [from, setFrom] = useState("12:00");
  const [to, setTo] = useState("12:30");
  const min = clock(SHOP.openMinute);
  const max = clock(SHOP.closeMinute);
  const step = SHOP.slotStepMinutes * 60;
  return (
    <form action={action} className="rail form-rail">
      <label className="ad-fld">
        <span>Barber</span>
        <select name="barberId" value={barberId} onChange={(e) => setBarberId(e.target.value)}>
          {BARBERS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="ad-fld">
        <span>Date</span>
        <input type="date" name="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} required />
      </label>
      <label className="ad-fld">
        <span>From</span>
        <input type="time" name="from" min={min} max={max} step={step} value={from} onChange={(e) => setFrom(e.target.value)} required />
      </label>
      <label className="ad-fld">
        <span>To</span>
        <input type="time" name="to" min={min} max={max} step={step} value={to} onChange={(e) => setTo(e.target.value)} required />
      </label>
      {state.message ? (
        <p className="ad-err" role="alert">
          {state.message}
        </p>
      ) : null}
      <div className="ad-acts">
        <button type="submit" className="ad-btn" disabled={pending}>
          Block this time
        </button>
        <Link className="ad-btn2" href={date ? `/admin?date=${date}` : "/admin"}>
          Back to the day
        </Link>
      </div>
    </form>
  );
}
