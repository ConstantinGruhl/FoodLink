// src/components/Nav.tsx
import { Link, NavLink } from "react-router-dom"
import logo from "@/assets/foodlink-logo.png"
import { useAuth } from "@/store/useAuth"

const linkCls = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-lg text-sm font-medium ${isActive
        ? "bg-brand-100 text-brand-800"
        : "text-slate-600 hover:text-brand-700 hover:bg-brand-50"
    }`

// map roles to their primary area
function roleHomePath(role?: string) {
    switch (role) {
        case "recipient": return "/recipient"
        case "buyer": return "/market"
        case "donor": return "/donor"
        case "volunteer": return "/volunteer"
        case "admin": return "/admin"
        default: return "/"
    }
}

export default function Nav() {
    const { user, logout } = useAuth()

    return (
        <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-slate-100">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                {/* Brand */}
                <Link to="/" className="flex items-center gap-2">
                    <img src={logo} alt="FoodLink" className="h-9 w-9" />
                    <span className="font-semibold text-lg text-brand-800">FoodLink</span>
                </Link>

                {/* Main nav */}
                <nav className="hidden md:flex items-center gap-1">
                    <NavLink to="/landing" className={linkCls}>Features</NavLink>
                    <NavLink to="/impact" className={linkCls}>Impact</NavLink>
                    <NavLink to="/market" className={linkCls}>Marketplace</NavLink>
                    <NavLink to="/donor" className={linkCls}>For Donors</NavLink>
                    <NavLink to="/volunteer" className={linkCls}>Volunteers</NavLink>
                </nav>

                {/* Right side: auth-aware */}
                <div className="flex items-center gap-2">
                    {!user ? (
                        <>
                            <Link
                                to="/login"
                                className="px-4 py-2 rounded-xl text-sm font-semibold text-brand-800 hover:bg-brand-50"
                            >
                                Log in
                            </Link>
                            <Link
                                to="/register"
                                className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 shadow-soft"
                            >
                                Get started
                            </Link>
                        </>
                    ) : (
                        <>
                            {/* quick role-aware entry */}
                            <Link
                                to={roleHomePath(user.role)}
                                className="px-3 py-2 rounded-lg text-sm font-semibold text-brand-800 hover:bg-brand-50"
                            >
                                My dashboard
                            </Link>

                            {/* tiny user chip */}
                            <span
                                title={user.email}
                                className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm"
                            >
                                <span className="inline-grid place-items-center h-6 w-6 rounded-full bg-brand-100 text-brand-800 font-semibold">
                                    {user.name?.[0]?.toUpperCase() ?? "U"}
                                </span>
                                <span className="max-w-[10rem] truncate">{user.name}</span>
                            </span>

                            <button
                                onClick={logout}
                                className="px-3 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:text-brand-700 hover:bg-brand-50"
                            >
                                Logout
                            </button>
                        </>
                    )}
                </div>
            </div>
        </header>
    )
}
