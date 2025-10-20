import { useEffect } from "react"
import { Button, Card } from "@/components/ui"
import ItemCard from "@/components/items/ItemCard"
import ImageUploader from "@/components/ImageUploader"
import { useData } from "@/store/useData"

type DonationItem = {
    id?: string
    name: string
    qty: number
    unit?: string | null
    storage: "ambient" | "chilled" | "frozen"
    expiresOn?: string | null
}

type Donation = {
    id: string
    donorId: string
    date: string
    status: "scheduled" | "received" | "distributed" | "cancelled"
    items: DonationItem[]
}

export default function DonationsList({
    donations,
    onCancel,
    onCert,
    title = "Your Donations",
}: {
    donations: Donation[]
    onCancel: (id: string) => void
    onCert: (id: string) => void
    title?: string
}) {
    return (
        <Card>
            <h3 className="font-semibold mb-2">{title}</h3>
            <div className="space-y-2">
                {donations.length === 0 ? (
                    <p className="text-gray-500">No donations yet.</p>
                ) : (
                    donations.map((d) => <DonationCard key={d.id} donation={d} onCancel={onCancel} onCert={onCert} />)
                )}
            </div>
        </Card>
    )
}

function DonationCard({
    donation,
    onCancel,
    onCert,
}: {
    donation: Donation
    onCancel: (id: string) => void
    onCert: (id: string) => void
}) {
    return (
        <div className="border rounded-xl p-3 bg-white">
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <div className="font-medium truncate">Donation {donation.id}</div>
                    <div className="text-sm text-gray-500">
                        {new Date(donation.date).toDateString()} · {donation.items.length} items · Status: {donation.status}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button onClick={() => onCancel(donation.id)}>Cancel</Button>
                    <Button onClick={() => onCert(donation.id)}>Certificate (PDF)</Button>
                </div>
            </div>

            <DonationItemsGrid donationId={donation.id} items={donation.items} />
        </div>
    )
}

function DonationItemsGrid({
    donationId,
    items,
}: {
    donationId: string
    items: DonationItem[]
}) {
    const { imagesByItem, loadItemImages } = useData()

    useEffect(() => {
        const withIds = items.filter((i) => !!i.id)
        Promise.all(withIds.map((i) => loadItemImages(i.id!))).catch(() => { })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [donationId])

    return (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((it, idx) => {
                const imgs = it.id ? imagesByItem[it.id] || [] : []
                return (
                    <ItemCard
                        key={it.id ?? `${donationId}-${idx}`}
                        title={it.name}
                        qty={it.qty}
                        unit={it.unit}
                        images={imgs}
                        footer={
                            <>
                                <div className="text-xs text-slate-500">
                                    {it.storage}
                                    {it.expiresOn ? ` · exp: ${new Date(it.expiresOn).toLocaleDateString()}` : ""}
                                </div>
                                {it.id ? (
                                    <ImageUploader itemId={it.id} onUploaded={() => loadItemImages(it.id!)} />
                                ) : (
                                    <div className="text-xs text-slate-500">
                                        (Image upload will be available once items are created in the system)
                                    </div>
                                )}
                            </>
                        }
                    />
                )
            })}
        </div>
    )
}
