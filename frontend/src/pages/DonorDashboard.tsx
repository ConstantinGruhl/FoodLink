// src/pages/DonorDashboard.tsx
import { useEffect, useState } from 'react'
import { Button, Card, Input, Label, Select } from '@/components/ui'
import DonationsList from '@/components/donations/DonationsList'
import { jsPDF } from 'jspdf'
import { useAuth } from '@/store/useAuth'
import { useData } from '@/store/useData'

const MustLogin = ({ role }: { role: string }) =>
    <Card className="max-w-lg mx-auto"><p>Please login as <b>{role}</b> to access this area.</p></Card>

type NewItem = {
    name: string
    qty: number
    storage: 'ambient' | 'chilled' | 'frozen'
    unit?: string
    expiresOn?: string
}

export default function DonorDashboard() {
    const { user } = useAuth()
    const { donations, createDonation, updateDonationStatus, loadMyDonations } = useData()
    const [rows, setRows] = useState<NewItem[]>([
        { name: '', qty: 0, storage: 'ambient', unit: 'pcs', expiresOn: '' },
    ])

    useEffect(() => { if (user) loadMyDonations(user.id) }, [user])
    if (!user || user.role !== 'donor') return <MustLogin role="donor" />

    const my = donations.filter(d => d.donorId === user.id)

    const setRow = (i: number, patch: Partial<NewItem>) =>
        setRows(r => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)))

    const addRow = () =>
        setRows(r => [...r, { name: '', qty: 0, storage: 'ambient', unit: 'pcs', expiresOn: '' }])

    const removeRow = (i: number) =>
        setRows(r => r.length === 1 ? r : r.filter((_, idx) => idx !== i))

    const submit = async () => {
        const payloadItems = rows
            .map(r => ({
                name: r.name.trim(),
                qty: Number(r.qty),
                storage: r.storage,
                unit: r.unit?.trim() || null,
                expiresOn: r.expiresOn ? new Date(r.expiresOn).toISOString() : undefined,
            }))
            .filter(r => r.name && r.qty > 0)

        if (payloadItems.length === 0) {
            alert('Please add at least one valid item (name + qty > 0).')
            return
        }

        try {
            await createDonation({ donorId: user.id, items: payloadItems })
            setRows([{ name: '', qty: 0, storage: 'ambient', unit: 'pcs', expiresOn: '' }])
            await loadMyDonations(user.id) // ensure UI refreshes with server data (including item IDs)
            alert('Donation created!')
        } catch (e: any) {
            alert(e.message || 'Failed to create donation')
        }
    }

    const makePDF = (dId: string) => {
        const doc = new jsPDF()
        doc.text('Certificate of Donation', 20, 20)
        doc.text('Donor: ' + user.name, 20, 35)
        doc.text('Donation ID: ' + dId, 20, 45)
        doc.text('Date: ' + new Date().toDateString(), 20, 55)
        doc.save(`donation-${dId}.pdf`)
    }

    return (
        <div className="space-y-4">
            <h2 className="text-2xl font-semibold">Donor Dashboard</h2>

            <Card>
                <h3 className="font-semibold mb-2">Enter Available Products (multiple)</h3>

                <div className="space-y-3">
                    {rows.map((row, i) => (
                        <div key={i} className="grid md:grid-cols-6 gap-3 items-end border rounded-xl p-3 bg-white">
                            <div className="md:col-span-2">
                                <Label>Product Name</Label>
                                <Input value={row.name} onChange={e => setRow(i, { name: e.target.value })} />
                            </div>
                            <div>
                                <Label>Qty</Label>
                                <Input type="number" min={0} value={row.qty} onChange={e => setRow(i, { qty: Number(e.target.value) })} />
                            </div>
                            <div>
                                <Label>Unit</Label>
                                <Input value={row.unit || ''} onChange={e => setRow(i, { unit: e.target.value })} placeholder="pcs, pack, kg…" />
                            </div>
                            <div>
                                <Label>Storage</Label>
                                <Select value={row.storage} onChange={e => setRow(i, { storage: e.target.value as any })}>
                                    <option value="ambient">Ambient</option>
                                    <option value="chilled">Chilled</option>
                                    <option value="frozen">Frozen</option>
                                </Select>
                            </div>
                            <div>
                                <Label>Expiry (optional)</Label>
                                <Input type="date" value={row.expiresOn || ''} onChange={e => setRow(i, { expiresOn: e.target.value })} />
                            </div>
                            <div className="flex gap-2">
                                <Button onClick={() => removeRow(i)} className="border border-slate-300">Remove</Button>
                            </div>
                        </div>
                    ))}

                    <div className="flex gap-2">
                        <Button onClick={addRow} className="border border-slate-300">Add item row</Button>
                        <Button onClick={submit}>Create Donation</Button>
                    </div>
                </div>
            </Card>

            {/* Shows donations, expands items, includes uploader per item */}
            <DonationsList
                donations={my}
                onCancel={(id) => updateDonationStatus(id, 'cancelled')}
                onCert={(id) => makePDF(id)}
            />
        </div>
    )
}
