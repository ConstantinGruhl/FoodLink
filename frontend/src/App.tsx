import { Routes, Route } from 'react-router-dom'
import Nav from '@/components/Nav'
import Landing from '@/pages/Landing'

import Home from '@/pages/Home'
import PublicImpact from '@/pages/PublicImpact'
import Login from '@/pages/Login'
import Register from '@/pages/Register'
import RecipientDashboard from '@/pages/RecipientDashboard'
import Marketplace from '@/pages/Marketplace'
import DonorDashboard from '@/pages/DonorDashboard'
import VolunteerDashboard from '@/pages/VolunteerDashboard'
import AdminPanel from '@/pages/AdminPanel'

export default function App() {
    return (
        <div className="min-h-full bg-slate-50">
            <Nav />
            <div className="container-prose py-6">
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/impact" element={<PublicImpact />} />
                    <Route path="/landing" element={<Landing />} />

                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />

                    <Route path="/recipient" element={<RecipientDashboard />} />
                    <Route path="/market" element={<Marketplace />} />
                    <Route path="/donor" element={<DonorDashboard />} />
                    <Route path="/volunteer" element={<VolunteerDashboard />} />
                    <Route path="/admin" element={<AdminPanel />} />
                </Routes>
            </div>
        </div>
    )
}
