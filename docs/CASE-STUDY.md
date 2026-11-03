# Demo Barbers: case study

Demo Barbers is a fictional barber shop that sells nothing. Payments run in Stripe's test mode only. It is a portfolio demo, live at https://demo-barbers-uk.vercel.app.

## The brief

Small service businesses lose money to no-shows and to time spent answering "are you free on Saturday?". I wanted a demo that proves I can deliver what a barber, salon or clinic actually needs: online booking with a deposit, a way for customers to cancel or move without ringing, and a simple diary for the owner. Three limits shaped it. It had to cost £0 to run. It had to be honest: everything labelled as a demo, and nothing invented as proof. And it had to be safe to leave on the open internet, where anyone can book, cancel and press buttons.

I am not a developer. I led the project, chose the look and made the business, money and taste decisions.

## What I built

A two-chair shop with four services from £16 to £36. A customer picks a service, a barber and a time, pays a 20% deposit by card and gets a private link. That link lets them cancel with a full refund up to 24 hours before, or move to another time with the deposit carried over. No account or password is needed.

The owner's side is a diary: the day and week at a glance, bookings marked completed or as no-shows, deposits refunded and time blocked off. Visitors can open it with one button and try it on made-up bookings that reset by themselves.

Every photo is AI-generated and labelled on the site. It runs on Next.js, Neon Postgres in London, Stripe's sandbox and Vercel's free plan.

## Decisions that mattered

**The database refuses double bookings.** Two people tapping the same time at the same moment is the classic booking bug. Instead of checking in code and hoping, the database has a rule that one barber's bookings can never overlap. A test fires ten bookings at one time at once; exactly one wins.

**A time is held while the customer pays.** On "Pay deposit" the time is held for 10 minutes, then released if payment does not finish. Expired holds are cleared inside each new booking, so the diary stays right even if no scheduled job runs.

**The payment is checked twice.** Stripe tells the site when a payment succeeds, and the site asks Stripe again before confirming. If someone pays for a time that has gone in the meantime, they are refunded automatically and told why.

**No customer accounts.** A signed private link does everything a customer needs. It cannot be guessed or altered, and its pages are hidden from search engines.

**No emails, on purpose.** The booking first emailed each customer their link. Shortly before launch I removed it: on a public demo anyone can type anyone's address, so it could have been used to send unwanted mail. The link now shows on screen with a copy button. A real shop's version would email it.

**Safe to leave open.** The demo login can block a little time but never touch real bookings, and it is capped at six short blocks. Booking, sign-in and payment checks all have limits per connection, stored as salted hashes, never raw addresses. Every booking is deleted after 24 hours.

**Realistic photos, honestly labelled.** The first photos looked plainly AI-made. They were redone twice with stricter rules: one consistent room, natural light, real skin texture, and no mirror reflections, which the image model could not draw convincingly. Each was checked against photos of real barbershops before use.

**A bug the live test caught.** After launch I paid and cancelled once on the live site with Stripe's test card. Payment, refund and Stripe's message to the site all worked. But checking Stripe's records showed the live site was also receiving messages about payments from test runs on a laptop, which share the same Stripe sandbox, and was answering them with an error. Stripe retries those for days and can switch a failing endpoint off. Each copy of the site now acts only on payments it started itself, with a test, and the fix was live the same night.

**Reviews before launch.** An independent code review and then a structured security audit were run before going public. Every serious finding was fixed with a test. The audit's six possible issues led to five fixes, such as stopping someone who knows a customer's email from cancelling that customer's unpaid booking.

## Results

All measured, none estimated. No real customers: it is a demo.

- 25 unit, 56 integration and 255 browser tests pass, plus 6 checkouts through Stripe's real sandbox (2 to 3 November 2026).
- A booking paid and cancelled on the live site was refunded in full, with Stripe's message to the site delivered (3 November 2026).
- Lighthouse on a phone, median of 5 runs on the live site (3 November 2026): accessibility 100 on every page tested, performance 89 on the home page, 91 on booking and 96 on the diary sign-in.
- Running cost: £0 a month, on free plans.
- Source security audit: no confirmed issues; five possible issues fixed with a test each, and one checked on the live site.

## What I would do next

- For a real shop: confirmation emails and text message reminders the day before (the email part was built, then removed for the public demo).
- Lift the home page's phone performance score from 89 to 90 or more by cutting script work on first load.
- Let the owner set opening hours, services and prices from the diary instead of in code.
- Keep the owner's own blocked time beyond 24 hours. Today the demo's clean-up removes it with everything else.
- Decide whether to add an open-source licence (today the code is public to read, with all rights reserved).

## Upwork version

**Title:** Online booking with deposits for a barber shop (Next.js, Stripe)

**Description:**

Demo Barbers is a working booking site for a made-up barber shop. I made it to show what a small service business can run online for £0 a month.

Customers pick a service, a barber and a time, then pay a 20% deposit by card through Stripe. They get a private link to cancel with a full refund up to 24 hours before, or to move to another time, with no account or password. The owner gets a diary with day and week views, where bookings are marked completed or as no-shows, deposits are refunded and time is blocked off.

The database itself refuses double bookings, and every payment is checked with Stripe before a booking is confirmed. Payments run in Stripe's test mode, so try it with the card 4242 4242 4242 4242. 25 unit, 56 integration and 255 browser tests pass, and accessibility scores 100 in Lighthouse.

If no-shows cost your barber shop, salon or clinic money, I can set up the same for your services, prices and hours.

**Skills:** Next.js, React, TypeScript, Stripe, PostgreSQL, Booking System, Payment Integration, Web Development

**Links:** Live demo https://demo-barbers-uk.vercel.app · Code https://github.com/campit101/demo-barbers
