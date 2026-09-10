CREATE TABLE organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE NOT NULL, name text NOT NULL,
 currency text NOT NULL DEFAULT 'EUR', timezone text NOT NULL DEFAULT 'Europe/Berlin',
 support_email text NOT NULL DEFAULT '', address text NOT NULL DEFAULT '', privacy_contact text NOT NULL DEFAULT '',
 active boolean NOT NULL DEFAULT true, policies jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE locations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id),
 name text NOT NULL, code text NOT NULL, address text NOT NULL DEFAULT '', city text NOT NULL DEFAULT '', postal_code text NOT NULL DEFAULT '',
 latitude double precision CHECK(latitude BETWEEN -90 AND 90), longitude double precision CHECK(longitude BETWEEN -180 AND 180),
 opening_hours text NOT NULL DEFAULT '', receiving_instructions text NOT NULL DEFAULT '', collection_available boolean NOT NULL DEFAULT false,
 storage_types text[] NOT NULL DEFAULT ARRAY['ambient'], active boolean NOT NULL DEFAULT true, settings jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(org_id,code), UNIQUE(id,org_id)
);
INSERT INTO organizations(id,slug,name,policies) SELECT '00000000-0000-4000-8000-000000000001','foodlink','FoodLink Community',data FROM organization_config WHERE id=1;
INSERT INTO locations(id,org_id,name,code,address,storage_types) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Community distribution centre','CENTRAL','Existing prototype location',ARRAY['ambient','chilled','frozen']);
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('recipient','buyer','donor','volunteer','admin','charity_manager','location_manager'));
ALTER TABLE users ADD COLUMN platform_admin boolean NOT NULL DEFAULT false;
UPDATE users SET platform_admin=true WHERE role='admin';
CREATE TABLE staff_memberships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), org_id uuid NOT NULL REFERENCES organizations(id),
 location_id uuid, role text NOT NULL CHECK(role IN ('charity_manager','location_manager','volunteer')), duties text[] NOT NULL DEFAULT '{}',
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(location_id,org_id) REFERENCES locations(id,org_id), CHECK((role='charity_manager' AND location_id IS NULL) OR (role<>'charity_manager' AND location_id IS NOT NULL))
);
CREATE UNIQUE INDEX staff_membership_scope ON staff_memberships(user_id,org_id,coalesce(location_id,'00000000-0000-4000-8000-000000000000'::uuid));
INSERT INTO staff_memberships(user_id,org_id,location_id,role,duties)
 SELECT id,'00000000-0000-4000-8000-000000000001',CASE WHEN role='admin' THEN NULL ELSE '00000000-0000-4000-8000-000000000001'::uuid END,
 CASE WHEN role='admin' THEN 'charity_manager' ELSE 'volunteer' END,ARRAY['receive','inventory','events','checkin','delivery'] FROM users WHERE role IN ('admin','volunteer');
CREATE TABLE households (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id), label text NOT NULL,
 approved_size int NOT NULL DEFAULT 1 CHECK(approved_size BETWEEN 1 AND 30), requested_size int CHECK(requested_size BETWEEN 1 AND 30),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','paused')), notes text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,org_id)
);
CREATE TABLE household_members (
 household_id uuid NOT NULL, org_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
 PRIMARY KEY(household_id,user_id), UNIQUE(org_id,user_id), FOREIGN KEY(household_id,org_id) REFERENCES households(id,org_id)
);
INSERT INTO households(id,org_id,label,approved_size,status) SELECT id,'00000000-0000-4000-8000-000000000001',name||' household',greatest(1,least(30,coalesce(household_size,1))),CASE WHEN verified THEN 'approved' ELSE 'pending' END FROM users WHERE role='recipient';
INSERT INTO household_members(household_id,org_id,user_id) SELECT id,'00000000-0000-4000-8000-000000000001',id FROM users WHERE role='recipient';
CREATE TABLE staff_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id), location_id uuid,
 email text NOT NULL, role text NOT NULL CHECK(role IN ('charity_manager','location_manager','volunteer')), duties text[] NOT NULL DEFAULT '{}',
 token_hash text UNIQUE NOT NULL, expires_at timestamptz NOT NULL, accepted_at timestamptz, revoked_at timestamptz,
 invited_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(location_id,org_id) REFERENCES locations(id,org_id), CHECK((role='charity_manager' AND location_id IS NULL) OR (role<>'charity_manager' AND location_id IS NOT NULL))
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['items','donations','events','orders','tasks'] LOOP
  EXECUTE format('ALTER TABLE %I ADD COLUMN org_id uuid NOT NULL DEFAULT %L REFERENCES organizations(id), ADD COLUMN location_id uuid NOT NULL DEFAULT %L',t,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001');
  EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY(location_id,org_id) REFERENCES locations(id,org_id)',t);
  EXECUTE format('CREATE INDEX %I ON %I(location_id)',t||'_location',t);
 END LOOP;
END $$;
ALTER TABLE events ADD UNIQUE(id,location_id,org_id);
ALTER TABLE orders ADD FOREIGN KEY(event_id,location_id,org_id) REFERENCES events(id,location_id,org_id);
ALTER TABLE tasks ADD FOREIGN KEY(event_id,location_id,org_id) REFERENCES events(id,location_id,org_id);
ALTER TABLE audit_log ADD COLUMN org_id uuid REFERENCES organizations(id), ADD COLUMN location_id uuid REFERENCES locations(id);
ALTER TABLE mail_outbox ADD COLUMN org_id uuid REFERENCES organizations(id);
CREATE INDEX audit_scope ON audit_log(org_id,location_id,created_at);
CREATE OR REPLACE FUNCTION enforce_stock_line_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_location uuid; item_location uuid; BEGIN
 IF TG_TABLE_NAME='donation_items' THEN SELECT location_id INTO parent_location FROM donations WHERE id=NEW.donation_id;
 ELSE SELECT location_id INTO parent_location FROM orders WHERE id=NEW.order_id; END IF;
 SELECT location_id INTO item_location FROM items WHERE id=NEW.item_id;
 IF parent_location IS DISTINCT FROM item_location THEN RAISE EXCEPTION 'Food and transaction must belong to the same location' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER donation_line_scope BEFORE INSERT OR UPDATE ON donation_items FOR EACH ROW EXECUTE FUNCTION enforce_stock_line_scope();
CREATE TRIGGER order_line_scope BEFORE INSERT OR UPDATE ON order_items FOR EACH ROW EXECUTE FUNCTION enforce_stock_line_scope();
INSERT INTO audit_log(action,entity_type,org_id,location_id,details) VALUES('schema.organization-upgrade','migration','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','{"note":"Existing records assigned to the default charity and location. Existing admin/volunteer memberships and recipient households migrated without replacing passwords or stock history."}');
