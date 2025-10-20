// backend/src/uploads.ts
import { Router } from "express"
import crypto from "crypto"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { pool } from "./db.js"

const r = Router()

const s3 = new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH === "true",
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY!,
        secretAccessKey: process.env.S3_SECRET_KEY!,
    },
})
const BUCKET = process.env.S3_BUCKET!

// 1) get a presigned URL for direct browser upload
r.post("/uploads/presign", async (req, res) => {
    const { itemId, contentType } = req.body || {}
    if (!itemId || !contentType) return res.status(400).json({ error: "itemId and contentType required" })

    const key = `items/${itemId}/${crypto.randomUUID()}`
    const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ContentType: contentType,
        ACL: process.env.S3_ACL_PUBLIC === "true" ? "public-read" : undefined,
    })

    const url = await getSignedUrl(s3, command, { expiresIn: 60 })
    const publicUrl = process.env.S3_PUBLIC_BASE_URL ? `${process.env.S3_PUBLIC_BASE_URL}/${key}` : undefined
    res.json({ url, objectKey: key, publicUrl })
})

// 2) save metadata after upload (uses your new item_images table)
r.post("/items/:id/images", async (req, res) => {
    const { id } = req.params
    const { objectKey, publicUrl, alt, width, height, isPrimary } = req.body || {}
    if (!objectKey) return res.status(400).json({ error: "objectKey required" })

    const { rows } = await pool.query(
        `INSERT INTO item_images (item_id, object_key, url, alt, width, height, is_primary)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
        [id, objectKey, publicUrl ?? null, alt ?? null, width ?? null, height ?? null, !!isPrimary]
    )

    if (isPrimary) {
        await pool.query(
            `UPDATE item_images SET is_primary = FALSE WHERE item_id = $1 AND id <> $2`,
            [id, rows[0].id]
        )
    }
    res.json(rows[0])
})

// 3) list images for an item
r.get("/items/:id/images", async (req, res) => {
    const { id } = req.params
    const { rows } = await pool.query(
        `SELECT id, object_key, url, alt, width, height, is_primary
     FROM item_images WHERE item_id = $1 ORDER BY is_primary DESC, created_at DESC`, [id]
    )
    res.json(rows)
})

export default r
