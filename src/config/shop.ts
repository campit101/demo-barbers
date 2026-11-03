// Everything a shop owner would change, in one place. Relative imports only: plain node scripts load this file too.

export const SERVICES = [
  { id: "cut", name: "Haircut", minutes: 30, pricePence: 2400, photo: "/photos/scissors.jpg", focus: "38% 40%", alt: "Ailsa cutting a relaxed client's hair with scissors over a comb. AI-generated." },
  { id: "fade", name: "Skin fade", minutes: 45, pricePence: 2800, photo: "/photos/fade.jpg", focus: "55% 50%", alt: "Close-up of a fresh skin fade being finished with clippers. AI-generated." },
  { id: "beard", name: "Beard trim", minutes: 20, pricePence: 1600, photo: "/photos/beard.jpg", focus: "52% 40%", alt: "Marek trimming a client's full beard with a small trimmer. AI-generated." },
  { id: "both", name: "Cut plus beard", minutes: 50, pricePence: 3600, photo: "/photos/towel.jpg", focus: "55% 45%", alt: "Ailsa pressing a hot towel over a relaxed client's beard. AI-generated." },
] as const;

export const BARBERS = [
  { id: "marek", name: "Marek", photo: "/photos/barber-1.jpg", alt: "Marek leaning on his counter, arms folded, clippers in hand. AI-generated.", line: "Fades and tapers. Remembers your name and your last cut." },
  { id: "ailsa", name: "Ailsa", photo: "/photos/barber-2.jpg", alt: "Ailsa standing by her station with scissors in hand. AI-generated.", line: "Scissor work and beards. Will happily talk you out of a bad idea." },
] as const;

export type ServiceId = (typeof SERVICES)[number]["id"];
export type BarberId = (typeof BARBERS)[number]["id"];

export const serviceById = (id: string) => SERVICES.find((s) => s.id === id);
export const barberById = (id: string) => BARBERS.find((b) => b.id === id);

export const SHOP = {
  timeZone: "Europe/London",
  openMinute: 9 * 60,
  closeMinute: 18 * 60,
  /** Sunday and Monday, as Date.getUTCDay() numbers for the London date. */
  closedDays: [0, 1] as readonly number[],
  slotStepMinutes: 15,
  /** Nobody can book a slot starting sooner than this. */
  leadMinutes: 15,
  bookingWindowDays: 14,
  depositPercent: 20,
  holdMinutes: 10,
  /** Stripe will not let a Checkout session expire sooner than 30 minutes. */
  stripeSessionMinutes: 30,
  freeCancelHours: 24,
} as const;

export const depositFor = (pricePence: number) => Math.round((pricePence * SHOP.depositPercent) / 100);

export const DATA = {
  /** Visitors' bookings disappear from view after this and are deleted by the next clean-up. */
  retentionHours: 24,
  /** Seeded demo bookings are rebuilt once they are this old. */
  seedMaxAgeHours: 24,
} as const;

export const LIMITS = {
  holdsPerHourPerConnection: 10,
  holdsPerHourPerEmail: 5,
  manageActionsPerHourPerConnection: 30,
  /** Visits to the page Stripe returns customers to. Each one asks Stripe about the payment. */
  returnChecksPerHourPerConnection: 30,
  availabilityPerMinutePerConnection: 120,
  signInsPerHourPerConnection: 20,
  signInsPerHourPerEmail: 10,
  demoActionsPerHourPerConnection: 120,
  /** The public demo login's own blocks. Past this the oldest goes, so it can never empty the public booking page. */
  demoBlocksActive: 6,
  demoBlockMaxMinutes: 120,
  /** How far ahead the real owner can block time. */
  ownerBlockDaysAhead: 365,
} as const;

export const ACCOUNTS = {
  sessionDays: 7,
  passwordMinLength: 12,
  passwordMaxLength: 128,
  owner: { email: "owner@demo-barbers.invalid", name: "Shop owner" },
  // A public one-button login. It can change seeded bookings only and never sees visitors' details.
  demo: { email: "demo@demo-barbers.invalid", name: "Demo visitor", password: "try-the-demo-diary-2026" },
} as const;

// SHA-256 fingerprints of the two Neon endpoint names, so the guard can tell them apart without the names being public.
export const NEON = {
  test: "7d3fbde5767e0226a230243b9d573e461c0cd83db11a21962043fb5caedcca6b",
  live: "93415fba3af08cbf5ad4a5ce9cb1699a12ef12cda330961bc63c3866ef625f2e",
} as const;

export const APP_TAG = "demo-barbers";
