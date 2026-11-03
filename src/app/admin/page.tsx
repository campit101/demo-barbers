import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { dayView, type DiaryEntry } from "@/admin/views";
import { requireAdmin } from "@/auth/session";
import { getBooking } from "@/booking/service";
import { BookingActions, DoneNotice, RemoveBlock, Rail } from "@/components/admin/booking-panel";
import { dateFromParam, defaultDateKey, nextOpenKey } from "@/components/admin/dates";
import { Diary } from "@/components/admin/diary";
import { AdminShell } from "@/components/admin/shell";
import { SHOP } from "@/config/shop";
import { getDb } from "@/db/client";
import { clock, londonParts, shortDate } from "@/lib/time";

// In full, because a layout's title template only reaches the folders below it, not a page beside it.
export const metadata: Metadata = { title: { absolute: "Day | The shop's diary | Demo Barbers" } };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the address says just happened, but only if the row named in it bears that out. Anyone can type `done=refund`. */
async function honestDone(raw: unknown, bookingId: unknown, role: "owner" | "demo"): Promise<string | null> {
  if (typeof bookingId !== "string" || !ID.test(bookingId)) return null;
  const row = await getBooking(getDb(), bookingId);
  if (raw === "removed") return row ? null : "Block removed.";
  if (!row || row.kind !== "booking" || (role === "demo" && !row.isSeed)) return null;
  if (raw === "refund" && (row.depositStatus === "refund_pending" || row.depositStatus === "refunded")) return "Refund sent to the customer.";
  if (raw === "refund-later" && row.depositStatus === "refund_pending") return "Stripe did not respond. The refund will be retried automatically.";
  return null;
}

function SelectedBooking({ entry, date, done }: { entry: DiaryEntry; date: string; done: string | null }) {
  return (
    <>
      <h2>{entry.who}</h2>
      <p className="pill-row">
        <span className="pill">{entry.statusText}</span>
      </p>
      <dl className="kv">
        <dt>Service</dt>
        <dd>{entry.what}</dd>
        <dt>Barber</dt>
        <dd>{entry.barber}</dd>
        <dt>Time</dt>
        <dd>{entry.span}</dd>
        <dt>Price</dt>
        <dd>{entry.price}</dd>
        <dt>Deposit</dt>
        <dd>{entry.deposit}</dd>
      </dl>
      {done ? <DoneNotice text={done} dropSelection={false} /> : null}
      <BookingActions key={`${entry.id}-${done ?? ""}`} id={entry.id} date={date} canMark={entry.canMark} canRefund={entry.canRefund} />
      {entry.canAct ? <p className="ad-note">Refunds run in Stripe&apos;s test mode, so no real money moves.</p> : <p className="ad-note">Belongs to a visitor. The demo login can only change the made-up bookings.</p>}
    </>
  );
}

function SelectedBlock({ entry, date }: { entry: DiaryEntry; date: string }) {
  return (
    <>
      <h2>Blocked</h2>
      <dl className="kv">
        <dt>Barber</dt>
        <dd>{entry.barber}</dd>
        <dt>Time</dt>
        <dd>{entry.span}</dd>
      </dl>
      <RemoveBlock key={entry.id} id={entry.id} date={date} />
      <p className="ad-note">Customers cannot book this time until the block is removed.</p>
    </>
  );
}

export default async function DayPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAdmin();
  const params = await searchParams;
  const now = new Date();
  const date = dateFromParam(params.date) ?? defaultDateKey(now);
  const view = await dayView(getDb(), date, user.role, now);
  const today = londonParts(now).dateKey;
  const selected = view.columns.flatMap((c) => c.entries).find((e) => e.id === params.b) ?? null;
  const done = params.done ? await honestDone(params.done, params.b, user.role) : null;
  if (params.done && !done) {
    const clean = new URLSearchParams();
    if (typeof params.date === "string") clean.set("date", date);
    if (selected) clean.set("b", selected.id);
    redirect(clean.size ? `/admin?${clean}` : "/admin");
  }
  // /admin opens on the next open day when today is shut, so say so rather than let it pass for today.
  const landedPastToday = !params.date && date !== today;
  const nextOpen = view.closed ? nextOpenKey(view.dateKey) : null;

  return (
    <AdminShell user={user} active="day" skip={view.closed ? undefined : { href: "#diary", label: "Skip to the diary" }}>
      <div className="title-row">
        <div>
          <h1 className="ad-disp">{view.title}</h1>
          <p>{view.closed ? (view.isToday ? "Closed today" : "Closed") : landedPastToday ? `The shop is closed today, so this is the next open day. Open ${clock(SHOP.openMinute)} to ${clock(SHOP.closeMinute)}` : `Open ${clock(SHOP.openMinute)} to ${clock(SHOP.closeMinute)}`}</p>
        </div>
        <div className="tools">
          <Link className="ad-btn2" href={`/admin?date=${view.prevKey}`} aria-label="Previous day">
            Previous
          </Link>
          <Link className="ad-btn2" href={`/admin?date=${today}`} aria-current={view.isToday ? "date" : undefined}>
            Today
          </Link>
          <Link className="ad-btn2" href={`/admin?date=${view.nextKey}`} aria-label="Next day">
            Next
          </Link>
          <Link className="ad-btn" href={`/admin/block?date=${view.dateKey}`}>
            Block time
          </Link>
        </div>
      </div>
      {view.closed ? (
        <div className="ad-empty">
          <p>The shop is closed on Sunday and Monday, so there is nothing to show.</p>
          {nextOpen ? (
            <div className="ad-acts">
              <Link className="ad-btn2" href={`/admin?date=${nextOpen}`}>
                Next open day, {shortDate(nextOpen)}
              </Link>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="count">
            <div>
              <b>{view.count}</b>
              <span>{view.count === 1 ? "booking" : "bookings"}</span>
            </div>
            <div>
              <b>{view.depositsHeld}</b>
              <span>deposits held</span>
            </div>
            <div>
              <b>{view.stillToPay}</b>
              <span>still to pay in the shop</span>
            </div>
          </div>
          <div className="work">
            <Diary view={view} selectedId={selected?.id ?? null} />
            <Rail key={selected?.id ?? done ?? "none"} reveal={Boolean(selected) && !done} label={selected ? `Selected: ${selected.who}` : "Selected booking"}>
              {selected?.kind === "booking" ? (
                <SelectedBooking entry={selected} date={view.dateKey} done={done} />
              ) : selected ? (
                <SelectedBlock entry={selected} date={view.dateKey} />
              ) : (
                <>
                  {done ? <DoneNotice text={done} dropSelection /> : null}
                  <h2>Nothing selected</h2>
                  <p>Tap a booking to mark it completed or no-show, or to refund the deposit.</p>
                </>
              )}
              {selected ? (
                <a className="ad-btn2 back" href={`#bk-${selected.id}`}>
                  Back to the diary
                </a>
              ) : null}
            </Rail>
          </div>
        </>
      )}
    </AdminShell>
  );
}
