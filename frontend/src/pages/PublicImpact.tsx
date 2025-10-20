// src/pages/PublicImpact.tsx
import { useEffect } from 'react'
import { Card } from '@/components/ui'
import { useData } from '@/store/useData'
import { ImpactCharts } from '@/components/Charts'

const StatCard = ({ title, value }: { title: string; value: string }) => (
    <Card><div className="text-gray-500 text-sm">{title}</div><div className="text-2xl font-semibold">{value}</div></Card>
)

export default function PublicImpact() {
    const { impact, loadPublicImpact } = useData()
    useEffect(() => { loadPublicImpact() }, [])
    return (
        <div className="space-y-4">
            <h2 className="text-2xl font-semibold">Public Dashboard</h2>
            <p className="text-gray-600">Transparency first. Real-time impact of the platform.</p>
            <div className="grid sm:grid-cols-4 gap-4">
                <StatCard title="Meals Distributed" value={impact.totalMealsDistributed.toLocaleString()} />
                <StatCard title="Kg of Food Saved" value={impact.totalKgSaved.toLocaleString()} />
                <StatCard title="Total Donors" value={impact.totalDonors.toLocaleString()} />
                <StatCard title="Total Buyers" value={impact.totalBuyers.toLocaleString()} />
            </div>
            <ImpactCharts />
        </div>
    )
}
