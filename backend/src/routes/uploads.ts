// backend/src/routes/uploads.ts
import { Router } from 'express'
import crypto from 'crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const router = Router()

const s3 = new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT, // http://minio:9000 for docker network, or http://localhost:9000 for local
    forcePathStyle: true,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY!,
        secretAccessKey: process.env.S3_SECRET_KEY!,
    },
})
const BUCKET = process.env.S3_BUCKET! // e.g. foodlink

router.post('/presign', async (req, res) => {
    const { itemId, contentType } = req.body as { itemId: string; contentType: string }
    if (!itemId || !contentType) return res.status(400).json({ message: 'itemId and contentType required' })

    const objectKey = `items/${itemId}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}`
    const cmd = new PutObjectCommand({
        Bucket: BUCKET,
        Key: objectKey,
        ContentType: contentType,
        ACL: process.env.S3_PUBLIC_ACL === 'true' ? 'public-read' : undefined,
    })
    const url = await getSignedUrl(s3, cmd, { expiresIn: 300 })

    // Public URL only if bucket is public (dev)
    const publicUrl = process.env.S3_PUBLIC_BASE
        ? `${process.env.S3_PUBLIC_BASE}/${objectKey}`
        : undefined

    res.json({ url, objectKey, publicUrl })
})

export default router
