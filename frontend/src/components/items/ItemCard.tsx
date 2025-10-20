// src/components/items/ItemCard.tsx
import ItemImage from "./ItemImage"
export type ItemCardImage = { url?: string | null; object_key?: string | null; alt?: string | null; is_primary?: boolean }
export default function ItemCard({ title, qty, unit, priceCents, images, footer }: {
    title: string; qty: number; unit?: string | null; priceCents?: number | null; images?: ItemCardImage[]; footer?: React.ReactNode
}) {
    const primary = images?.find(i => i.is_primary) ?? images?.[0]
    return (
        <div className="border rounded-2xl bg-white p-3">
            <ItemImage url={primary?.url ?? undefined} objectKey={primary?.object_key ?? undefined} alt={primary?.alt ?? undefined} size="h-40 w-full" />
            <div className="mt-3">
                <div className="font-medium text-slate-900">{title}</div>
                <div className="text-sm text-slate-500">
                    {qty} {unit ?? ""} {priceCents != null ? `· $${(priceCents / 100).toFixed(2)}` : ""}
                </div>
            </div>
            {footer ? <div className="mt-3">{footer}</div> : null}
        </div>
    )
}
