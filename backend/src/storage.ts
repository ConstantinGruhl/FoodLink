import { randomUUID } from 'node:crypto'
import express, { Router } from 'express'
import sharp from 'sharp'
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { config } from './config.js'
import { pool, transaction } from './db.js'
import { ApiError, route, id } from './http.js'
import { requireAuth, assertOwner, rateLimit } from './security.js'
import { imageDto } from './models.js'
import { audit } from './communications.js'
export const storage = Router()
export const s3 = new S3Client({
  region: config.s3Region,
  endpoint: config.s3Endpoint,
  forcePathStyle: config.s3ForcePath,
  credentials:
    config.s3AccessKey && config.s3SecretKey
      ? { accessKeyId: config.s3AccessKey, secretAccessKey: config.s3SecretKey }
      : undefined,
  maxAttempts: 3,
})
export async function storageReady() {
  await s3.send(new HeadBucketCommand({ Bucket: config.s3Bucket }))
}
export async function initializeStorage() {
  try {
    await storageReady()
  } catch (error) {
    if (!config.autoCreateBucket) throw error
    await s3.send(new CreateBucketCommand({ Bucket: config.s3Bucket }))
    await storageReady()
  }
}
export async function validateImage(body: Buffer, contentType: string) {
  if (!Buffer.isBuffer(body) || body.length < 12 || body.length > 5 * 1024 * 1024)
    throw new ApiError(400, 'INVALID_IMAGE', 'Upload a JPEG, PNG, or WebP image of at most 5 MB')
  const magic = body.subarray(0, 12)
  const type =
    magic[0] === 255 && magic[1] === 216 && magic[2] === 255
      ? 'image/jpeg'
      : magic.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'image/png'
        : magic.toString('ascii', 0, 4) === 'RIFF' && magic.toString('ascii', 8, 12) === 'WEBP'
          ? 'image/webp'
          : ''
  if (type !== contentType)
    throw new ApiError(415, 'INVALID_IMAGE_TYPE', 'Image contents do not match the declared type')
  try {
    const image = sharp(body, { limitInputPixels: 20000000, animated: false, failOn: 'warning' })
    const metadata = await image.metadata()
    if (!metadata.width || !metadata.height || metadata.width > 10000 || metadata.height > 10000)
      throw new Error('Invalid dimensions')
    const { data, info } = await image
      .rotate()
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true })
    return { data, width: info.width, height: info.height }
  } catch {
    throw new ApiError(400, 'INVALID_IMAGE', 'This image cannot be decoded safely')
  }
}
async function imageItem(req: import('express').Request, itemId: string, write = false) {
  const item = (await pool.query('SELECT * FROM items WHERE id=$1', [itemId])).rows[0]
  if (!item) throw new ApiError(404, 'NOT_FOUND', 'Item not found')
  if (write) assertOwner(req, item.donor_id)
  else if (item.status === 'offered' || item.status === 'disposed') {
    if (!req.user) throw new ApiError(404, 'NOT_FOUND', 'Image not found')
    assertOwner(req, item.donor_id)
  }
  return item
}
storage.get(
  '/items/:id/images',
  route(async (req, res) => {
    await imageItem(req, id(req))
    res.json(
      (
        await pool.query('SELECT * FROM item_images WHERE item_id=$1 ORDER BY is_primary DESC,created_at', [
          id(req),
        ])
      ).rows.map(imageDto),
    )
  }),
)
storage.post(
  '/items/:id/images',
  requireAuth('donor', 'admin', 'volunteer'),
  rateLimit('uploads', 30, 3600),
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }),
  route(async (req, res) => {
    const itemId = id(req)
    await imageItem(req, itemId, true)
    const processed = await validateImage(req.body, req.get('Content-Type') || '')
    const alt = (req.get('X-Image-Alt') || 'Food donation').trim().slice(0, 200)
    const objectKey = `items/${itemId}/${randomUUID()}.webp`
    let uploaded = false
    try {
      const image = await transaction(async (db) => {
        await db.query('SELECT id FROM items WHERE id=$1 FOR UPDATE', [itemId])
        const count = Number(
          (await db.query('SELECT count(*) n FROM item_images WHERE item_id=$1', [itemId])).rows[0].n,
        )
        if (count >= 5) throw new ApiError(409, 'IMAGE_LIMIT', 'Each item supports at most five images')
        await s3.send(
          new PutObjectCommand({
            Bucket: config.s3Bucket,
            Key: objectKey,
            Body: processed.data,
            ContentType: 'image/webp',
            CacheControl: 'private, max-age=3600',
          }),
        )
        uploaded = true
        const { rows } = await db.query(
          "INSERT INTO item_images(item_id,object_key,alt,width,height,is_primary,content_type,size_bytes) VALUES($1,$2,$3,$4,$5,$6,'image/webp',$7) RETURNING *",
          [itemId, objectKey, alt, processed.width, processed.height, count === 0, processed.data.length],
        )
        await audit(db, req.user!.id, 'image.uploaded', 'item', itemId, { imageId: rows[0].id })
        return imageDto(rows[0])
      })
      res.status(201).json(image)
    } catch (error) {
      if (uploaded)
        await s3.send(new DeleteObjectCommand({ Bucket: config.s3Bucket, Key: objectKey })).catch(() => {})
      throw error
    }
  }),
)
storage.delete(
  '/items/:itemId/images/:id',
  requireAuth('donor', 'admin', 'volunteer'),
  route(async (req, res) => {
    const itemId = id(req, 'itemId')
    await imageItem(req, itemId, true)
    await transaction(async (db) => {
      await db.query('SELECT id FROM items WHERE id=$1 FOR UPDATE', [itemId])
      const image = (
        await db.query('SELECT * FROM item_images WHERE id=$1 AND item_id=$2 FOR UPDATE', [id(req), itemId])
      ).rows[0]
      if (!image) throw new ApiError(404, 'NOT_FOUND', 'Image not found')
      await db.query('DELETE FROM item_images WHERE id=$1', [image.id])
      await db.query(
        'UPDATE item_images SET is_primary=true WHERE id=(SELECT id FROM item_images WHERE item_id=$1 ORDER BY created_at LIMIT 1)',
        [itemId],
      )
      await audit(db, req.user!.id, 'image.deleted', 'item', itemId, { imageId: image.id })
    })
    res.json({ ok: true })
  }),
)
storage.get(
  '/images/:id/content',
  route(async (req, res) => {
    const image = (await pool.query('SELECT * FROM item_images WHERE id=$1', [id(req)])).rows[0]
    if (!image) throw new ApiError(404, 'NOT_FOUND', 'Image not found')
    await imageItem(req, image.item_id)
    try {
      const result = await s3.send(new GetObjectCommand({ Bucket: config.s3Bucket, Key: image.object_key }))
      if (!result.Body) throw new Error('Missing object')
      res.set({
        'Content-Type': image.content_type || 'image/webp',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
      })
      res.send(Buffer.from(await result.Body.transformToByteArray()))
    } catch {
      throw new ApiError(404, 'IMAGE_UNAVAILABLE', 'This image is temporarily unavailable')
    }
  }),
)
export async function cleanOrphanImages() {
  let continuation: string | undefined
  do {
    const result = await s3.send(
      new ListObjectsV2Command({
        Bucket: config.s3Bucket,
        Prefix: 'items/',
        ContinuationToken: continuation,
        MaxKeys: 100,
      }),
    )
    for (const object of result.Contents || []) {
      if (!object.Key || !object.LastModified || Date.now() - object.LastModified.getTime() < 86400000)
        continue
      const referenced = await pool.query('SELECT 1 FROM item_images WHERE object_key=$1', [object.Key])
      if (!referenced.rowCount)
        await s3.send(new DeleteObjectCommand({ Bucket: config.s3Bucket, Key: object.Key }))
    }
    continuation = result.IsTruncated ? result.NextContinuationToken : undefined
  } while (continuation)
}
