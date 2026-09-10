CREATE UNIQUE INDEX orders_payment_intent_unique ON orders(stripe_payment_intent) WHERE stripe_payment_intent IS NOT NULL;
ALTER TABLE orders ADD COLUMN refund_id text;
ALTER TABLE orders ADD COLUMN refund_status text CHECK(refund_status IN ('pending','succeeded','failed','canceled'));
ALTER TABLE orders ADD COLUMN refund_attempt int NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN refund_failures int NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN refund_next_at timestamptz DEFAULT now();
ALTER TABLE orders ADD COLUMN refund_error text;
