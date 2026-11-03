import Link from "next/link";
import { SHOP } from "@/config/shop";
import type { DayView, DiaryEntry } from "@/admin/views";
import { clock } from "@/lib/time";
import { PX_PER_MINUTE, entryClass, placeEntries, statusMark, type StatusMark } from "./diary-layout";

const HOURS = Array.from({ length: (SHOP.closeMinute - SHOP.openMinute) / 60 }, (_, i) => {
  const minute = SHOP.openMinute + i * 60;
  const line = Math.round(i * 60 * PX_PER_MINUTE);
  return { label: clock(minute), line };
});

/** A small shape for each status, so nobody has to tell them apart by colour. The words are in the link's name and the key. */
function Mark({ mark, className }: { mark: StatusMark; className?: string }) {
  const paths: Record<StatusMark, string> = {
    completed: "M2 6.5 5 9.5 10 3",
    noshow: "M3 3 9 9M9 3 3 9",
    refund: "M4.5 1.5 2 4l2.5 2.5M2 4h5.5a2.5 2.5 0 0 1 0 5H4",
    paying: "M3 1.5h6M3 10.5h6M3.5 1.5c0 3 5 4.5 5 9M8.5 1.5c0 3-5 4.5-5 9",
  };
  return (
    <svg className={className} viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[mark]} />
    </svg>
  );
}

function EntryLink({ entry, date, selected, style }: { entry: DiaryEntry; date: string; selected: boolean; style: React.CSSProperties }) {
  const mark = statusMark(entry);
  return (
    <Link
      id={`bk-${entry.id}`}
      href={`/admin?date=${date}&b=${entry.id}`}
      scroll={false}
      prefetch={false}
      className={entryClass(entry, selected)}
      style={style}
      aria-current={selected ? "true" : undefined}
    >
      <b>{clock(entry.startMinute)}</b> {mark ? <Mark mark={mark} className="mark" /> : null}
      {entry.who}
      <br />
      {entry.what}
      <span className="vh">
        , {entry.barber}
        {entry.kind === "booking" ? `, ${entry.statusText}` : ""}
      </span>
    </Link>
  );
}

function DiaryKey() {
  return (
    <ul className="key" aria-label="What the diary shows">
      <li>
        <span className="swatch" />
        Booked
      </li>
      <li>
        <span className="swatch">
          <Mark mark="paying" />
        </span>
        Paying now
      </li>
      <li>
        <span className="swatch completed">
          <Mark mark="completed" />
        </span>
        Completed
      </li>
      <li>
        <span className="swatch noshow">
          <Mark mark="noshow" />
        </span>
        No-show
      </li>
      <li>
        <span className="swatch completed">
          <Mark mark="refund" />
        </span>
        Refunded
      </li>
      <li>
        <span className="swatch block" />
        Blocked
      </li>
    </ul>
  );
}

export function Diary({ view, selectedId }: { view: DayView; selectedId: string | null }) {
  return (
    <div className="diary-wrap">
      <div id="diary" className="diary" tabIndex={0} role="region" aria-label={`Diary for ${view.title}`}>
        <div className="diary-in">
          <div className="colhead" />
          {view.columns.map((c) => (
            <h2 key={c.barberId} id={`col-${c.barberId}`} className="colhead">
              {c.name}
            </h2>
          ))}
          <div className="ad-hours" aria-hidden="true">
            {HOURS.map((h) => (
              <span key={h.label} style={{ top: h.line + 2 }}>
                {h.label}
              </span>
            ))}
          </div>
          {view.columns.map((c) => (
            <div key={c.barberId} className="col" role="group" aria-labelledby={`col-${c.barberId}`}>
              {HOURS.map((h) => (
                <i key={h.label} className="hl" style={{ top: h.line }} />
              ))}
              {placeEntries(c.entries).map((p) => {
                const sideBySide: React.CSSProperties =
                  p.lanes > 1 ? { left: `calc(${(p.lane / p.lanes) * 100}% + 2px)`, right: "auto", width: `calc(${100 / p.lanes}% - 4px)` } : {};
                return <EntryLink key={p.entry.id} entry={p.entry} date={view.dateKey} selected={p.entry.id === selectedId} style={{ top: p.top, height: p.height, ...sideBySide }} />;
              })}
            </div>
          ))}
        </div>
      </div>
      <DiaryKey />
    </div>
  );
}
