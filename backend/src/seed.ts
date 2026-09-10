import { pool, transaction } from './db.js'
import { migrate } from './migrate.js'
import { hashPassword } from './security.js'
import { passwordSchema } from './auth.js'
import { movement } from './inventory.js'
async function seed() {
  if (process.env.SEED_DEMO !== 'true' || process.env.NODE_ENV === 'production')
    throw new Error('Demo seed requires SEED_DEMO=true and a non-production environment')
  const password = passwordSchema.parse(process.env.DEMO_PASSWORD)
  await migrate()
  const encoded = await hashPassword(password)
  await transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(742193004)')
    for (const role of ['admin', 'donor', 'recipient', 'buyer', 'volunteer'])
      await db.query(
        'INSERT INTO users(email,name,role,password_hash,verified,email_verified,household_size) VALUES($1,$2,$3,$4,true,true,$5) ON CONFLICT(email) DO UPDATE SET password_hash=CASE WHEN users.password_hash IS NULL THEN excluded.password_hash ELSE users.password_hash END,email_verified=CASE WHEN users.password_hash IS NULL THEN true ELSE users.email_verified END',
        [`${role}@email.com`, `Demo ${role}`, role, encoded, role === 'recipient' ? 4 : null],
      )
    const donor = (await db.query("SELECT id FROM users WHERE email='donor@email.com'")).rows[0]
    if (
      !(
        await db.query("SELECT 1 FROM donations WHERE donor_id=$1 AND notes='Explicit demo seed'", [donor.id])
      ).rowCount
    ) {
      const donation = (
        await db.query(
          "INSERT INTO donations(donor_id,date,status,received_at,notes) VALUES($1,now(),'received',now(),'Explicit demo seed') RETURNING id",
          [donor.id],
        )
      ).rows[0]
      for (const [name, qty, unit, weight, surplus, price, storage, category, allergens] of [
        ['Rice', 20, 'bag', 1000, false, 0, 'ambient', 'pantry', []],
        ['Apples', 100, 'piece', 150, false, 0, 'ambient', 'produce', []],
        ['Yogurt', 40, 'cup', 200, true, 50, 'chilled', 'dairy', ['milk']],
      ] as const) {
        const item = (
          await db.query(
            "INSERT INTO items(name,qty,unit,storage,expires_on,donor_id,weight_grams,is_surplus,price_cents,category,allergens,handling_notes) VALUES($1,$2,$3,$8,now()+interval '14 days',$4,$5,$6,$7,$9,$10,'Synthetic demo food; check the real product label and receiving conditions when using actual food.') RETURNING id",
            [name, qty, unit, donor.id, weight, surplus, price, storage, category, allergens],
          )
        ).rows[0]
        await db.query(
          'INSERT INTO donation_items(donation_id,item_id,offered_qty,received_qty,name_snapshot,unit_snapshot) VALUES($1,$2,$3,$3,$4,$5)',
          [donation.id, item.id, qty, name, unit],
        )
        await movement(db, item.id, qty, 'receipt', null, null, 'Explicit demo seed')
      }
    }
    // Repair only untouched metadata from the first version of this explicit demo seed.
    await db.query(
      "UPDATE items i SET storage=CASE WHEN i.name='Yogurt' THEN 'chilled' ELSE 'ambient' END,category=CASE i.name WHEN 'Yogurt' THEN 'dairy' WHEN 'Rice' THEN 'pantry' ELSE 'produce' END,allergens=CASE WHEN i.name='Yogurt' THEN ARRAY['milk'] ELSE ARRAY[]::text[] END,handling_notes='Synthetic demo food; check the real product label and receiving conditions when using actual food.' FROM donation_items di JOIN donations d ON d.id=di.donation_id WHERE i.id=di.item_id AND d.notes='Explicit demo seed' AND i.category='other' AND coalesce(i.handling_notes,'')='' AND i.name IN ('Rice','Apples','Yogurt')",
    )
    if (!(await db.query("SELECT 1 FROM events WHERE starts_at>now() AND status='scheduled'")).rowCount)
      await db.query(
        "INSERT INTO events(date,starts_at,ends_at,cutoff_at,location,pickup_window,allow_delivery,capacity) VALUES(now()+interval '2 days',now()+interval '2 days',now()+interval '2 days 3 hours',now()+interval '1 day 23 hours','Demo community distribution hall','See event times',true,100)",
      )
  })
  console.log('Explicit demo seed complete; existing account passwords and data were preserved')
}
seed()
  .then(() => pool.end())
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
    void pool.end()
  })
