// src/pages/Landing.tsx
import { Link } from "react-router-dom"
import Footer from "@/components/Footer"
import logo from "@/assets/foodlink-logo.png"

const Check = (props: any) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 text-brand-600"><path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
)

export default function Landing() {
    return (
        <main className="bg-gradient-to-b from-brand-50 via-white to-white">
            {/* HERO */}
            <section className="relative">
                <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(600px_200px_at_20%_0%,rgba(46,166,126,0.3),transparent)]" />
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 grid gap-10 md:grid-cols-2 items-center">
                    <div>
                        <span className="inline-flex items-center gap-2 rounded-full bg-brand-100 text-brand-800 px-3 py-1 text-xs font-semibold">
                            <img src={logo} className="h-4 w-4" /> Community powered food rescue
                        </span>
                        <h1 className="mt-4 text-4xl sm:text-5xl font-extrabold leading-tight text-slate-900">
                            Save good food. <span className="text-brand-600">Support families.</span> Build community.
                        </h1>
                        <p className="mt-4 text-lg text-slate-600 max-w-prose">
                            FoodLink connects surplus food from generous donors to people in need—fairly, safely, and transparently.
                            Together we prevent waste, cut costs, and make sure plates get filled every week.
                        </p>

                        <div className="mt-6 flex flex-wrap gap-3">
                            <Link to="/register" className="px-5 py-3 rounded-xl text-white bg-brand-600 hover:bg-brand-700 shadow-soft font-semibold">
                                Get started
                            </Link>
                            <Link to="/impact" className="px-5 py-3 rounded-xl text-brand-700 bg-brand-50 hover:bg-brand-100 font-semibold">
                                See our impact
                            </Link>
                        </div>

                        <ul className="mt-6 grid gap-2 text-sm text-slate-600">
                            <li className="flex items-center gap-2"><Check /> Fair prioritization for families & elderly</li>
                            <li className="flex items-center gap-2"><Check /> Transparent dashboards & weekly reports</li>
                            <li className="flex items-center gap-2"><Check /> GDPR-compliant, safe handling standards</li>
                        </ul>
                    </div>

                    <div className="relative">
                        <div className="rounded-3xl bg-white shadow-soft p-6">
                            <img src={logo} className="h-20 w-20 mb-3" alt="FoodLink logo" />
                            <h3 className="text-xl font-semibold text-slate-900">Our Mission</h3>
                            <p className="mt-2 text-slate-600">
                                We make it easy for donors to share surplus, recipients to request what they need,
                                buyers to fund operations by purchasing leftovers at deep discounts,
                                and volunteers to coordinate Saturday distributions.
                            </p>
                            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                                <Stat num="1,200+" label="Meals distributed" />
                                <Stat num="840kg" label="Food saved" />
                                <Stat num="12" label="Active donors" />
                                <Stat num="45" label="Support buyers" />
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* FEATURES */}
            <section id="features" className="py-16">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <h2 className="text-3xl font-bold text-slate-900 text-center">Everything you need to run fair food distributions</h2>
                    <p className="mt-3 text-center text-slate-600 max-w-3xl mx-auto">
                        Four roles, one platform. Role-based access keeps things simple and secure.
                    </p>
                    <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                        <Feature title="Recipients" icon="🧺"
                            points={["Simple signup & profile", "Reserve items for Collection Day", "Pickup ticket with QR", "SMS/email reminders"]} />
                        <Feature title="Buyers" icon="🛒"
                            points={["Surplus marketplace", "70–90% off retail", "Cart & checkout", "Support contribution"]} />
                        <Feature title="Donors" icon="🥕"
                            points={["Donation dashboard", "Edit/cancel before deadline", "Certificates (PDF)", "Impact badges"]} />
                        <Feature title="Volunteers" icon="🤝"
                            points={["Operational dashboard", "Create events & assign tasks", "Real-time tracking", "Weekly reports (PDF)"]} />
                    </div>
                </div>
            </section>

            {/* HOW IT WORKS */}
            <section className="py-16 bg-brand-50/60">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <h2 className="text-3xl font-bold text-slate-900 text-center">How FoodLink works</h2>
                    <div className="mt-10 grid gap-6 md:grid-cols-4">
                        <Step n="1" title="Donors list products they intend to donate" text="Businesses add donations with quantity, storage, and expiry." />
                        <Step n="2" title="Recipients reserve" text="Eligible households request what they need for Collection Day." />
                        <Step n="3" title="Buyers fund ops" text="Everything that is not needed by Recipients is sold at steep discounts." />
                        <Step n="4" title="Volunteers deliver" text="Collection Day pickup with QR tickets; home delivery if enabled." />
                    </div>
                </div>
            </section>

            {/* TESTIMONIALS */}
            <section className="py-16">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
                    <h2 className="text-3xl font-bold text-slate-900 text-center">What people say</h2>
                    <div className="mt-10 grid gap-6 md:grid-cols-3">
                        <Quote text="Knowing I can reserve halal options for my kids changed our week." name="R., Recipient" />
                        <Quote text="We move near-expiry items quickly instead of binning them." name="D., Donor Store Manager" />
                        <Quote text="The dashboard keeps everything smooth and fair." name="V., Volunteer Lead" />
                    </div>
                </div>
            </section>

            {/* CTA */}
            <section className="py-16">
                <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 rounded-3xl bg-gradient-to-br from-brand-600 to-brand-700 text-white p-10 text-center shadow-soft">
                    <h3 className="text-3xl font-bold">Join FoodLink today</h3>
                    <p className="mt-2 text-white/90">Create your account and help us turn surplus into supper.</p>
                    <div className="mt-6 flex justify-center gap-3">
                        <Link to="/register" className="px-6 py-3 rounded-xl bg-white text-brand-700 font-semibold hover:bg-brand-50">Create account</Link>
                        <Link to="/impact" className="px-6 py-3 rounded-xl border border-white/30 font-semibold hover:bg-white/10">See public impact</Link>
                    </div>
                </div>
            </section>

            <Footer />
        </main>
    )
}

function Stat({ num, label }: { num: string; label: string }) {
    return (
        <div className="rounded-2xl bg-brand-50 p-3 text-center">
            <div className="text-xl font-bold text-brand-800">{num}</div>
            <div className="text-xs text-brand-700">{label}</div>
        </div>
    )
}

function Feature({ title, icon, points }: { title: string; icon: string; points: string[] }) {
    return (
        <div className="rounded-3xl bg-white border border-slate-100 p-6 shadow-soft/20">
            <div className="text-3xl">{icon}</div>
            <h3 className="mt-3 text-lg font-semibold text-slate-900">{title}</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
                {points.map(p => (
                    <li key={p} className="flex items-start gap-2">
                        <span className="mt-1 inline-block h-2 w-2 rounded-full bg-accent-500"></span>{p}
                    </li>
                ))}
            </ul>
        </div>
    )
}

function Step({ n, title, text }: { n: string; title: string; text: string }) {
    return (
        <div className="rounded-3xl bg-white border border-slate-100 p-6">
            <div className="h-8 w-8 rounded-full bg-brand-600 text-white grid place-items-center font-bold">{n}</div>
            <h4 className="mt-3 font-semibold text-slate-900">{title}</h4>
            <p className="mt-1 text-sm text-slate-600">{text}</p>
        </div>
    )
}

function Quote({ text, name }: { text: string; name: string }) {
    return (
        <div className="rounded-3xl bg-white border border-slate-100 p-6 shadow-soft/20">
            <p className="text-slate-700">“{text}”</p>
            <div className="mt-3 text-sm text-slate-500">— {name}</div>
        </div>
    )
}
