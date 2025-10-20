// src/components/items/ItemImage.tsx
export default function ItemImage({ url, objectKey, alt, size = "h-40 w-full" }: {
    url?: string | null, objectKey?: string | null, alt?: string | null, size?: string
}) {
    const base = import.meta.env.VITE_IMAGE_BASE // e.g. http://localhost:9000/foodlink
    const src = url ?? (objectKey ? `${base}/${objectKey}` : undefined)
    return (
        <div className={`overflow-hidden rounded-xl bg-slate-100 ${size}`}>
            {src ? <img src={src} alt={alt ?? ""} className="h-full w-full object-cover" /> :
                <div className="h-full w-full grid place-items-center text-slate-400 text-sm">No image</div>}
        </div>
    )
}
