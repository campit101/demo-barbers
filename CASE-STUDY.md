# Demo Barbers: case study

A portfolio demo of online booking with a deposit for a made-up barber shop. Nothing is sold, and payments run in Stripe test mode only.

## Problem

A small barber shop needs customers to book a chair online and put down a deposit, without two people ever getting the same time and without a heavy system to run.

## Approach

- Visitors pick a service, a barber and a time. Free times are worked out from opening hours, existing bookings and blocked time.
- A 20% deposit is taken through Stripe Checkout. The time is held for 10 minutes while the visitor pays.
- The database itself refuses two overlapping bookings for one barber, so two visitors racing for the same time cannot both win.
- There are no customer accounts. A signed private link, shown after paying, lets a customer cancel (refund up to 24 hours before) or move to another time.
- Stripe confirms payment through a signed webhook. The site checks the payment with Stripe again before confirming, and confirms each booking exactly once.
- The shop gets a diary with day and week views, where the owner marks bookings completed or as no-shows, refunds deposits and blocks time.
- The demo sends no emails, because visitors can type any address. A real shop would email the private link.

## Result

Measured on the live demo on 2 and 3 November 2026:

- 25 unit tests, 56 integration tests against a real Postgres database and 255 browser tests (phone and desktop, light and dark, with accessibility checks) pass.
- 6 real Stripe sandbox checkouts (pay, cancel, move, refund) pass. A paid and refunded booking on the live site was checked in Stripe: paid, refunded in full, webhook delivered.
- Lighthouse on mobile, median of 5 runs: performance 89 on the home page, 91 on booking and 96 on the diary sign-in. Accessibility is 100 on all three.

This is a demo with no real customers, so no business results are claimed.

## What I would improve

- The home page's main speed shortfall is script time on a slowed phone (total blocking time 381 ms). I would trim the scripts it loads.
- A real shop needs confirmation emails and reminders. The demo leaves them out on purpose.
- The code has had two source reviews but no outside security audit and no attack testing. A real shop would need both before taking live payments.
