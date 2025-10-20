// src/components/Footer.tsx
import { Link } from "react-router-dom"

export default function Footer() {
    return (
        <footer className="mt-20 border-t border-slate-100 bg-white">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 grid gap-8 md:grid-cols-4">
                <div>
                    <h4 className="font-semibold text-slate-800">FoodLink</h4>
                    <p className="mt-2 text-sm text-slate-600">
                        We connect donors, volunteers, buyers, and people in need to reduce food waste and build resilient communities.
                    </p>
                </div>
                <div>
                    <h5 className="font-semibold text-slate-800">Product</h5>
                    <ul className="mt-2 space-y-2 text-sm">
                        <li><Link to="/#features" className="hover:text-brand-700">Features</Link></li>
                        <li><Link to="/impact" className="hover:text-brand-700">Impact</Link></li>
                        <li><Link to="/market" className="hover:text-brand-700">Marketplace</Link></li>
                    </ul>
                </div>
                <div>
                    <h5 className="font-semibold text-slate-800">For Groups</h5>
                    <ul className="mt-2 space-y-2 text-sm">
                        <li><Link to="/donor" className="hover:text-brand-700">Food Suppliers</Link></li>
                        <li><Link to="/volunteer" className="hover:text-brand-700">Volunteers</Link></li>
                        <li><Link to="/recipient" className="hover:text-brand-700">Recipients</Link></li>
                    </ul>
                </div>
                <div>
                    <h5 className="font-semibold text-slate-800">Legal</h5>
                    <ul className="mt-2 space-y-2 text-sm">
                        <li><a className="hover:text-brand-700" href="/privacy">Privacy</a></li>
                        <li><a className="hover:text-brand-700" href="/terms">Terms</a></li>
                    </ul>
                </div>
            </div>
            <div className="border-t border-slate-100 py-6 text-center text-sm text-slate-500">
                © {new Date().getFullYear()} FoodLink. All rights reserved.
            </div>
        </footer>
    )
}
