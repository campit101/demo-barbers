"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { startBookingAction, type BookState } from "@/booking/actions";
import { bookingDays, isClosedDateKey } from "@/booking/slots";
import { readCustomer, readStart, type CustomerErrors } from "@/booking/validate";
import { BARBERS, SERVICES, barberById, depositFor, serviceById } from "@/config/shop";
import { formatMoney, formatPrice, formatWhen, londonParts } from "@/lib/time";
import { readDraft, saveDraft } from "./draft";
import { Photo, SHOP_ALT } from "./Photo";
import { TimePicker, fetchSlots } from "./TimePicker";

const STEPS = [
  { id: "service", label: "Service" },
  { id: "barber", label: "Barber" },
  { id: "time", label: "Time" },
  { id: "details", label: "Details" },
  { id: "review", label: "Review" },
] as const;
type Step = (typeof STEPS)[number]["id"];

const indexOf = (step: string) => STEPS.findIndex((s) => s.id === step);

interface Choices {
  service: string | null;
  barber: string | null;
  date: string | null;
  start: string | null;
}

/** The address bar holds the choices, so the phone's Back button walks the steps. Names and emails never go in it. */
function readChoices(q: URLSearchParams, now: Date): Choices {
  const service = serviceById(q.get("service") ?? "")?.id ?? null;
  const barber = barberById(q.get("barber") ?? "")?.id ?? null;
  const days = bookingDays(now);
  const usable = (d: string | null) => (d && days.includes(d) && !isClosedDateKey(d) ? d : null);
  const at = readStart(q.get("start"));
  const startOk = at && at.getTime() > now.getTime() && usable(londonParts(at).dateKey);
  return {
    service,
    barber,
    date: startOk ? londonParts(at).dateKey : usable(q.get("date")),
    start: startOk ? q.get("start") : null,
  };
}

function firstMissing(c: Choices): Step {
  if (!c.service) return "service";
  if (!c.barber) return "barber";
  if (!c.start) return "time";
  return "details";
}

function urlFor(step: Step, c: Choices) {
  const q = new URLSearchParams({ step });
  if (c.service) q.set("service", c.service);
  if (c.barber) q.set("barber", c.barber);
  if (c.date) q.set("date", c.date);
  if (c.start) q.set("start", c.start);
  return `/book?${q}`;
}

/** The soonest time for this service with each barber, by walking the open days until one has a slot. */
function useFirstFree(serviceId: string | null, now: Date) {
  const [found, setFound] = useState<{ service: string; when: Record<string, string | null | false> } | null>(null);
  useEffect(() => {
    if (!serviceId) return;
    const ac = new AbortController();
    const days = bookingDays(now).filter((d) => !isClosedDateKey(d));
    const walk = async (barberId: string): Promise<string | null | false> => {
      try {
        for (const d of days) {
          const slots = await fetchSlots(barberId, serviceId, d, ac.signal);
          if (slots[0]) return formatWhen(new Date(slots[0].start), now);
        }
        return null;
      } catch {
        return false;
      }
    };
    void Promise.all(BARBERS.map(async (b) => [b.id, await walk(b.id)] as const)).then((rows) => {
      if (!ac.signal.aborted) setFound({ service: serviceId, when: Object.fromEntries(rows) });
    });
    return () => ac.abort();
  }, [serviceId, now]);
  return found?.service === serviceId ? found.when : null;
}

const TIME_GONE = "That time is not available. Please pick another.";

export function BookFlow() {
  const params = useSearchParams();
  const [now] = useState(() => new Date());
  const choices = readChoices(new URLSearchParams(params), now);
  const service = choices.service ? serviceById(choices.service) : undefined;
  const barber = choices.barber ? barberById(choices.barber) : undefined;

  // Coming back from Stripe with the browser's Back button loads this page afresh: bring back what was typed, and only that.
  const [draft] = useState(readDraft);
  const [name, setName] = useState(draft?.name ?? "");
  const [email, setEmail] = useState(draft?.email ?? "");
  const [fieldErrors, setFieldErrors] = useState<CustomerErrors | undefined>();
  // A start in the address that the rules already refuse has no check to wait for: say so straight away.
  const [refused] = useState(() => (service && barber && params.get("start") && !choices.start ? choices : null));
  const [notice, setNotice] = useState<string | undefined>(refused ? TIME_GONE : undefined);
  useEffect(() => {
    if (refused) window.history.replaceState(null, "", urlFor("time", refused));
  }, [refused]);
  // Set by Continue, so a reloaded review address cannot jump ahead while someone is still typing their email.
  const [detailsDone, setDetailsDone] = useState(false);

  // A start that arrived in the address may be off the grid, or taken. Ask before showing the details step, not only at Pay.
  // The exception is the time this visitor pressed Pay for: their own hold takes it off sale, and it can be retaken.
  const [preset] = useState(() => (service && barber && choices.start && choices.date && !(draft?.start === choices.start && draft.barber === barber.id) ? { ...choices, service: service.id, barber: barber.id, start: choices.start, date: choices.date } : null));
  const [verifying, setVerifying] = useState(preset !== null);
  useEffect(() => {
    if (!preset) return;
    const ac = new AbortController();
    let cleanedUp = false;
    const timer = setTimeout(() => ac.abort(), 10_000);
    const want = new Date(preset.start).getTime();
    fetchSlots(preset.barber, preset.service, preset.date, ac.signal)
      .then((slots) => {
        if (slots.some((s) => new Date(s.start).getTime() === want)) return;
        window.history.replaceState(null, "", urlFor("time", { ...preset, start: null }));
        setNotice(TIME_GONE);
      })
      // Could not ask: carry on, because Pay checks again anyway.
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        if (!cleanedUp) setVerifying(false);
      });
    return () => {
      cleanedUp = true;
      clearTimeout(timer);
      ac.abort();
    };
  }, [preset]);

  const asked = params.get("step");
  const limit = firstMissing(choices);
  let step: Step = asked && indexOf(asked) >= 0 && indexOf(asked) <= indexOf(limit) ? (asked as Step) : limit;
  if (asked === "review" && limit === "details") step = detailsDone && readCustomer(name, email).ok ? "review" : "details";
  const at = indexOf(step);

  const go = (next: Step, change: Partial<Choices> = {}, opts: { replace?: boolean } = {}) => {
    setNotice(undefined);
    setFieldErrors(undefined);
    const url = urlFor(next, { ...choices, ...change });
    if (opts.replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
  };

  const [, submit, paying] = useActionState(async (prev: BookState, form: FormData): Promise<BookState> => {
    const result = await startBookingAction(prev, form);
    if (result.errors) {
      go("details");
      setFieldErrors(result.errors);
    } else if (result.slotGone) {
      go("time", { start: null });
      setNotice(result.message);
    } else {
      setNotice(result.message);
    }
    return result;
  }, {});

  // New step: bring the reader to its heading, so keyboards and screen readers are not left on a button that has gone.
  const heading = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, [step]);

  // Coming back from Stripe with the browser's Back button can restore a frozen page still saying "Opening Stripe".
  useEffect(() => {
    const revive = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", revive);
    return () => window.removeEventListener("pageshow", revive);
  }, []);

  const firstFree = useFirstFree(step === "barber" ? choices.service : null, now);

  const showBarber = barber && step !== "barber" && step !== "service";
  const when = choices.start ? formatWhen(new Date(choices.start), now) : "";
  const deposit = service ? depositFor(service.pricePence) : 0;
  const cameFromCancel = params.get("notice") === "cancelled";

  const continueToReview = (e: React.FormEvent) => {
    e.preventDefault();
    const check = readCustomer(name, email);
    if (check.ok) {
      setDetailsDone(true);
      go("review");
      return;
    }
    setFieldErrors(check.errors);
    document.getElementById(check.errors.name ? "f-name" : "f-email")?.focus();
  };

  return (
    <div className="book">
      <div className="book-side">
        {showBarber ? <Photo key={barber.id} src={barber.photo} alt={barber.alt} sizes="(max-width: 1023px) 100vw, 60vw" /> : <Photo className="shop-crop" src="/photos/shop.jpg" alt={SHOP_ALT} sizes="100vw" />}
      </div>
      <div className="book-main" key={step}>
        <nav className="steps" aria-label="Booking steps">
          {STEPS.map((s, i) => (
            <button key={s.id} type="button" className={i === at ? "now" : ""} disabled={i > at} aria-current={i === at ? "step" : undefined} onClick={() => i < at && go(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>

        {cameFromCancel && step === "service" && (
          <p className="notice" role="status">
            You left the payment page, so nothing was charged.
          </p>
        )}

        {step === "service" && (
          <>
            <h1 className="disp book-h" ref={heading} tabIndex={-1}>
              What are you having?
            </h1>
            <div className="stagger">
              {SERVICES.map((s) => (
                <button key={s.id} type="button" className={`opt${s.id === choices.service ? " sel" : ""}`} onClick={() => go(choices.barber ? "time" : "barber", { service: s.id, start: null })}>
                  <span className="opt-thumb">
                    <Photo src={s.photo} alt="" sizes="64px" />
                  </span>
                  <span>
                    <b>{s.name}</b>
                    {s.minutes} minutes
                  </span>
                  <span className="p">{formatPrice(s.pricePence)}</span>
                </button>
              ))}
            </div>
            <div className="acts">
              <Link className="quiet" href="/">
                Back to the shop
              </Link>
            </div>
          </>
        )}

        {step === "barber" && (
          <>
            <h1 className="disp book-h" ref={heading} tabIndex={-1}>
              Who&apos;s cutting?
            </h1>
            <div className="bar-grid stagger">
              {BARBERS.map((b) => {
                const free = firstFree?.[b.id];
                return (
                  <button key={b.id} type="button" className={`bar${b.id === choices.barber ? " sel" : ""}`} onClick={() => go("time", { barber: b.id, start: null })}>
                    <span className="bar-img">
                      <Photo src={b.photo} alt="" sizes="(max-width: 720px) 45vw, 25vw" />
                    </span>
                    <span className="bar-txt">
                      <b>{b.name}</b>
                      {firstFree === null ? "Checking next free time" : free ? `Next free: ${free}` : free === null ? "Nothing free in the next 14 days" : "See open times on the next step"}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="acts">
              <button type="button" className="quiet" onClick={() => go("service")}>
                Back
              </button>
            </div>
          </>
        )}

        {step === "time" && service && barber && (
          <>
            <h1 className="disp book-h" ref={heading} tabIndex={-1}>
              When suits?
            </h1>
            {notice && (
              <p className="notice" role="alert">
                {notice}
              </p>
            )}
            <TimePicker
              barberId={barber.id}
              barberName={barber.name}
              serviceId={service.id}
              minutes={service.minutes}
              date={choices.date}
              start={choices.start}
              onDay={(d) => go("time", { date: d, start: null }, { replace: true })}
              onSlot={(s) => go("details", { start: s })}
            />
            <div className="acts">
              <button type="button" className="quiet" onClick={() => go("barber")}>
                Back
              </button>
            </div>
          </>
        )}

        {step === "details" && service && barber && (
          <>
            <h1 className="disp book-h" ref={heading} tabIndex={-1}>
              Your details
            </h1>
            {verifying ? (
              <p className="para" role="status">
                Checking that time is free.
              </p>
            ) : (
              <>
            <p style={{ marginBottom: 18 }}>
              {service.name} with {barber.name}, {when}.{" "}
              <button type="button" className="quiet" onClick={() => go("time", { start: null })}>
                Change
              </button>
            </p>
            <form noValidate onSubmit={continueToReview}>
              <div className="fld">
                <label htmlFor="f-name">Name</label>
                <input id="f-name" type="text" name="name" autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!fieldErrors?.name} aria-describedby={fieldErrors?.name ? "f-name-err" : undefined} />
                {fieldErrors?.name && (
                  <p className="err" id="f-name-err" role="alert">
                    {fieldErrors.name}
                  </p>
                )}
              </div>
              <div className="fld">
                <label htmlFor="f-email">Email, shown to the shop. This demo never sends email</label>
                <input id="f-email" type="email" name="email" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!fieldErrors?.email} aria-describedby={fieldErrors?.email ? "f-email-err" : undefined} />
                {fieldErrors?.email && (
                  <p className="err" id="f-email-err" role="alert">
                    {fieldErrors.email}
                  </p>
                )}
              </div>
              <div className="acts">
                <button type="submit" className="btn">
                  Continue to review
                </button>
                <button type="button" className="quiet" onClick={() => go("time", { start: null })}>
                  Back
                </button>
              </div>
            </form>
              </>
            )}
          </>
        )}

        {step === "review" && service && barber && choices.start && (
          <>
            <h1 className="disp book-h" ref={heading} tabIndex={-1}>
              Hold your chair
            </h1>
            <p className="hold">We hold this time for 10 minutes while you pay. Stripe takes the 20% deposit on its secure page.</p>
            {notice && (
              <p className="err" role="alert">
                {notice}
              </p>
            )}
            <dl className="sum">
              <dt>Service</dt>
              <dd>{service.name}</dd>
              <dt>Barber</dt>
              <dd>{barber.name}</dd>
              <dt>When</dt>
              <dd>{when}</dd>
              <dt>Name</dt>
              <dd>{name.trim()}</dd>
              <dt>Email</dt>
              <dd>{email.trim()}</dd>
              <dt>Price</dt>
              <dd>{formatMoney(service.pricePence)}</dd>
              <dt>Pay in the shop</dt>
              <dd>{formatMoney(service.pricePence - deposit)}</dd>
              <dt>Deposit today</dt>
              <dd className="big">{formatMoney(deposit)}</dd>
            </dl>
            <form action={submit} onSubmit={() => saveDraft({ name, email, start: choices.start ?? "", barber: barber.id })}>
              <input type="hidden" name="barberId" value={barber.id} />
              <input type="hidden" name="serviceId" value={service.id} />
              <input type="hidden" name="start" value={choices.start} />
              <input type="hidden" name="name" value={name} />
              <input type="hidden" name="email" value={email} />
              <div className="acts">
                <button type="submit" className="btn" disabled={paying}>
                  {paying ? "Opening Stripe" : `Pay ${formatMoney(deposit)} deposit`}
                </button>
                <button type="button" className="quiet" onClick={() => go("details")} disabled={paying}>
                  Back
                </button>
              </div>
            </form>
            <p className="note">This is a test payment and no real card is ever charged. On Stripe&apos;s page use card number 4242 4242 4242 4242, any future date and any security code.</p>
          </>
        )}
      </div>
    </div>
  );
}
