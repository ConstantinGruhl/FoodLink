// src/pages/Register.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Input, Label, Select } from '@/components/ui'
import { useAuth } from '@/store/useAuth'

export default function Register() {
    const { register } = useAuth()
    const nav = useNavigate()
    const [form, setForm] = useState({ name: '', email: '', role: 'recipient', householdSize: 1, dietaryNeeds: '' })
    return (
        <Card className="max-w-2xl mx-auto">
            <h2 className="text-xl font-semibold mb-4">Create Account</h2>
            <div className="grid md:grid-cols-2 gap-4">
                <div><Label>Name</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label>Email</Label><Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
                <div>
                    <Label>Role</Label>
                    <Select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                        <option value="recipient">Recipient</option>
                        <option value="buyer">Buyer</option>
                        <option value="donor">Donor</option>
                        <option value="volunteer">Volunteer</option>
                    </Select>
                </div>
                {form.role === 'recipient' && (
                    <>
                        <div><Label>Household Size</Label><Input type="number" min={1} value={form.householdSize} onChange={e => setForm({ ...form, householdSize: Number(e.target.value) })} /></div>
                        <div><Label>Dietary Needs (comma separated)</Label><Input value={form.dietaryNeeds} onChange={e => setForm({ ...form, dietaryNeeds: e.target.value })} /></div>
                    </>
                )}
            </div>
            <div className="mt-4">
                <Button onClick={() => {
                    try {
                        const dn = form.dietaryNeeds.split(',').map(s => s.trim()).filter(Boolean)
                        register({ name: form.name, email: form.email, role: form.role as any, householdSize: form.householdSize, dietaryNeeds: dn })
                        nav('/')
                    } catch (e: any) { alert(e.message) }
                }}>Register</Button>
            </div>
        </Card>
    )
}
