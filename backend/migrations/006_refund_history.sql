ALTER TABLE orders ADD COLUMN superseded_refund_ids text[] NOT NULL DEFAULT '{}';
ALTER TABLE orders DROP CONSTRAINT orders_refund_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_refund_status_check CHECK(refund_status IN ('pending','succeeded','failed','canceled','requires_action'));
