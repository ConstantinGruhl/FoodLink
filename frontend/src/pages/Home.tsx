// src/pages/Home.tsx
import { Link } from 'react-router-dom'
import { Button, Card } from '@/components/ui'
import { ImpactCharts } from '@/components/Charts'

export default function Home() {
    return (
        <div className="grid md:grid-cols-2 gap-6 items-center">
            <div>
                <h1 className="text-3xl font-semibold mb-3">Welcome to FoodShare</h1>
                <p className="text-gray-600">Bringing donors, volunteers, buyers, and people in need together to prevent food waste and support the community.</p>
                <div className="mt-4 flex gap-2">
                    <Link to="/register"><Button>Get Started</Button></Link>
                    <Link to="/impact"><Button className="border-slate-300">See Public Impact</Button></Link>
                </div>
            </div>
            <Card>
                <ImpactCharts />
            </Card>
        </div>
    )
}
