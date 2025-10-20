// backend/src/routes/donations.ts
import { Router } from 'express'
import { pool } from '../db.js'

const router = Router()

router.post('/', async (req, res) => {
    const { donorId, items } = req.body as {
        donorId: string
        items: Array<{ name: string; qty: number; unit?: string | null; storage: 'ambient' | 'chilled' | 'frozen'; expiresOn?: string }>
    }

    if (!donorId || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: 'donorId and items[] are required' })
    }

    const client = await pool.connect()
    try {
        await client.query('BEGIN')

        const d = await client.query(
            `INSERT INTO donations (donor_id, date, status)
       VALUES ($1, NOW(), 'scheduled')
       RETURNING id, donor_id, date, status`,
            [donorId]
        )
        const donation = d.rows[0]

        const createdItems: any[] = []
        for (const it of items) {
            const i = await client.query(
                `INSERT INTO items (name, qty, unit, storage, expires_on, donor_id, is_surplus)
         VALUES ($1,$2,$3,$4,$5,$6,false)
         RETURNING id, name, qty, unit, storage, expires_on`,
                [it.name, it.qty, it.unit ?? null, it.storage, it.expiresOn ?? null, donorId]
            )
            const item = i.rows[0]
            createdItems.push(item)
            await client.query(
                `INSERT INTO donation_items (donation_id, item_id) VALUES ($1,$2)`,
                [donation.id, item.id]
            )
        }

        await client.query('COMMIT')
        res.json({ donationId: donation.id, items: createdItems })
    } catch (e: any) {
        await client.query('ROLLBACK')
        console.error(e)
        res.status(500).json({ message: 'Failed to create donation' })
    } finally {
        client.release()
    }
})

export default router
