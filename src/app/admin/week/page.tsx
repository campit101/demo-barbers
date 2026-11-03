import type { Metadata } from "next";
import Link from "next/link";
import { weekView } from "@/admin/views";
import { requireAdmin } from "@/auth/session";
import { dateFromParam } from "@/components/admin/dates";
import { ScrollTable } from "@/components/admin/scroll-table";
import { AdminShell } from "@/components/admin/shell";
import { getDb } from "@/db/client";
import { londonParts, shortDate } from "@/lib/time";

export const metadata: Metadata = { title: "Week" };

export default async function WeekPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAdmin();
  const params = await searchParams;
  const now = new Date();
  const today = londonParts(now).dateKey;
  const start = dateFromParam(params.date) ?? today;
  const view = await weekView(getDb(), start, user.role, now);

  return (
    <AdminShell user={user} active="week">
      <div className="title-row">
        <div>
          <h1 className="ad-disp">{start === today ? "This week" : `From ${shortDate(start)}`}</h1>
          <p>Tap a day to open it</p>
        </div>
        <div className="tools">
          <Link className="ad-btn2" href={`/admin/week?date=${view.prevKey}`} aria-label="Previous week">
            Previous
          </Link>
          <Link className="ad-btn2" href="/admin/week">
            Today
          </Link>
          <Link className="ad-btn2" href={`/admin/week?date=${view.nextKey}`} aria-label="Next week">
            Next
          </Link>
        </div>
      </div>
      <ScrollTable label="Bookings per barber per day">
        <table>
          <thead>
            <tr>
              <th scope="col">Barber</th>
              {view.days.map((d) => (
                <th key={d.dateKey} scope="col">
                  {d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={r.barberId}>
                <td className="who">{r.name}</td>
                {r.cells.map((c) => {
                  const isToday = view.days.find((d) => d.dateKey === c.dateKey)?.isToday;
                  return (
                    <td key={c.dateKey} className="cell">
                      {c.closed ? (
                        <span className="wk off">Closed</span>
                      ) : (
                        <Link className={isToday ? "wk today" : "wk"} href={`/admin?date=${c.dateKey}`} prefetch={false} aria-label={`${r.name}, ${shortDate(c.dateKey)}: ${c.count} booked`}>
                          {c.count} booked
                        </Link>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>
    </AdminShell>
  );
}
