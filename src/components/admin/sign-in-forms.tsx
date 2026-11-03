"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { demoSignInAction, signInAction, type SignInState } from "@/auth/actions";

const EMPTY: SignInState = {};

function Refusal({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p className="ad-err" role="alert">
      {text}
    </p>
  );
}

export function SignInForms() {
  const [demo, demoAction, demoPending] = useActionState(demoSignInAction, EMPTY);
  const [owner, ownerAction, ownerPending] = useActionState(signInAction, EMPTY);
  // Controlled, because React clears a form after its action runs and a refused sign-in should keep the email.
  const [email, setEmail] = useState("");
  // Past the limit both forms refuse in the same words. Say it once, by the form just used.
  const [last, setLast] = useState<"demo" | "owner">("demo");
  const same = Boolean(demo.message) && demo.message === owner.message;

  return (
    <>
      <form action={demoAction} onSubmit={() => setLast("demo")}>
        <div className="ad-acts">
          <button type="submit" className="ad-btn" disabled={demoPending}>
            Try the admin
          </button>
          <Link className="ad-btn2" href="/">
            Back to the shop
          </Link>
        </div>
        {same && last !== "demo" ? null : <Refusal text={demo.message} />}
      </form>
      <form action={ownerAction} onSubmit={() => setLast("owner")} className="owner">
        <h2>Shop owner</h2>
        <label className="ad-fld">
          <span>Email</span>
          <input type="email" name="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="ad-fld">
          <span>Password</span>
          <input type="password" name="password" autoComplete="current-password" required />
        </label>
        {same && last !== "owner" ? null : <Refusal text={owner.message} />}
        <button type="submit" className="ad-btn2" disabled={ownerPending}>
          Sign in
        </button>
      </form>
    </>
  );
}
