import { useState } from 'react'
import { Upload, Trash2 } from 'lucide-react'
import { request } from '../lib/api'
import { useAction } from '../lib/hooks'
import { imageSchema, okSchema, type Item } from '../lib/schemas'
import { ActionMessages, Field } from './ui'
export default function ImageUploader({ item, onChange }: { item: Item; onChange: () => void }) {
  const action = useAction(),
    [file, setFile] = useState<File | null>(null),
    [key, setKey] = useState(0)
  async function upload() {
    if (!file) return
    await action.run(async () => {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
        throw new Error('Choose a JPEG, PNG or WebP image.')
      if (file.size > 5 * 1024 * 1024) throw new Error('Choose an image smaller than 5 MB.')
      await request(`/items/${item.id}/images`, imageSchema, {
        method: 'POST',
        headers: { 'Content-Type': file.type, 'X-Image-Alt': item.name.replace(/[^\x20-\x7E]/g, '') },
        body: file,
      })
      setFile(null)
      setKey((v) => v + 1)
      onChange()
    }, 'Image uploaded.')
  }
  return (
    <div className="stack">
      <ActionMessages error={action.error} success={action.success} />
      {item.images.length > 0 && (
        <div className="row">
          {item.images.map((image) => (
            <div key={image.id} className="stack" style={{ gap: '.3rem', width: 100 }}>
              <img
                src={image.url}
                alt={image.alt || item.name}
                width={100}
                height={80}
                style={{ height: 80, objectFit: 'cover', borderRadius: 8 }}
                loading="lazy"
              />
              <button
                className="btn danger small"
                disabled={action.pending}
                onClick={() =>
                  void action.run(async () => {
                    await request(`/items/${item.id}/images/${image.id}`, okSchema, { method: 'DELETE' })
                    onChange()
                  }, 'Image removed.')
                }
                aria-label={`Remove image of ${item.name}`}
              >
                <Trash2 size={14} />
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="inline-form">
        <Field label={`Add photo of ${item.name}`} hint="JPEG, PNG or WebP, up to 5 MB.">
          <input
            key={key}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </Field>
        <button
          className="btn secondary small"
          disabled={!file || action.pending}
          onClick={() => void upload()}
        >
          <Upload size={15} />
          {action.pending ? 'Uploading…' : 'Upload photo'}
        </button>
      </div>
    </div>
  )
}
