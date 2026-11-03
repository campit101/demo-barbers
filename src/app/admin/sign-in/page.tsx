import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/auth/session";
import { SignInForms } from "@/components/admin/sign-in-forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage() {
  if (await getAdminUser()) redirect("/admin");
  return (
    <main className="signin">
      <div className="signin-pic">
        <Image src="/photos/shop.jpg" alt="The busy shop on a sunny afternoon, with two barbers cutting and customers talking on a bench. AI-generated." fill sizes="(max-width: 840px) 100vw, 62vw" priority />
      </div>
      <div className="signin-form">
        <h1 className="ad-disp">The shop&apos;s diary</h1>
        <p>Sign in to see the day, mark customers in and refund deposits. This one is full of made-up bookings that reset by themselves.</p>
        <SignInForms />
      </div>
    </main>
  );
}
