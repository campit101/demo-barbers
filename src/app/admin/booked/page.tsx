import type { Metadata } from "next";
import { bookedView } from "@/admin/views";
import { requireAdmin } from "@/auth/session";
import { ScrollTable } from "@/components/admin/scroll-table";
import { AdminShell } from "@/components/admin/shell";
import { SHOP } from "@/config/shop";
import { getDb } from "@/db/client";

export const metadata: Metadata = { title: "What's booked" };

export default async function BookedPage() {
  const user = await requireAdmin();
  const view = await bookedView(getDb(), user.role, new Date());
  return (
    <AdminShell user={user} active="booked">
      <div className="title-row">
        <div>
          <h1 className="ad-disp">What&apos;s booked</h1>
          <p>
            {view.count} {view.count === 1 ? "booking" : "bookings"} in the next {SHOP.bookingWindowDays} days, {view.depositsHeld} in deposits held
          </p>
        </div>
      </div>
      {view.rows.length === 0 ? (
        <div className="ad-empty">
          <p>Nothing is booked yet.</p>
        </div>
      ) : (
        <ScrollTable label="All bookings">
          <table>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Time</th>
                <th scope="col">Customer</th>
                <th scope="col">Service</th>
                <th scope="col">Barber</th>
                <th scope="col" className="num">
                  Deposit
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.day}</td>
                  <td>{r.time}</td>
                  <td>{r.who}</td>
                  <td>{r.what}</td>
                  <td>{r.barber}</td>
                  <td className="num">{r.deposit}</td>
                  <td>{r.statusText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollTable>
      )}
    </AdminShell>
  );
}
