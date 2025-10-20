// src/pages/Marketplace.tsx
import { useEffect, useState } from 'react'
import { Button, Card, Input, Label } from '@/components/ui'
import ItemCard from '@/components/items/ItemCard'
import { useAuth } from '@/store/useAuth'
import { useData } from '@/store/useData'

const MustLogin = ({ role }: { role: string }) =>
    <Card className="max-w-lg mx-auto"><p>Please login as <b>{role}</b> to access this area.</p></Card>

export default function Marketplace() {
    const { user } = useAuth()
    const { items, buyerPurchase, loadSurplusCatalog, imagesByItem } = useData()
    const [cart, setCart] = useState<{ itemId: string; qty: number }[]>([])
    const [support, setSupport] = useState(0)

    useEffect(() => { loadSurplusCatalog() }, [])
    if (!user || user.role !== 'buyer') return <MustLogin role="buyer" />

    const surplus = items.filter(i => i.isSurplus && i.qty > 0)
    const add = (itemId: string) => {
        setCart(prev => {
            const found = prev.find(c => c.itemId === itemId)
            if (found) return prev.map(c => c.itemId === itemId ? { ...c, qty: c.qty + 1 } : c)
            return [...prev, { itemId, qty: 1 }]
        })
    }
    const total = cart.reduce((s, c) => {
        const it = surplus.find(i => i.id === c.itemId)
        return s + (it?.priceCents ?? 0) * c.qty
    }, 0) + support

    const checkout = async () => {
        try {
            const order = await buyerPurchase(user.id, cart, support)
            alert('Payment accepted. Confirmation sent. Order ' + order.id)
            setCart([]); setSupport(0)
        } catch (e: any) { alert(e.message) }
    }

    return (
        <div className="space-y-4">
            <h2 className="text-2xl font-semibold">Surplus Marketplace</h2>
            <div className="grid md:grid-cols-3 gap-4">
                {surplus.map(it => (
                    <ItemCard
                        key={it.id}
                        title={it.name}
                        qty={it.qty}
                        unit={it.unit}
                        priceCents={it.priceCents ?? null}
                        images={imagesByItem[it.id] || []}
                        footer={<Button className="mt-1" onClick={() => add(it.id)}>Add to cart</Button>}
                    />
                ))}
            </div>
            <Card>
                <h3 className="font-semibold mb-2">Cart</h3>
                {cart.length === 0 ? <p className="text-gray-500">Your cart is empty.</p> : (
                    <div className="space-y-2">
                        {cart.map(c => {
                            const it = surplus.find(i => i.id === c.itemId)!
                            return <div key={c.itemId} className="flex items-center justify-between">
                                <div>{it.name} × {c.qty}</div>
                                <div>${(((it.priceCents ?? 0) * c.qty) / 100).toFixed(2)}</div>
                            </div>
                        })}
                        <div className="pt-2 border-t">
                            <Label>Support Contribution (optional)</Label>
                            <Input type="number" min={0} value={support} onChange={e => setSupport(Number(e.target.value))} />
                        </div>
                        <div className="font-semibold">Total: ${(total / 100).toFixed(2)}</div>
                        <Button onClick={checkout}>Pay & Checkout</Button>
                    </div>
                )}
            </Card>
        </div>
    )
}
