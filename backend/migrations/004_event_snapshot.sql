ALTER TABLE orders ADD COLUMN event_snapshot jsonb;
UPDATE orders o SET event_snapshot=jsonb_build_object('id',e.id,'startsAt',e.starts_at,'endsAt',e.ends_at,'cutoffAt',e.cutoff_at,'location',e.location,'pickupWindow',e.pickup_window,'timezone',e.timezone) FROM events e WHERE e.id=o.event_id;
