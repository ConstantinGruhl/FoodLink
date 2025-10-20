// src/components/ImageUploader.tsx
import { useState } from "react"
import { api } from "@/lib/api"

export default function ImageUploader({ itemId, onUploaded }: { itemId: string; onUploaded?: () => void }) {
    const [file, setFile] = useState<File | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const doUpload = async () => {
        if (!file) return
        setBusy(true); setError(null)
        try {
            const { data } = await api.post("/uploads/presign", { itemId, contentType: file.type })
            await fetch(data.url, { method: "PUT", headers: { "Content-Type": file.type }, body: file })
            await api.post(`/items/${itemId}/images`, { objectKey: data.objectKey, publicUrl: data.publicUrl, alt: file.name, isPrimary: true })
            onUploaded?.()
            setFile(null)
        } catch (e: any) {
            setError(e.message || "Upload failed")
        } finally { setBusy(false) }
    }

    return (
        <div className="flex items-center gap-3">
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => setFile(e.target.files?.[0] ?? null)} />
            <button disabled={!file || busy} onClick={doUpload} className="px-3 py-2 rounded-lg bg-brand-600 text-white disabled:opacity-50">
                {busy ? "Uploading…" : "Upload"}
            </button>
            {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
    )
}
