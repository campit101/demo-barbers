// Database schema. The rule that makes double-booking impossible, the exclusion constraint on bookings, is written by hand
// in drizzle/0000_init.sql because Drizzle has no way to express it.
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/**
 * One row is either a customer's booking or a stretch of time an owner blocked off. They share a table so one
 * database rule stops anything overlapping anything else.
 *
 * status: held (paying, 10 minutes) > confirmed > completed or no_show; cancelled; expired (hold ran out).
 * deposit_status: none > paid > refund_pending > refunded; or kept.
 */
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull().default("booking"),
    reference: text("reference").unique(),
    barberId: text("barber_id").notNull(),
    serviceId: text("service_id"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    customerName: text("customer_name"),
    customerEmail: text("customer_email"),
    /** Salted hash of the connection that made a hold, so only that connection can retake it. Never a raw address. */
    holdOwner: text("hold_owner"),
    pricePence: integer("price_pence"),
    depositPence: integer("deposit_pence"),
    depositStatus: text("deposit_status").notNull().default("none"),
    stripeSessionId: text("stripe_session_id").unique(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    /** Why the slot went: 'late-payment-lost-slot' when a payment landed after someone else took the time. */
    outcome: text("outcome"),
    isSeed: boolean("is_seed").notNull().default(false),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    check("bookings_kind_check", sql`${t.kind} in ('booking', 'block')`),
    check("bookings_status_check", sql`${t.status} in ('held', 'confirmed', 'completed', 'no_show', 'cancelled', 'expired')`),
    check("bookings_deposit_check", sql`${t.depositStatus} in ('none', 'paid', 'refund_pending', 'refunded', 'kept')`),
    check("bookings_time_check", sql`${t.endsAt} > ${t.startsAt}`),
    check("bookings_hold_check", sql`${t.status} <> 'held' or ${t.holdExpiresAt} is not null`),
    check("bookings_customer_check", sql`${t.kind} = 'block' or (${t.customerName} is not null and ${t.customerEmail} is not null and ${t.serviceId} is not null and ${t.pricePence} is not null and ${t.depositPence} is not null)`),
    check("bookings_text_length_check", sql`coalesce(length(${t.customerName}), 0) <= 60 and coalesce(length(${t.customerEmail}), 0) <= 254`),
    index("bookings_barber_start_idx").on(t.barberId, t.startsAt),
    index("bookings_status_hold_idx").on(t.status, t.holdExpiresAt),
    index("bookings_created_idx").on(t.createdAt),
  ],
);

/** Stripe event ids already handled, so a repeated webhook does nothing twice. */
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Fixed-window counters. Keys are salted hashes; raw IP and email addresses are never stored here. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

// Better Auth's tables: sign-in for the shop's admin only.
export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    role: text("role").notNull().default("demo"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [check("user_role_check", sql`${t.role} in ('owner', 'demo')`)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: created(),
    updatedAt: updated(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);
