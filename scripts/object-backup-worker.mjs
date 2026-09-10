import { createRequire } from 'node:module'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { once } from 'node:events'

const require = createRequire('/app/package.json')
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  CreateBucketCommand,
} = require('@aws-sdk/client-s3')
if (process.env.NODE_ENV === 'production')
  throw new Error(
    'Local object drill must not run against production. Use provider-native versioned backups.',
  )
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'us-east-1',
  forcePathStyle: process.env.S3_FORCE_PATH !== 'false',
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
})
const [mode, path] = process.argv.slice(2)
if (!['backup', 'restore'].includes(mode) || !/^\/tmp\/foodlink-objects-[a-f0-9-]+\.ndjson$/.test(path || ''))
  throw new Error('Invalid object-drill invocation')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
let count = 0
if (mode === 'backup') {
  const stream = createWriteStream(path, { mode: 0o600 })
  let cursor
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, ContinuationToken: cursor }),
    )
    for (const object of page.Contents || []) {
      const response = await client.send(
        new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: object.Key }),
      )
      const bytes = Buffer.from(await response.Body.transformToByteArray())
      const record =
        JSON.stringify({
          key: object.Key,
          contentType: response.ContentType,
          sha256: hash(bytes),
          base64: bytes.toString('base64'),
        }) + '\n'
      if (!stream.write(record)) await once(stream, 'drain')
      count++
    }
    cursor = page.NextContinuationToken
  } while (cursor)
  stream.end()
  await once(stream, 'finish')
  console.log(JSON.stringify({ mode, objectCount: count }))
} else {
  const bucket = `foodlink-restore-${randomUUID()}`
  await client.send(new CreateBucketCommand({ Bucket: bucket }))
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line) continue
    const record = JSON.parse(line)
    const bytes = Buffer.from(record.base64, 'base64')
    if (hash(bytes) !== record.sha256) throw new Error('Object archive checksum mismatch')
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: record.key, Body: bytes, ContentType: record.contentType }),
    )
    const restored = await client.send(new GetObjectCommand({ Bucket: bucket, Key: record.key }))
    if (hash(Buffer.from(await restored.Body.transformToByteArray())) !== record.sha256)
      throw new Error('Restored object checksum mismatch')
    count++
  }
  console.log(
    JSON.stringify({ mode, restoredBucket: bucket, verifiedObjects: count, retainedForInspection: true }),
  )
}
client.destroy()
