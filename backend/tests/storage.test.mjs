import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { validateImage } from '../dist/storage.js'

test('valid image is decoded, stripped and re-encoded into bounded WebP', async () => {
  const png = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#008040' } })
    .png()
    .toBuffer()
  const result = await validateImage(png, 'image/png')
  assert.equal(result.width, 4)
  assert.equal(result.height, 3)
  const metadata = await sharp(result.data).metadata()
  assert.equal(metadata.format, 'webp')
  assert.equal(metadata.exif, undefined)
})
test('declared image type must match bytes and header-only impostors must decode', async () => {
  const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } })
    .png()
    .toBuffer()
  await assert.rejects(validateImage(png, 'image/jpeg'), (error) => error.code === 'INVALID_IMAGE_TYPE')
  await assert.rejects(
    validateImage(
      Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(30)]),
      'image/png',
    ),
    (error) => error.code === 'INVALID_IMAGE',
  )
  await assert.rejects(
    validateImage(Buffer.alloc(5 * 1024 * 1024 + 1), 'image/png'),
    (error) => error.code === 'INVALID_IMAGE',
  )
})
