// src/pages/VolunteerDashboard.tsx
import { useEffect, useState } from 'react'
import { Button, Card, Input, Label, Select } from '@/components/ui'
import { jsPDF } from 'jspdf'
import { useAuth } from '@/store/useAuth'
import { useData } from '@/store/useData'

const MustLogin = ({ role }: { role: string }) =>
    <Card className="max-w-lg mx-auto"><p>Please login as <b>{role}</b> to access this area.</p></Card>

export default function VolunteerDashboard() {
    const { user } = useAuth()
    const { items, donations, events, orders, createEvent, updateDonationStatus, loadNextEvent } = useData()
    const [evt, setEvt] = useState({ date: '', location: '', pickupWindow: '10:00–13:00', allowDelivery: true })

    useEffect(() => { loadNextEvent() }, [])
    if (!user || user.role !== 'volunteer') return <MustLogin role="volunteer" />

    const expectedSurplus = Math.max(items.reduce((s, i) => s + (i.isSurplus ? i.qty : 0), 0), 0)

    const addEvent = () => {
        if (!evt.date || !evt.location) return alert('Fill date and location')
        createEvent({ date: new Date(evt.date).toISOString(), location: evt.location, pickupWindow: evt.pickupWindow, allowDelivery: evt.allowDelivery })
        setEvt({ date: '', location: '', pickupWindow: '10:00–13:00', allowDelivery: true })
    }

    const exportWeekly = () => {
        const doc = new jsPDF()
        doc.text('Weekly Report', 20, 20)
        doc.text('Donations: ' + donations.length, 20, 35)
        doc.text('Orders: ' + orders.length, 20, 45)
        doc.text('Expected Surplus: ' + expectedSurplus, 20, 55)
        doc.save('weekly-report.pdf')
    }

    return (
        <div className="space-y-4">
            <h2 className="text-2xl font-semibold">Volunteer Operations</h2>
            <Card>
                <h3 className="font-semibold mb-2">At a Glance</h3>
                <div className="grid md:grid-cols-4 gap-3">
                    <Stat title="Items Donated" value={donations.reduce((s, d) => s + d.items.reduce((a, b) => a + b.qty, 0), 0).toString()} />
                    <Stat title="Items Requested" value={orders.filter(o => o.type === 'recipient-reservation').reduce((s, o) => s + o.items.reduce((a, b) => a + b.qty, 0), 0).toString()} />
                    <Stat title="Expected Surplus" value={expectedSurplus.toString()} />
                    <Stat title="Events" value={events.length.toString()} />
                </div>
            </Card>
            <Card>
                <h3 className="font-semibold mb-2">Create Distribution Event</h3>
                <div className="grid md:grid-cols-4 gap-3">
                    <div><Label>Date (Saturday)</Label><Input type="date" value={evt.date} onChange={e => setEvt({ ...evt, date: e.target.value })} /></div>
                    <div><Label>Location</Label><Input value={evt.location} onChange={e => setEvt({ ...evt, location: e.target.value })} /></div>
                    <div><Label>Pickup Window</Label><Input value={evt.pickupWindow} onChange={e => setEvt({ ...evt, pickupWindow: e.target.value })} /></div>
                    <div>
                        <Label>Home Delivery</Label>
                        <Select value={String(evt.allowDelivery)} onChange={e => setEvt({ ...evt, allowDelivery: e.target.value === 'true' })}>
                            <option value="true">Enabled</option><option value="false">Disabled</option>
                        </Select>
                    </div>
                </div>
                <div className="mt-3"><Button onClick={addEvent}>Save Event</Button></div>
            </Card>
            <Card>
                <h3 className="font-semibold mb-2">Donation Management</h3>
                <div className="space-y-2">
                    {donations.length === 0 ? <p className="text-gray-500">No donations yet.</p> : donations.map(d => (
                        <div key={d.id} className="grid md:grid-cols-5 gap-2 border rounded-xl p-3">
                            <div className="md:col-span-3">
                                <div className="font-medium">{d.id} · {new Date(d.date).toDateString()}</div>
                                <div className="text-xs text-gray-500">{d.items.map(i => `${i.name}(${i.qty})`).join(', ')}</div>
                            </div>
                            <Select value={d.status} onChange={e => updateDonationStatus(d.id, e.target.value as any)}>
                                <option value="scheduled">Scheduled</option>
                                <option value="received">Received</option>
                                <option value="distributed">Distributed</option>
                                <option value="cancelled">Cancelled</option>
                            </Select>
                            <Button onClick={exportWeekly}>Export Weekly Report</Button>
                        </div>
                    ))}
                </div>
            </Card>
        </div>
    )
}

function Stat({ title, value }: { title: string; value: string }) {
    return <Card><div className="text-gray-500 text-sm">{title}</div><div className="text-2xl font-semibold">{value}</div></Card>
}
