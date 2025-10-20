// src/pages/RecipientDashboard.tsx
import { useEffect, useState } from 'react'
import { Button, Card, Input } from '@/components/ui'
import ItemCard from '@/components/items/ItemCard'
import QR from '@/components/QR'
import { useAuth } from '@/store/useAuth'
import { useData } from '@/store/useData'

const MustLogin = ({ role }: { role: string }) =>
    <Card className="max-w-lg mx-auto"><p>Please login as <b>{role}</b> to access this area.</p></Card>

export default function RecipientDashboard() {
    const { user } = useAuth()
    const { items, events, reserveItem, loadRecipientCatalog, loadNextEvent, loadMyOrders, imagesByItem } = useData()
    const [selection, setSelection] = useState<Record<string, number>>({})

    useEffect(() => {
        loadRecipientCatalog()
        loadNextEvent()
        if (user) loadMyOrders(user.id)
    }, [user])

    if (!user || user.role !== 'recipient') return <MustLogin role="recipient" />
    const nextEvent = events[0]
    const available = items.filter(i => !i.isSurplus && (i.qty > 0))

    const submit = () => {
        try {
            Object.entries(selection).forEach(([itemId, qty]) => qty > 0 && reserveItem(user.id, itemId, qty))
            alert('Reservation confirmed. See your ticket below.')
            setSelection({})
        } catch (e: any) { alert(e.message) }
    }

    return (
        <div className="space-y-4">
            <h2 className="text-2xl font-semibold">Recipient Dashboard</h2>
            <Card>
                <div className="grid md:grid-cols-2 gap-4">
                    <div>
                        <div className="text-sm text-gray-500">Weekly Distribution</div>
                        <div className="font-semibold">{new Date(nextEvent.date).toDateString()} · {nextEvent.pickupWindow}</div>
                        <div className="text-gray-600">{nextEvent.location}</div>
                    </div>
                    <div className="text-sm text-gray-600">Priority is given to families with children and elderly households. Your profile helps us prioritize fairly.</div>
                </div>
            </Card>

            <Card>
                <h3 className="font-semibold mb-2">Request Items</h3>
                <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {available.map(it => (
                        <ItemCard
                            key={it.id}
                            title={it.name}
                            qty={it.qty}
                            unit={it.unit}
                            images={imagesByItem[it.id] || []}
                            footer={
                                <Input
                                    type="number"
                                    min={0}
                                    max={it.qty}
                                    value={selection[it.id] ?? 0}
                                    onChange={e => setSelection({ ...selection, [it.id]: Number(e.target.value) })}
                                />
                            }
                        />
                    ))}
                </div>
                <div className="mt-3"><Button onClick={submit}>Confirm Request</Button></div>
            </Card>

            <RecipientTicket />
        </div>
    )
}

function RecipientTicket() {
    const { user } = useAuth()
    const { orders, events, loadMyOrders } = useData()
    useEffect(() => { if (user) loadMyOrders(user.id) }, [user])
    if (!user) return null
    const latest = [...orders].reverse().find(o => o.userId === user.id && o.type === 'recipient-reservation')
    if (!latest) return null
    const ev = events.find(e => e.id === latest.eventId)
    const code = JSON.stringify({ orderId: latest.id, user: user.name })

    return (
        <Card>
            <h3 className="font-semibold mb-2">Your Pickup Ticket</h3>
            <div className="grid sm:grid-cols-2 gap-4 items-center">
                <div>
                    <div>Order: <span className="font-mono text-sm">{latest.id}</span></div>
                    <div>Pickup: {ev ? new Date(ev.date).toDateString() : ''} · {ev?.pickupWindow}</div>
                    <div>Location: {ev?.location}</div>
                </div>
                <div className="justify-self-center"><QR value={code} /></div>
            </div>
        </Card>
    )
}
