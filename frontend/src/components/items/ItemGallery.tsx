// src/components/items/ItemGallery.tsx
import React, { useState } from "react"
import ItemImage from "./ItemImage"
import { ItemCardImage } from "./ItemCard"

export default function ItemGallery({ images }: { images: ItemCardImage[] }) {
    const [idx, setIdx] = useState(Math.max(images.findIndex(i => i.is_primary), 0))
    const current = images[idx] ?? images[0]
    return (
        <div>
            <ItemImage
                url={current?.url ?? undefined}
                objectKey={current?.object_key ?? undefined}
                alt={current?.alt ?? undefined}
                size="h-64 w-full"
            />
            <div className="mt-2 flex gap-2">
                {images.map((img, i) => (
                    <button
                        key={i}
                        className={`rounded-lg border ${i === idx ? "border-brand-600" : "border-slate-200"}`}
                        onClick={() => setIdx(i)}
                    >
                        <ItemImage
                            url={img.url ?? undefined}
                            objectKey={img.object_key ?? undefined}
                            alt={img.alt ?? undefined}
                            size="h-16 w-16"
                        />
                    </button>
                ))}
            </div>
        </div>
    )
}
