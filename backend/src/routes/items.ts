// backend/src/routes/items.ts
import { Router } from 'express'
import { pool } from '../db.js'
const router = Router()

router.post('/:id/images', async (req, res) => {
    const itemId = req.params.id
    const { objectKey, publicUrl, alt, isPrimary } = req.body as {
        objectKey: string
        publicUrl?: string
        alt?: string
        isPrimary?: boolean
    }
    if (!objectKey) return res.status(400).json({ message: 'objectKey required' })

    try {
        if (isPrimary) {
            await pool.query(`UPDATE item_images SET is_primary = false WHERE item_id = $1`, [itemId])
        }
        const ins = await pool.query(
            `INSERT INTO item_images (item_id, object_key, url, alt, is_primary)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, item_id, object_key, url, alt, is_primary`,
            [itemId, objectKey, publicUrl ?? null, alt ?? null, !!isPrimary]
        )
        res.json(ins.rows[0])
    } catch (e) {
        console.error(e)
        res.status(500).json({ message: 'Failed to save image metadata' })
    }
})

router.get('/:id/images', async (req, res) => {
    const itemId = req.params.id
    try {
        const q = await pool.query(
            `SELECT id, item_id, object_key, url, alt, is_primary
       FROM item_images WHERE item_id = $1 ORDER BY is_primary DESC, created_at DESC`,
            [itemId]
        )
        res.json(q.rows)
    } catch (e) {
        console.error(e)
        res.status(500).json({ message: 'Failed to fetch images' })
    }
})

export default router
