CREATE TABLE food_types (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL, category text NOT NULL DEFAULT 'other', unit text NOT NULL, storage text NOT NULL CHECK(storage IN ('ambient','chilled','frozen')),
 pack_size text NOT NULL DEFAULT '', default_price_cents int NOT NULL DEFAULT 0 CHECK(default_price_cents>=0), active boolean NOT NULL DEFAULT true,
 UNIQUE(org_id,name,unit)
);
ALTER TABLE items ADD COLUMN food_type_id uuid REFERENCES food_types(id);
ALTER TABLE items ADD COLUMN pack_size text NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN date_label_type text NOT NULL DEFAULT 'none' CHECK(date_label_type IN ('none','use_by','best_before'));
ALTER TABLE items ADD COLUMN date_label_on timestamptz;
ALTER TABLE items ADD COLUMN distribution_deadline timestamptz;
ALTER TABLE items ADD COLUMN allergen_status text NOT NULL DEFAULT 'unknown' CHECK(allergen_status IN ('unknown','declared'));
ALTER TABLE items ADD COLUMN source_reference text NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN sale_permission text NOT NULL DEFAULT 'unknown' CHECK(sale_permission IN ('unknown','allowed','prohibited'));
ALTER TABLE items ADD COLUMN transfer_permission text NOT NULL DEFAULT 'unknown' CHECK(transfer_permission IN ('unknown','allowed','prohibited'));
ALTER TABLE items ADD COLUMN inspection_status text NOT NULL DEFAULT 'clear' CHECK(inspection_status IN ('clear','quarantined','recalled'));
ALTER TABLE items ADD COLUMN inspection_reason text NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN protected_qty int NOT NULL DEFAULT 0 CHECK(protected_qty>=0);
ALTER TABLE items ADD COLUMN sale_qty int NOT NULL DEFAULT 0 CHECK(sale_qty>=0);
ALTER TABLE items ADD COLUMN sale_mode text NOT NULL DEFAULT 'manual' CHECK(sale_mode IN ('manual','suggested','automatic'));
ALTER TABLE items ADD COLUMN sale_reason text NOT NULL DEFAULT '';
ALTER TABLE items ADD COLUMN parent_batch_id uuid REFERENCES items(id);
UPDATE items SET distribution_deadline=expires_on;
-- Legacy surplus is paused until a manager records source permission and charity policy.
UPDATE items SET is_surplus=false;
ALTER TABLE items ADD CONSTRAINT inventory_allocations_fit CHECK(protected_qty+sale_qty<=qty);
ALTER TABLE donations ADD COLUMN submission_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE donations ADD COLUMN donor_reference text NOT NULL DEFAULT '';
ALTER TABLE donations ADD COLUMN donor_type text NOT NULL DEFAULT 'private' CHECK(donor_type IN ('private','business'));
ALTER TABLE donations ADD COLUMN fulfillment text NOT NULL DEFAULT 'dropoff' CHECK(fulfillment IN ('dropoff','collection'));
ALTER TABLE donations ADD COLUMN collection_address text NOT NULL DEFAULT '';
ALTER TABLE donations ADD COLUMN acceptance_status text NOT NULL DEFAULT 'pending' CHECK(acceptance_status IN ('pending','accepted','review'));
ALTER TABLE donations ADD COLUMN acceptance_reason text NOT NULL DEFAULT '';
ALTER TABLE donation_items ADD COLUMN rejected_qty int NOT NULL DEFAULT 0 CHECK(rejected_qty>=0);
ALTER TABLE donation_items ADD COLUMN rejection_reason text NOT NULL DEFAULT '';
ALTER TABLE donation_items ADD COLUMN condition text NOT NULL DEFAULT 'unchecked' CHECK(condition IN ('unchecked','good','rejected'));
CREATE UNIQUE INDEX donation_external_reference ON donations(donor_id,location_id,donor_reference) WHERE donor_reference<>'';
CREATE TABLE acceptance_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id), location_id uuid REFERENCES locations(id),
 category text NOT NULL, state text NOT NULL CHECK(state IN ('allowed','approval_required','paused','prohibited')), reason text NOT NULL,
 starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz, max_qty int CHECK(max_qty>0), unit text,
 donor_type text NOT NULL DEFAULT 'any' CHECK(donor_type IN ('any','private','business')), storage text CHECK(storage IN ('ambient','chilled','frozen')),
 min_shelf_hours int NOT NULL DEFAULT 0 CHECK(min_shelf_hours>=0), safety_restriction boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(ends_at IS NULL OR ends_at>starts_at)
);
CREATE INDEX acceptance_rules_scope ON acceptance_rules(org_id,location_id,category);
CREATE TABLE food_needs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id), location_id uuid NOT NULL REFERENCES locations(id),
 title text NOT NULL, category text NOT NULL, qty int NOT NULL CHECK(qty>0), unit text NOT NULL, deadline timestamptz NOT NULL,
 substitutions text NOT NULL DEFAULT '', instructions text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE need_pledges (
 need_id uuid NOT NULL REFERENCES food_needs(id), donation_id uuid NOT NULL REFERENCES donations(id), item_id uuid NOT NULL REFERENCES items(id),
 promised_qty int NOT NULL CHECK(promised_qty>0), received_qty int NOT NULL DEFAULT 0 CHECK(received_qty>=0), cancelled boolean NOT NULL DEFAULT false,
 PRIMARY KEY(need_id,donation_id,item_id)
);
CREATE TABLE stock_transfers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id), source_location_id uuid NOT NULL REFERENCES locations(id),
 destination_location_id uuid NOT NULL REFERENCES locations(id), item_id uuid NOT NULL REFERENCES items(id), destination_item_id uuid REFERENCES items(id),
 qty int NOT NULL CHECK(qty>0), received_qty int CHECK(received_qty>=0), status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','accepted','dispatched','received','cancelled')),
 reason text NOT NULL, variance_reason text NOT NULL DEFAULT '', created_by uuid NOT NULL REFERENCES users(id), accepted_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), dispatched_at timestamptz, received_at timestamptz, CHECK(source_location_id<>destination_location_id), CHECK(received_qty IS NULL OR received_qty<=qty)
);
CREATE TABLE import_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), location_id uuid REFERENCES locations(id),
 kind text NOT NULL CHECK(kind IN ('donations','stock_count','leftovers')), content_hash text NOT NULL, file_name text NOT NULL,
 rows jsonb NOT NULL, errors jsonb NOT NULL DEFAULT '[]', mapping jsonb NOT NULL DEFAULT '{}', result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz, UNIQUE(user_id,kind,content_hash)
);
CREATE TABLE donor_import_mappings (user_id uuid PRIMARY KEY REFERENCES users(id), mapping jsonb NOT NULL DEFAULT '{}');
CREATE TABLE donor_arrangements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), donor_id uuid NOT NULL REFERENCES users(id), location_id uuid NOT NULL REFERENCES locations(id),
 title text NOT NULL, frequency text NOT NULL CHECK(frequency IN ('weekly','fortnightly','monthly')), next_at timestamptz NOT NULL,
 template jsonb NOT NULL, active boolean NOT NULL DEFAULT true, last_donation_id uuid REFERENCES donations(id), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE inventory_movements DROP CONSTRAINT inventory_movements_kind_check;
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_kind_check CHECK(kind IN ('opening','receipt','reserve','restock','dispose','expire','transfer_dispatch','transfer_receipt','count','event_allocate','event_return','event_distribute','event_loss','event_leftovers'));
