-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('recipient','buyer','donor','volunteer','admin')),
  verified BOOLEAN DEFAULT FALSE,
  ngo_code TEXT,
  household_size INT,
  dietary_needs TEXT[],
  special_requirements TEXT,
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Items
CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  qty INT NOT NULL CHECK (qty >= 0),
  unit TEXT,
  storage TEXT NOT NULL CHECK (storage IN ('ambient','chilled','frozen')),
  expires_on TIMESTAMPTZ,
  donor_id UUID REFERENCES users(id),
  image_url TEXT,
  price_cents INT,
  is_surplus BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS item_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,            -- e.g. items/<itemId>/<uuid>.jpg
  url TEXT,                            -- optional cached URL (can be rebuilt)
  alt TEXT,
  width INT,
  height INT,
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_item_images_item ON item_images(item_id);
CREATE INDEX IF NOT EXISTS idx_item_images_primary ON item_images(item_id, is_primary);

-- Events
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date TIMESTAMPTZ NOT NULL,
  location TEXT NOT NULL,
  pickup_window TEXT NOT NULL,
  allow_delivery BOOLEAN DEFAULT TRUE
);

-- Donations
CREATE TABLE IF NOT EXISTS donations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id UUID REFERENCES users(id) NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled','received','distributed','cancelled')) DEFAULT 'scheduled'
);

-- Donation items link (1..n items per donation)
CREATE TABLE IF NOT EXISTS donation_items (
  donation_id UUID REFERENCES donations(id) ON DELETE CASCADE,
  item_id UUID REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (donation_id, item_id)
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('recipient-reservation','buyer-order')),
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','picked-up','delivered','cancelled')) DEFAULT 'confirmed',
  event_id UUID REFERENCES events(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  support_contribution_cents INT,
  total_cents INT
);

-- Order lines
CREATE TABLE IF NOT EXISTS order_items (
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  item_id UUID REFERENCES items(id) ON DELETE CASCADE,
  qty INT NOT NULL CHECK (qty > 0),
  PRIMARY KEY (order_id, item_id)
);

-- Impact (single row)
CREATE TABLE IF NOT EXISTS impact (
  id INT PRIMARY KEY DEFAULT 1,
  total_meals_distributed INT DEFAULT 0,
  total_kg_saved INT DEFAULT 0,
  total_donors INT DEFAULT 0,
  total_buyers INT DEFAULT 0
);

INSERT INTO impact (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- Dev seed users (easy emails)
INSERT INTO users (email, name, role, verified, household_size, dietary_needs)
VALUES
  ('admin@email.com',     'Platform Admin',    'admin',     TRUE, NULL, NULL),
  ('recipient@email.com',     'Recipient',            'recipient', TRUE, 4,    ARRAY['halal']),
  ('buyer@email.com',     'Beth Buyer',        'buyer',     TRUE, NULL, NULL),
  ('donor@email.com',     'Dave Donor Co.',    'donor',     TRUE, NULL, NULL),
  ('volunteer@email.com', 'Victor Volunteer',  'volunteer', TRUE, NULL, NULL)
ON CONFLICT (email) DO NOTHING;

-- Sample items (explicit casts to avoid UNION type mismatches)
WITH d AS (
  SELECT id::uuid AS id
  FROM users
  WHERE email = 'donor@email.com'
  LIMIT 1
)
INSERT INTO items (name, qty, unit, storage, donor_id, expires_on, is_surplus, price_cents)
SELECT
  'Rice (5kg)'::text,
  20::int,
  'bag'::text,
  'ambient'::text,
  d.id,
  NULL::timestamptz,
  FALSE::boolean,
  NULL::int
FROM d
UNION ALL
SELECT
  'Chicken Breast'::text,
  50::int,
  'pack'::text,
  'chilled'::text,
  d.id,
  (NOW() + INTERVAL '7 days')::timestamptz,
  FALSE::boolean,
  NULL::int
FROM d
UNION ALL
SELECT
  'Yogurt'::text,
  40::int,
  'cup'::text,
  'chilled'::text,
  d.id,
  (NOW() + INTERVAL '5 days')::timestamptz,
  TRUE::boolean,
  50::int
FROM d
UNION ALL
SELECT
  'Apples'::text,
  100::int,
  'pcs'::text,
  'ambient'::text,
  d.id,
  NULL::timestamptz,
  FALSE::boolean,
  NULL::int
FROM d;

-- Next Saturday event (always future Saturday)
INSERT INTO events (date, location, pickup_window, allow_delivery)
SELECT
  date_trunc('day', NOW()) +
  (
    CASE
      WHEN EXTRACT(DOW FROM NOW())::int = 6 THEN 7
      ELSE ((6 - EXTRACT(DOW FROM NOW())::int + 7) % 7)
    END
  ) * INTERVAL '1 day' AS date,
  'Community Hall, Main St.'::text,
  '10:00–13:00'::text,
  TRUE
WHERE NOT EXISTS (SELECT 1 FROM events);
