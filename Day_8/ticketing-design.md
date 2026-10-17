# TicketHub: System Design

TicketHub is a website that sells tickets for concerts and events. Most days it is quiet, but when a very popular concert goes on sale, a crowd arrives all at once and every person wants one of a small number of seats. This document applies the six-part framework: **requirements, estimates, API, data model, architecture and trade-offs**. A section after the data model explains how two people are prevented from buying the same seat.

**Starting facts**

| Fact | Value |
|------|-------|
| Registered users | 2,000,000 |
| Normal day | 50,000 visitors, each viewing 10 pages; 5,000 tickets sold |
| Big sale | 200,000 people try to buy 20,000 seats within the first 10 minutes |

---

## 1. Requirements

### Functional requirements

- Visitors can **browse and search events** (by name, city and date) and open an event page with its details.
- Visitors can **view the seat map** of an event and see which seats are available, with prices.
- Users can **register, log in** and log out. Browsing is open to everyone; buying needs an account.
- A logged-in user can **hold seats**: choose up to 6 seats, which are reserved for them for 10 minutes while they pay.
- A user can **release** a hold, or let it expire so the seats go back on sale.
- A user can **pay** for a hold using a card, through an external payment provider.
- After payment the user receives their **tickets** (unique code / QR code) by email and can **view their tickets** at any time.
- A user can see their past orders.

Out of scope for this document: organiser tools for creating events, ticket resale and transfers, and detailed refund rules.

### Non-functional requirements

| Quality | Target | Why it matters |
|---------|--------|----------------|
| **Correctness** | A seat is **never sold to two people**, never sold without a successful payment, and a payment is never taken without a ticket (or an automatic refund) | Selling a seat twice means an angry customer, a refund and a damaged reputation. Correctness beats speed |
| **Speed** | Event and seat-map pages in under 300 ms for 95% of requests; seat-hold requests in under 500 ms | Slow pages lose customers, and in a big sale every second a seat is stuck in a slow request is a seat someone else could have bought |
| **Fairness** | People who arrive first (or who are drawn by lottery in the opening seconds) get first chance; a limit of 6 tickets per user per event; bots and scripts are blocked or slowed | Without this, fast scripts and refresh-spammers beat real fans and people lose trust |
| **Availability** | 99.9% overall, and **no downtime during an on-sale** | A crash at the moment of a big sale is the worst possible time |
| **Scalability** | Handle roughly 100 to 300 times the normal load for short bursts, scaling back down afterwards | See the estimates below |
| **Consistency** | **Strong** for seat inventory (everyone agrees who owns a seat); **eventual** (a second or two behind) is fine for browsing and seat-map displays | We spend our strictness only where a mistake is expensive |
| **Durability** | Orders and tickets are never lost: replicated storage and daily backups with point-in-time recovery | People pay real money for these |
| **Security** | HTTPS, hashed passwords, per-user access checks, card details handled only by the payment provider (never stored by us) | Protects customers and keeps us out of the heaviest payment-compliance rules |

---

## 2. Estimates

### Assumptions

- Each page view is one API request.
- Normal-day peak is 5x the normal-day average; the first minute of a big sale is 3x the 10-minute average.
- Each order has 2 tickets on average, and there are about 2 hold attempts per completed order on a normal day.
- In a big sale each shopper makes about **1 event-page request, 5 seat-map refreshes and 3 hold attempts**.
- Average sizes: about 0.5 KB per order, ticket or user row and about 0.2 KB per seat row.

### Normal day

| Measure | Calculation | Result |
|---------|-------------|--------|
| Visitors | given | 50,000 per day |
| Page views | 50,000 x 10 | 500,000 per day |
| **Page views per second (average)** | 500,000 / 86,400 | **about 6 per second** |
| **Page views per second (peak)** | 5.8 x 5 | **about 29 per second** |
| Tickets sold | given | 5,000 per day (about 2,500 orders) |
| **Tickets per second (average)** | 5,000 / 86,400 | **about 0.06 per second** |
| Writes (holds + orders) | about 5,000 + 2,500 | about 7,500 per day, or 0.1 per second |
| Storage per year | 1.8 M tickets, 0.9 M orders, 5 M seat rows, 2 M users | **about 3.5 GB per year** |

The normal day is **read-heavy** (about 500,000 reads to 7,500 writes, roughly 70 to 1) and tiny: one small database and two servers could handle it. Storage is not a problem either, because the numbers are in gigabytes, not terabytes.

### Big sale (200,000 people, 20,000 seats, 10 minutes = 600 seconds)

| Measure | Calculation | Result |
|---------|-------------|--------|
| **Shoppers arriving per second** | 200,000 / 600 | **about 333 per second** |
| Event-page requests per second | 200,000 x 1 / 600 | about 333 per second |
| Seat-map requests per second | 200,000 x 5 / 600 | about 1,670 per second |
| Hold attempts per second | 200,000 x 3 / 600 | about 1,000 per second |
| **Total requests per second (average over the 10 minutes)** | 333 + 1,670 + 1,000 | **about 3,000 per second** |
| **Total requests per second (first-minute peak)** | 3,000 x 3 | **about 9,000 per second** |
| **Seats sold per second (if the event sells out in 10 minutes)** | 20,000 / 600 | **about 33 per second** (roughly 17 orders per second) |
| Competition | 200,000 shoppers / 20,000 seats | **10 people for every seat**, so about 90% will not get a ticket |

### Comparison

| Measure | Normal day | Big sale | How much bigger |
|---------|-----------|----------|-----------------|
| Shoppers arriving per second | 0.6 (50,000 / day) | 333 | about **575x** |
| Requests per second (average) | 6 | 3,000 | about **500x** |
| Requests per second (peak) | 29 | 9,000 | about **310x** |
| Seats sold per second | 0.06 | 33 | about **575x** |
| People competing for the same seat | almost nobody | 10 per seat | the real problem |

**What this tells us:**
1. The **big sale decides the design, not the normal day.** In 10 minutes the site gets four times a whole normal day's visitors.
2. The hardest part is not storage or even total traffic: it is **many people fighting for the same few rows at the same instant**. Only about 33 seats per second are actually sold (20,000 in total), but about 1,000 hold attempts per second are fighting over them, and the most popular seats are tried by thousands.
3. The spike lasts minutes, so capacity should be added **temporarily** (scale up before the sale, back down after) instead of paying for 300x capacity all year.

---

## 3. API

**Conventions:** base URL `https://api.tickethub.example/v1`, JSON, `Authorization: Bearer <token>` for everything except browsing and login. Money is in cents. Timestamps are ISO 8601 UTC.

| # | Method | Path | Description | Auth | Success |
|---|--------|------|-------------|------|---------|
| 1 | GET | `/events?q=&city=&from=&page=` | Browse and search events (paginated) | No | 200 |
| 2 | GET | `/events/{eventId}` | Event details (name, venue, date, on-sale time, price range) | No | 200 |
| 3 | GET | `/events/{eventId}/seats?section=` | Seat map with availability for each seat | No | 200 |
| 4 | POST | `/events/{eventId}/queue` | Join the waiting room for a popular event; returns a position and token | Yes | 202 |
| 5 | POST | `/events/{eventId}/holds` | **Hold** 1 to 6 seats for 10 minutes | Yes | 201 |
| 6 | DELETE | `/holds/{holdId}` | Release a hold early | Yes | 204 |
| 7 | POST | `/orders` | **Pay** for a hold (needs an `Idempotency-Key` header) | Yes | 201 |
| 8 | GET | `/orders/{orderId}` | Order status (pending, paid, failed) | Yes | 200 |
| 9 | GET | `/me/tickets` | **View my tickets** | Yes | 200 |
| 10 | POST | `/auth/login` | Log in and receive a token | No | 200 |

Notes:
- Endpoints 1 to 3 are **reads** and can be cached; 5 to 7 are the **critical writes**.
- `POST /orders` carries an `Idempotency-Key` so that if the user double-clicks "Pay" or the network retries, they are charged once, not twice.
- `POST /events/{id}/queue` is only used when an event is flagged as high demand. The queue token is then required as `X-Queue-Token` on the seat and hold endpoints.

### Example: hold seats (`POST /events/42/holds`)

```http
POST /v1/events/42/holds HTTP/1.1
Authorization: Bearer eyJhbGciOi...
X-Queue-Token: q_91ac7e
Content-Type: application/json

{ "seat_ids": [101, 102] }
```

**201 Created**

```json
{
  "hold_id": "h_7f3a9c2e",
  "event_id": 42,
  "seats": [
    { "id": 101, "section": "A", "row": "1", "number": 1, "price_cents": 8500 },
    { "id": 102, "section": "A", "row": "1", "number": 2, "price_cents": 8500 }
  ],
  "total_cents": 17000,
  "expires_at": "2026-10-24T18:10:00Z"
}
```

**409 Conflict** when any requested seat has already been taken. Nothing is held (all or nothing):

```json
{
  "error": {
    "code": "seat_unavailable",
    "message": "One or more of the seats you chose were just taken. Please choose different seats.",
    "unavailable_seat_ids": [102]
  }
}
```

### Example: pay (`POST /orders`)

```http
POST /v1/orders HTTP/1.1
Authorization: Bearer eyJhbGciOi...
Idempotency-Key: 5d0c1f60-3c1e-4f7e-9d7a-2b6b1f9a0a11
Content-Type: application/json

{ "hold_id": "h_7f3a9c2e", "payment_token": "tok_visa_abc123" }
```

`payment_token` comes from the payment provider's own form, so card numbers never reach TicketHub. **201 Created** returns the order with `"status": "paid"` and its tickets.

### Error codes

| Status | When |
|--------|------|
| 400 | Invalid request (more than 6 seats, empty list, bad JSON) |
| 401 | Missing or expired token |
| 402 | Payment declined by the payment provider |
| 403 | Trying to pay for or release someone else's hold, or the event is not on sale yet |
| 404 | Event, hold or order does not exist |
| 409 | A requested seat is already taken |
| 410 | The hold has expired |
| 429 | Too many requests (rate limit) or the user's ticket limit for this event is reached |
| 503 | Overloaded or temporarily unavailable: the client is told to retry or return to the waiting room |

---

## 4. Data model

### Tables

**users:** one row per account: `id` (PK), `email` (unique), `password_hash`, `name`, `created_at`.

**events:** one row per concert or event: `id` (PK), `name`, `venue`, `city`, `starts_at`, `on_sale_at`, `max_tickets_per_user`.

**seats:** one row **per seat per event**: `id` (PK), `event_id` (FK to events), `section`, `row_label`, `seat_number`, `price_cents`, and the seat's live state: `status` (`available`, `held` or `sold`), `held_by` (FK to users), `hold_token` and `hold_expires_at`. A unique key on `(event_id, section, row_label, seat_number)` stops the same physical seat being created twice. This is the table where seats are claimed.

**orders:** one row per purchase: `id` (PK), `user_id` (FK to users), `event_id` (FK to events), `total_cents`, `status` (`pending`, `paid`, `failed`, `refunded`), `payment_ref`, `idempotency_key` and `created_at`. `(user_id, idempotency_key)` is unique, so a retried payment cannot create a second order.

**tickets:** one row per ticket: `id` (PK), `order_id` (FK to orders), `seat_id` (FK to seats), a unique `ticket_code` (the QR code content) and `status` (`valid` or `cancelled`).

### Relationships

- **users to orders: one-to-many.** A user can place many orders; each order belongs to one user.
- **events to seats: one-to-many.** An event has thousands of seats; each seat row belongs to one event.
- **events to orders: one-to-many.** An event has many orders.
- **orders to tickets: one-to-many.** An order contains one or more tickets (one per seat).
- **seats to tickets: one-to-many over time, but only one *valid* ticket at a time.** If a ticket is cancelled and refunded, the seat can be sold again, but at any moment a seat has **at most one valid ticket**. A database rule enforces this (see below).
- **users to seats (temporary).** While a seat is held, `seats.held_by` points at the user holding it.
- **users to events: many-to-many**, through orders and tickets. A user attends many events and an event has many attendees, so `orders` (with `tickets`) plays the role of the join table.

### Schema (SQLite syntax; runs in a playground such as sqliteonline.com)

In PostgreSQL the same design uses `BIGINT GENERATED ALWAYS AS IDENTITY`, `TIMESTAMPTZ` and `now()`.

```sql
-- [schema]
PRAGMA foreign_keys = ON;

CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE events (
    id                   INTEGER PRIMARY KEY,
    name                 TEXT NOT NULL,
    venue                TEXT NOT NULL,
    city                 TEXT NOT NULL,
    starts_at            TEXT NOT NULL,
    on_sale_at           TEXT NOT NULL,
    max_tickets_per_user INTEGER NOT NULL DEFAULT 6 CHECK (max_tickets_per_user > 0)
);

CREATE TABLE seats (
    id              INTEGER PRIMARY KEY,
    event_id        INTEGER NOT NULL,
    section         TEXT NOT NULL,
    row_label       TEXT NOT NULL,
    seat_number     INTEGER NOT NULL,
    price_cents     INTEGER NOT NULL CHECK (price_cents >= 0),
    status          TEXT NOT NULL DEFAULT 'available'
                    CHECK (status IN ('available', 'held', 'sold')),
    held_by         INTEGER,
    hold_token      TEXT,
    hold_expires_at TEXT,
    FOREIGN KEY (event_id) REFERENCES events(id),
    FOREIGN KEY (held_by)  REFERENCES users(id),
    UNIQUE (event_id, section, row_label, seat_number),
    -- a held seat must always say who holds it, with which token, until when
    CHECK (status <> 'held'
           OR (held_by IS NOT NULL AND hold_token IS NOT NULL AND hold_expires_at IS NOT NULL))
);

CREATE TABLE orders (
    id              INTEGER PRIMARY KEY,
    user_id         INTEGER NOT NULL,
    event_id        INTEGER NOT NULL,
    total_cents     INTEGER NOT NULL CHECK (total_cents >= 0),
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
    payment_ref     TEXT,
    idempotency_key TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)  REFERENCES users(id),
    FOREIGN KEY (event_id) REFERENCES events(id),
    UNIQUE (user_id, idempotency_key)
);

CREATE TABLE tickets (
    id          INTEGER PRIMARY KEY,
    order_id    INTEGER NOT NULL,
    seat_id     INTEGER NOT NULL,
    ticket_code TEXT NOT NULL UNIQUE,
    status      TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'cancelled')),
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (seat_id)  REFERENCES seats(id)
);

-- THE SAFETY NET: a seat can have at most ONE valid ticket, whatever the application does.
CREATE UNIQUE INDEX uq_one_valid_ticket_per_seat ON tickets (seat_id) WHERE status = 'valid';

CREATE INDEX idx_seats_event_status  ON seats  (event_id, status);
CREATE INDEX idx_orders_user_created ON orders (user_id, created_at DESC);
CREATE INDEX idx_tickets_order       ON tickets (order_id);
```

### Indexes and why

- **`uq_one_valid_ticket_per_seat`** (partial unique index): the last line of defence against double-booking.
- **`seats (event_id, status)`**: the seat map and "how many seats are left?" only look at one event's seats, so the database goes straight to them instead of scanning every seat of every event.
- **`orders (user_id, created_at DESC)`**: "my orders", newest first.
- **`tickets (order_id)`**: fast lookup of the tickets in an order (and for `GET /me/tickets`).

### Sample data and two read queries

```sql
-- [sample-data]
INSERT INTO users (id, email, password_hash, name) VALUES
    (1, 'amina@example.com', 'h1', 'Amina'),
    (2, 'brian@example.com', 'h2', 'Brian'),
    (3, 'chloe@example.com', 'h3', 'Chloe');

INSERT INTO events (id, name, venue, city, starts_at, on_sale_at) VALUES
    (1, 'Sauti Sol Live', 'Kasarani Arena', 'Nairobi', '2026-12-05 19:00:00', '2026-10-24 10:00:00');

INSERT INTO seats (id, event_id, section, row_label, seat_number, price_cents) VALUES
    (101, 1, 'A', '1', 1, 8500),
    (102, 1, 'A', '1', 2, 8500),
    (103, 1, 'A', '1', 3, 8500),
    (104, 1, 'A', '1', 4, 8500),
    (105, 1, 'A', '1', 5, 8500),
    (106, 1, 'A', '1', 6, 8500);
```

```sql
-- [seatmap]  (behind GET /events/{id}/seats; an expired hold counts as available)
SELECT id, section, row_label, seat_number, price_cents,
       CASE WHEN status = 'available'
                 OR (status = 'held' AND hold_expires_at < datetime('now'))
            THEN 'available' ELSE 'unavailable' END AS availability
FROM seats
WHERE event_id = 1
ORDER BY section, row_label, seat_number;
```

```sql
-- [my-tickets]  (behind GET /me/tickets)
SELECT t.ticket_code, e.name, e.starts_at, s.section, s.row_label, s.seat_number
FROM tickets t
JOIN orders o ON o.id = t.order_id
JOIN seats  s ON s.id = t.seat_id
JOIN events e ON e.id = s.event_id
WHERE o.user_id = 1 AND o.status = 'paid' AND t.status = 'valid'
ORDER BY e.starts_at;
```

---

## How the design prevents two people buying the same seat

The danger is a **race**: Amina and Brian both see seat 102 as free, and both click "hold" in the same millisecond. If the server did "check if it is free, then mark it taken" as two separate steps, both checks could pass before either update happens, and both people would get the seat. The design closes that gap with **four layers**, so that no single bug can sell a seat twice.

### Layer 1: one atomic "check and claim" statement

Checking and claiming happen in **one SQL statement**, inside a transaction. The `WHERE` clause is the check and the `SET` is the claim, so there is no gap between them. The database locks each seat row while the update runs, so when two requests target the same seat, one runs first and the other waits, then re-evaluates the `WHERE` clause, sees the seat is no longer available, and changes **zero rows**.

```sql
-- [hold]
BEGIN IMMEDIATE;   -- PostgreSQL: BEGIN;

UPDATE seats
SET status          = 'held',
    held_by         = :user_id,
    hold_token      = :hold_token,
    hold_expires_at = datetime('now', '+10 minutes')
WHERE event_id = :event_id
  AND id IN (:seat_a, :seat_b)
  AND (status = 'available'
       OR (status = 'held' AND hold_expires_at < datetime('now')));

-- The application checks how many rows were changed:
--   all requested seats changed -> COMMIT;   (they are held for this user)
--   fewer than requested        -> ROLLBACK; (return 409; nothing is held)
```

- The request is **all or nothing**: if the user asked for two seats and only one was free, the transaction is rolled back so they are not left holding half of what they wanted.
- The rule "a user holds at most 6 seats per event" is checked in the same transaction, using `events.max_tickets_per_user`.
- An **expired hold counts as available** in the `WHERE` clause, so a seat is never locked forever by someone who walked away, even if the clean-up job is late.

**Walk-through:** Amina's and Brian's requests reach the database together. Amina's statement runs first: seat 102 is `available`, so it becomes `held` by Amina and 1 row changes (COMMIT, `201`). Brian's statement runs next: seat 102 is now `held` and not expired, so the `WHERE` clause no longer matches and **0 rows change**. The app sees 0 of 1 seats changed, rolls back and returns `409 seat_unavailable`. Only one of them can ever win.

### Layer 2: a time-limited hold that must still be yours when you pay

A hold lasts 10 minutes so that people have time to pay but seats are not blocked forever. When payment completes, the database re-checks that the hold is **still this user's and has not expired**:

```sql
-- [purchase]
BEGIN IMMEDIATE;   -- PostgreSQL: BEGIN;

-- 1. The payment provider confirmed the charge: mark the order paid.
UPDATE orders
SET status = 'paid', payment_ref = :payment_ref
WHERE id = :order_id AND status = 'pending';

-- 2. Create one ticket for each seat this user still holds (hold not expired).
INSERT INTO tickets (order_id, seat_id, ticket_code)
SELECT :order_id, id, lower(hex(randomblob(8)))
FROM seats
WHERE hold_token = :hold_token
  AND held_by = :user_id
  AND status = 'held'
  AND hold_expires_at > datetime('now');

-- 3. Turn those seats into sold seats.
UPDATE seats
SET status = 'sold', held_by = NULL, hold_token = NULL, hold_expires_at = NULL
WHERE hold_token = :hold_token
  AND held_by = :user_id
  AND status = 'held'
  AND hold_expires_at > datetime('now');

-- The application checks that tickets created = seats updated = seats in the hold:
--   yes -> COMMIT;
--   no  -> ROLLBACK, and the payment is refunded (the hold expired or was lost).
```

Because **the payment happens between the hold and the purchase**, a hold could expire while the customer is typing their card. To stop the clean-up job releasing a seat mid-payment, the hold is extended by a few minutes when the payment starts. If the hold is still lost for any reason, the transaction above fails and the customer is **refunded automatically**, so nobody pays for a seat they do not get.

### Layer 3: clean-up of abandoned holds

A background worker puts abandoned seats back on sale so the seat map stays accurate:

```sql
-- [sweep]
UPDATE seats
SET status = 'available', held_by = NULL, hold_token = NULL, hold_expires_at = NULL
WHERE status = 'held' AND hold_expires_at < datetime('now');
```

This job only keeps the display tidy: correctness does not depend on it, because Layer 1 already treats expired holds as available.

### Layer 4: a database constraint as the final safety net

Even if a future bug in the application tried to sell a seat twice, the unique index `uq_one_valid_ticket_per_seat` makes the database **refuse** a second valid ticket for the same seat:

```sql
-- [backstop]  Pretend a bug tries to issue a second ticket for seat 101
--             (assumes order 1 has already bought seat 101):
INSERT INTO tickets (order_id, seat_id, ticket_code) VALUES (1, 101, 'duplicate-code');
-- Error: UNIQUE constraint failed: tickets.seat_id
```

The constraint lives in the database, where every request must pass, not in application code that could have a bug or a race of its own.

### Supporting rules

- **Idempotent payments:** `(user_id, idempotency_key)` is unique, so double-clicks and network retries create one order and one charge.
- **The cache is never trusted for correctness.** The seat map shown from a cache or the CDN may be a second or two old, so a user may click a seat that has just been taken. That is acceptable, because the atomic hold in Layer 1 is the only thing that decides, and the user simply gets a `409`.
- **Only the primary database decides.** All seat claims go to the primary database, never to a read replica, which may lag behind.

---

## 5. Architecture

```
                                      +-----------------------+
                                      |         CLIENT        |
                                      |   (browser / mobile)  |
                                      +-----------------------+
                                                  |
                                                  v
                                      +-----------------------+
                                      |          DNS          |
                                      |       www -> CDN      |
                                      |  api -> Load Balancer |
                                      +-----------------------+
                        +-------------------------+-------------------------+
  static files, event   |                                                   |   API calls (/v1/...)
  pages, seat-map       |                                                   |
  snapshots             v                                                   v
            +-----------------------+                         +---------------------------+
            |          CDN          |                         |    LOAD BALANCER / WAF    |
            |      (edge cache)     |                         | (rate limits, bot filter) |
            +-----------------------+                         +---------------------------+
                                                                            |
                                                                            v
                                                              +---------------------------+
                                                              |        WAITING ROOM       |
                                                              |   (admits shoppers at a   |
                                                              |      controlled rate)     |
                                                              +---------------------------+
                                                                            |
                                                              +-------------+-------------+
                                                              v                           v
                                                    +-------------------+       +-------------------+
                                                    |    APP SERVER 1   |       |    APP SERVER 2   |
                                                    |    (stateless)    |       |    (stateless)    | ... N (auto-scaled)
                                                    +-------------------+       +-------------------+
                                                              |                           |
                                                              +-------------+-------------+
                                                                            |
  every app server uses all four services below:                            |
                +-----------------------------+-----------------------------+---------------------------+
                v                             v                             v                           v
        +---------------+           +-------------------+         +-------------------+       +-------------------+
        |     CACHE     |           |     PRIMARY DB    |         |       QUEUE       |       |  PAYMENT PROVIDER |
        |    (Redis)    |           |   (seat claims,   |         |     (durable)     |       |     (external)    |
        |   + replica   |           |      orders)      |         +-------------------+       +-------------------+
        +---------------+           +-------------------+                   |               charged by an app server;
                                              |                   +-------------------+     result comes back by webhook
                                              | replication       |      WORKERS      |
                                              v                   | (emails, tickets, |
                                   +---------------------+        |    hold expiry)   |
                                   |   READ REPLICA(S)   |        +-------------------+
                                   |  (browse + seat map |
                                   |       refresh)      |
                                   +---------------------+
```

### What each component does

- **Client:** shows events, the seat map and the checkout, and sends API requests (and the waiting-room token during a big sale).
- **DNS:** turns `www` and `api` names into the right addresses, so traffic can be sent to a CDN, a new load balancer or another region without users changing anything.
- **CDN:** serves static files, event pages and one- to two-second-old seat-map snapshots from servers close to the user, which keeps most browsing traffic from ever reaching our servers.
- **Load balancer / WAF:** spreads requests over the app servers, drops unhealthy ones and applies per-user and per-IP rate limits and bot filtering, which solves overload and unfair advantages for scripts.
- **Waiting room:** during a big sale it lets shoppers into the buying pages at a rate the system can handle (and gives everyone a position and a fair order), which solves a 9,000-requests-per-second stampede hitting the database at once.
- **App servers (two or more, auto-scaled):** run the API logic (validation, hold, pay) and keep no state of their own, so more can be added quickly before a sale, which solves running out of capacity.
- **Cache (Redis):** stores event details, seat-availability snapshots, waiting-room tokens and rate-limit counters in memory, which solves repeated reads hammering the database.
- **Primary database:** the single source of truth for seats, orders and tickets, where every seat claim is made atomically, which solves **correct** inventory and double-booking.
- **Read replicas:** serve browsing and seat-map refresh queries from copies of the data, which solves reads competing with the critical writes on the primary.
- **Queue:** holds background jobs until a worker is free, which solves slow work (emails, ticket generation) delaying the buyer or being lost during a spike.
- **Workers:** send confirmation emails, generate tickets and QR codes, release expired holds and process refunds, retrying on failure, which solves long-running work blocking the app servers.
- **Payment provider (external):** charges the card on its own secure form and tells us the result by webhook, which solves the need to store card data and gives a trusted record of every payment.

### How it survives the big sale

1. **Prepare before the sale.** The on-sale time is known in advance, so we **pre-scale** the app servers, cache and database connections, warm the cache with event data, and give the hot event its own capacity. We do not wait for auto-scaling to react after the spike has already started.
2. **Absorb the crowd at the edge.** The CDN serves all static content and event pages, and seat-map snapshots (refreshed every second or two) are served from the CDN and cache. The roughly **1,700 seat-map requests per second** never touch the primary database.
3. **Throttle with a waiting room.** The 200,000 shoppers join a queue. The system admits about **150 shoppers per second** (a design target) into seat selection. Each stays about two minutes, so the app sees about 1,400 requests per second instead of 9,000, and the database sees about **450 hold attempts per second** instead of 1,000 or more. Everyone else sees "You are number 8,412 in line", which is far better than an error page.
4. **Keep the critical path small.** A hold is one short atomic statement on indexed rows, so the primary can serve many hundreds per second, while the maximum number of **successful** holds is capped by the 20,000 seats.
5. **Move slow work off the buyer's path.** Emails, ticket generation and clean-up go through the queue and workers, so the buyer gets a response straight after the database commit.
6. **Fail gracefully.** If the system is still overloaded, it returns `503` with a "try again" message or sends shoppers back to the waiting room, instead of crashing. When the event sells out, the CDN can show "Sold out" immediately so that thousands of people stop retrying.
7. **No single point of failure.** There are at least two app servers, two load balancers, a cache replica, a database replica ready to take over and several workers, spread over more than one availability zone.

### Buying flow in short

1. The shopper joins the waiting room and receives a token. When admitted, they open the event and see the seat map (from the cache).
2. They pick seats and call `POST /holds`. The app server runs the atomic hold statement on the primary database: **201** with a 10-minute hold, or **409** if someone else was faster.
3. They pay with `POST /orders` and an idempotency key. The app server creates a pending order and asks the payment provider to charge the card.
4. When the charge succeeds, the app server runs the purchase transaction (order paid, tickets created, seats sold) and commits.
5. A job goes on the queue; a worker sends the email with the tickets. The user can also open `GET /me/tickets`.
6. If payment fails or the hold expires, the seats return to sale and any money taken is refunded.

---

## 6. Trade-offs

1. **Fairness and protection vs speed and simplicity (the waiting room).** The waiting room protects the database and gives everyone a fair position, but it adds a step and makes some people wait, even when the system could probably have handled them. A random order for people who arrive in the first minute is fairer than first-come-first-served (which rewards the fastest internet connection and the most refreshing), but it feels less obvious to customers and must be explained clearly. I accept the extra friction because an overloaded site would be slower and less fair for everybody.

2. **Strong consistency vs scalability (one primary database for seats).** Letting only the primary database decide who owns a seat gives a simple, provably correct answer, but all seat claims go through one machine, which is a ceiling. I accept it because even a 10-minute sell-out means only about 33 seats sold per second, which one well-sized primary can handle comfortably. If we needed more (many big sales at the same time), we could split events across several databases (sharding by `event_id`), because a seat claim never involves more than one event.

3. **Stale seat maps vs load on the database.** Showing a one- or two-second-old seat map from the cache makes browsing fast and keeps about 1,700 requests per second off the primary, but some people will click a seat that is already gone and get a `409`. I accept this because the atomic hold is what decides, and a fast "sorry, pick another seat" message is a smaller problem than a crashed site.

4. **Hold time: long vs short.** A 10-minute hold gives people time to find their card, so fewer payments fail halfway. But abandoned holds lock seats that other people could buy, which hurts in a sell-out where there are 10 buyers per seat. A shorter hold (say 5 minutes) frees seats faster but frustrates slower buyers. Starting with 10 minutes and tuning from real data is a reasonable compromise, and the clean-up job and "expired holds count as available" rule limit the damage.

5. **Never oversell vs sometimes under-sell.** We prefer to reject a request (a `409` or a `503`) over ever selling a seat twice. This means that in a failure some seats could briefly sit unsold until the clean-up job frees them. Selling a seat twice is far more costly (refunds, anger, lost trust) than a few seats being offered a minute late.

6. **Cost of pre-scaling vs risk.** Starting extra servers and database capacity for a few hours around a big sale costs money that the quiet days do not need, but the alternative is risking a failure at the moment that matters most for revenue and reputation.
