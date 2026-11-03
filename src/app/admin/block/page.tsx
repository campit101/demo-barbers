import type { Metadata } from "next";
import { requireAdmin } from "@/auth/session";
import { BlockForm } from "@/components/admin/block-form";
import { dateFromParam, defaultDateKey, nextOpenKey } from "@/components/admin/dates";
import { AdminShell } from "@/components/admin/shell";
import { londonParts } from "@/lib/time";

export const metadata: Metadata = { title: "Block time" };

export default async function BlockPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireAdmin();
  const params = await searchParams;
  const now = new Date();
  const asked = dateFromParam(params.date);
  const date = asked ? nextOpenKey(asked) : defaultDateKey(now);
  return (
    <AdminShell user={user} active="block">
      <div className="title-row">
        <div>
          <h1 className="ad-disp">Block time off</h1>
          <p>Customers cannot book a blocked time.</p>
        </div>
      </div>
      <BlockForm date={date} today={londonParts(now).dateKey} />
    </AdminShell>
  );
}
