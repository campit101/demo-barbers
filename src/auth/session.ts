// Who is signed in to the admin, for server components and actions.
import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./server";

export interface AdminUser {
  id: string;
  name: string;
  role: "owner" | "demo";
}

export async function getAdminUser(): Promise<AdminUser | null> {
  // Headers first: reading them marks the page as per-request, so builds without secrets never prerender it.
  const h = await headers();
  const session = await getAuth().api.getSession({ headers: h });
  if (!session) return null;
  const u = session.user as typeof session.user & { role?: string };
  return { id: u.id, name: u.name, role: u.role === "owner" ? "owner" : "demo" };
}

/** For admin pages and actions: anyone not signed in goes to the sign-in page. */
export async function requireAdmin(): Promise<AdminUser> {
  const user = await getAdminUser();
  if (!user) redirect("/admin/sign-in");
  return user;
}
