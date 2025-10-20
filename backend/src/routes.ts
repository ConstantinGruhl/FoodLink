import { Router } from 'express'
import { pool } from './db.js'

const r = Router()

// Health
r.get('/health', (_req, res) => res.json({ ok: true }))

// Impact public
r.get('/impact', async (_req, res) => {
    const { rows } = await pool.query('SELECT * FROM impact LIMIT 1')
    res.json(rows[0] ?? {})
})

// Items (recipient view = non-surplus)
r.get('/items', async (req, res) => {
    const surplus = req.query.surplus === 'true'
    const { rows } = await pool.query(
        'SELECT * FROM items WHERE is_surplus = $1 AND qty > 0 ORDER BY name',
        [surplus]
    )
    res.json(rows)
})

// Events
r.get('/events/next', async (_req, res) => {
    const { rows } = await pool.query('SELECT * FROM events ORDER BY date ASC LIMIT 1')
    res.json(rows[0] ?? null)
})

// Quick auth mock: login by email (demo only)
r.post('/auth/login', async (req, res) => {
    const { email } = req.body ?? {}
    if (!email) return res.status(400).json({ error: 'email required' })
    const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email])
    const user = rows[0]
    if (!user) return res.status(404).json({ error: 'user not found' })
    res.json(user)
})

// Reserve item (recipient)
r.post('/orders/reserve', async (req, res) => {
    const { userId, itemId, qty } = req.body
    if (!userId || !itemId || !qty) return res.status(400).json({ error: 'missing fields' })

    await pool.query('BEGIN')
    const { rows: itemRows } = await pool.query('SELECT * FROM items WHERE id=$1 FOR UPDATE', [itemId])
    const item = itemRows[0]
    if (!item) { await pool.query('ROLLBACK'); return res.status(404).json({ error: 'item not found' }) }
    if (item.qty < qty) { await pool.query('ROLLBACK'); return res.status(400).json({ error: 'not enough quantity' }) }

    await pool.query('UPDATE items SET qty = qty - $1 WHERE id=$2', [qty, itemId])
    const { rows: evRows } = await pool.query('SELECT id FROM events ORDER BY date ASC LIMIT 1')
    const eventId = evRows[0]?.id ?? null
    const { rows: orderRows } = await pool.query(
        `INSERT INTO orders (user_id, type, event_id)
     VALUES ($1, 'recipient-reservation', $2) RETURNING *`,
        [userId, eventId]
    )
    const orderId = orderRows[0].id
    await pool.query(
        `INSERT INTO order_items (order_id,item_id,qty) VALUES ($1,$2,$3)`,
        [orderId, itemId, qty]
    )
    await pool.query('COMMIT')
    res.json({ orderId })
})

// Buyer checkout (surplus)
r.post('/orders/buy', async (req, res) => {
    const { userId, cart = [], supportContributionCents = 0 } = req.body
    if (!userId || !Array.isArray(cart) || cart.length === 0) {
        return res.status(400).json({ error: 'invalid cart' })
    }
    await pool.query('BEGIN')
    let total = 0
    for (const { itemId, qty } of cart) {
        const { rows } = await pool.query('SELECT * FROM items WHERE id=$1 AND is_surplus=true FOR UPDATE', [itemId])
        const it = rows[0]
        if (!it) { await pool.query('ROLLBACK'); return res.status(404).json({ error: `item ${itemId} not found` }) }
        if (it.qty < qty) { await pool.query('ROLLBACK'); return res.status(400).json({ error: 'not enough quantity' }) }
        total += (it.price_cents ?? 0) * qty
        await pool.query('UPDATE items SET qty = qty - $1 WHERE id=$2', [qty, itemId])
    }
    total += supportContributionCents
    const { rows: evRows } = await pool.query('SELECT id FROM events ORDER BY date ASC LIMIT 1')
    const eventId = evRows[0]?.id ?? null
    const { rows: orderRows } = await pool.query(
        `INSERT INTO orders (user_id, type, event_id, total_cents, support_contribution_cents)
     VALUES ($1,'buyer-order',$2,$3,$4) RETURNING *`,
        [userId, eventId, total, supportContributionCents]
    )
    const orderId = orderRows[0].id
    for (const { itemId, qty } of cart) {
        await pool.query('INSERT INTO order_items (order_id,item_id,qty) VALUES ($1,$2,$3)', [orderId, itemId, qty])
    }
    await pool.query('COMMIT')
    res.json({ orderId, totalCents: total })
})

export default r
