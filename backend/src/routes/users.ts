// backend/src/routes/users.ts
import { Router } from 'express'
import { pool } from '../db.js'
const router = Router()

router.get('/:id/donations', async (req, res) => {
    const userId = req.params.id
    try {
        const d = await pool.query(
            `SELECT d.id, d.donor_id, d.date, d.status
       FROM donations d
       WHERE d.donor_id = $1
       ORDER BY d.date DESC`,
            [userId]
        )

        const donationIds = d.rows.map(r => r.id)
        let itemsByDonation: Record<string, any[]> = {}
        if (donationIds.length) {
            const it = await pool.query(
                `SELECT di.donation_id, i.id, i.name, i.qty, i.unit, i.storage, i.expires_on
         FROM donation_items di
         JOIN items i ON i.id = di.item_id
         WHERE di.donation_id = ANY ($1::uuid[])`,
                [donationIds]
            )
            for (const row of it.rows) {
                (itemsByDonation[row.donation_id] ||= []).push({
                    id: row.id,
                    name: row.name,
                    qty: row.qty,
                    unit: row.unit,
                    storage: row.storage,
                    expiresOn: row.expires_on,
                })
            }
        }

        const donations = d.rows.map(r => ({
            id: r.id,
            donorId: r.donor_id,
            date: r.date,
            status: r.status,
            items: itemsByDonation[r.id] || [],
        }))

        res.json(donations)
    } catch (e) {
        console.error(e)
        res.status(500).json({ message: 'Failed to load donations' })
    }
})

export default router
