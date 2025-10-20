import { Card } from './ui'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'


export function ImpactCharts() {
    const barData = [
        { name: 'Meals', value: 1200 },
        { name: 'Kg Saved', value: 840 },
    ]
    const pieData = [
        { name: 'Ambient', value: 55 },
        { name: 'Chilled', value: 30 },
        { name: 'Frozen', value: 15 },
    ]
    return (
        <div className="grid md:grid-cols-2 gap-4">
            <Card className="h-72">
                <h3 className="font-semibold mb-2">Total Impact</h3>
                <ResponsiveContainer width="100%" height="85%">
                    <BarChart data={barData}>
                        <XAxis dataKey="name" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="value" />
                    </BarChart>
                </ResponsiveContainer>
            </Card>
            <Card className="h-72">
                <h3 className="font-semibold mb-2">Storage Mix</h3>
                <ResponsiveContainer width="100%" height="85%">
                    <PieChart>
                        <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={80} label>
                            {pieData.map((_, i) => (<Cell key={i} />))}
                        </Pie>
                        <Tooltip />
                    </PieChart>
                </ResponsiveContainer>
            </Card>
        </div>
    )
}