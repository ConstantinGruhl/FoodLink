// src/pages/AdminPanel.tsx
import { Card } from '@/components/ui'
import { useAuth } from '@/store/useAuth'
import { useData } from '@/store/useData'

const MustLogin = ({ role }: { role: string }) =>
    <Card className="max-w-lg mx-auto"><p>Please login as <b>{role}</b> to access this area.</p></Card>

export default function AdminPanel() {
    const { user } = useAuth()
    const { events } = useData()
    if (!user || user.role !== 'admin') return <MustLogin role="admin" />
    return (
        <div className="space-y-4">
            <h2 className="text-2xl font-semibold">Admin Panel</h2>
            <Card><h3 className="font-semibold mb-2">Users & Roles</h3><p className="text-sm text-gray-600">For demo, users live in local storage.</p></Card>
            <Card><h3 className="font-semibold mb-2">CMS / Blog</h3><p className="text-sm text-gray-600">Partner stories and transparency reports (stub).</p></Card>
            <Card>
                <h3 className="font-semibold mb-2">Events</h3>
                <ul className="list-disc pl-6 text-sm">
                    {events.map(e => <li key={e.id}>{new Date(e.date).toDateString()} – {e.location} – {e.pickupWindow}</li>)}
                </ul>
            </Card>
        </div>
    )
}
