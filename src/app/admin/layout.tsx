import type { Metadata } from "next";
import "./admin.css";

export const metadata: Metadata = { title: { absolute: "The shop's diary | Demo Barbers", template: "%s | The shop's diary | Demo Barbers" }, robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="ad">{children}</div>;
}
