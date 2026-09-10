import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Bell, Leaf, Menu, UserRound, X, LogOut } from 'lucide-react'
import { AuthProvider, useAuth } from './lib/auth'
import { roleHome } from './lib/format'
import { errorMessage } from './lib/api'
import type { Role } from './lib/schemas'
import { Alert, ErrorBoundary, ErrorPanel, Loading, PageHead } from './components/ui'
import { WorkspaceProvider, useWorkspace } from './lib/workspace'
import LocationSelector from './components/LocationSelector'
const Home = lazy(() => import('./pages/Home'))
const Impact = lazy(() => import('./pages/PublicImpact'))
const Auth = lazy(() => import('./pages/Auth'))
const Donor = lazy(() => import('./pages/DonorDashboard'))
const Catalog = lazy(() => import('./pages/Catalog'))
const Operations = lazy(() => import('./pages/VolunteerDashboard'))
const Admin = lazy(() => import('./pages/AdminPanel'))
const Orders = lazy(() => import('./pages/Orders'))
const Profile = lazy(() => import('./pages/Profile'))
const Notifications = lazy(() => import('./pages/Notifications'))
const Legal = lazy(() => import('./pages/Legal'))
const Reports = lazy(() => import('./pages/Reports'))
const Workspace = lazy(() => import('./pages/Workspace'))
const Invitation = lazy(() => import('./pages/Invitation'))
const RecipientVisits = lazy(() => import('./pages/RecipientVisits'))
function Protected({ roles, capability, platform, children }: { roles?: Role[]; capability?: string; platform?: boolean; children: ReactNode }) {
  const { user, loading, error, refresh } = useAuth()
  const context = useWorkspace()
  const location = useLocation()
  if (loading) return <Loading label="Restoring your session…" />
  if (error) return <ErrorPanel error={error} retry={() => void refresh()} />
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (capability && context.loading) return <Loading label="Loading your location permissions…" />
  if (capability && context.error) return <ErrorPanel error={context.error} retry={context.reload} />
  if ((capability && !context.can(capability)) || (platform && !user.platformAdmin)) return <div className="stack"><PageHead title="No team access at this location" description="Select a location where you have an active membership, or ask your charity manager for an invitation."/><Link className="btn" to="/donor">Open donor workspace</Link></div>
  if (roles && !roles.includes(user.role))
    return (
      <div className="stack">
        <PageHead
          title="This area is for another role"
          description="Your account has access to the workspace below."
        />
        <Link className="btn" to={roleHome[user.role]}>
          Open my workspace
        </Link>
      </div>
    )
  return <div key={user.id}>{children}</div>
}
function Navigation() {
  const { user, logout } = useAuth()
  const context = useWorkspace()
  const [open, setOpen] = useState(false),
    [error, setError] = useState('')
  const location = useLocation(),
    navigate = useNavigate()
  useEffect(() => {
    setOpen(false)
    setError('')
    window.scrollTo(0, 0)
  }, [location.pathname])
  async function signOut() {
    try {
      await logout()
      navigate('/login', { replace: true, state: null })
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  const links = (
    <>
      <NavLink to="/" end className="nav-link">
        Home
      </NavLink>
      <NavLink to="/impact" className="nav-link">
        Our impact
      </NavLink>
      {user ? (
        <>
          <NavLink to="/donor" className="nav-link">Donate</NavLink>
          <NavLink to="/recipient" className="nav-link">Food visits</NavLink>
          <NavLink to="/market" className="nav-link">Surplus</NavLink>
          {context.can('read') && <NavLink to="/workspace" className="nav-link">Team</NavLink>}
          {user.platformAdmin && <NavLink to="/admin" className="nav-link">Platform</NavLink>}
          <NavLink to="/orders" className="nav-link">Orders</NavLink>
          <NavLink to="/notifications" className="nav-link">
            <Bell size={17} />
            Inbox
          </NavLink>
          <NavLink to="/profile" className="nav-link">
            <UserRound size={17} />
            Account
          </NavLink>
          <button className="btn text" onClick={() => void signOut()} aria-label="Sign out">
            <LogOut size={18} />
          </button>
        </>
      ) : (
        <>
          <NavLink to="/login" className="nav-link">
            Sign in
          </NavLink>
          <Link to="/register" className="btn small">
            Join FoodLink
          </Link>
        </>
      )}
    </>
  )
  return (
    <header className="app-header">
      <div className="nav-inner">
        <Link className="brand" to="/" aria-label="FoodLink home">
          <span className="brand-icon">
            <Leaf size={23} />
          </span>
          FoodLink
        </Link>
        <nav className="desktop-nav" aria-label="Main navigation">
          {links}
        </nav>
        <button
          className="icon-button mobile-toggle"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="mobile-navigation"
          aria-label={open ? 'Close navigation' : 'Open navigation'}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>
      {open && (
        <nav className="mobile-nav" id="mobile-navigation" aria-label="Mobile navigation">
          {links}
        </nav>
      )}
      {error && <Alert>{error}</Alert>}
    </header>
  )
}
function Footer() {
  const { config } = useAuth()
  return (
    <footer className="app-footer">
      <div className="footer-inner">
        <div>
          <Link className="brand" to="/">
            <Leaf size={24} />
            FoodLink
          </Link>
          <p>Food shared. Communities connected.</p>
          <p>
            {config.organizationName} · {config.timezone} · {config.currency}
          </p>
        </div>
        <div className="footer-links">
          <Link to="/impact">Impact & methodology</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms & food guidance</Link>
          {config.supportEmail && <a href={`mailto:${config.supportEmail}`}>Contact operator</a>}
        </div>
      </div>
    </footer>
  )
}
function Application() {
  const context = useWorkspace()
  return (
    <>
        <a className="skip" href="#main-content">
          Skip to content
        </a>
        <Navigation />
        <main className="page" id="main-content">
          <LocationSelector />
          <Suspense key={context.selectedId} fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/landing" element={<Navigate to="/" replace />} />
              <Route path="/impact" element={<Impact />} />
              <Route path="/invite/:token" element={<Invitation />} />
              <Route path="/workspace" element={<Protected capability="read"><Workspace /></Protected>} />
              {['login', 'register', 'forgot-password', 'reset-password', 'verify-email'].map((path) => (
                <Route key={path} path={`/${path}`} element={<Auth />} />
              ))}
              <Route
                path="/donor"
                element={
                  <Protected>
                    <Donor />
                  </Protected>
                }
              />
              <Route
                path="/recipient"
                element={
                  <Protected>
                    <RecipientVisits />
                  </Protected>
                }
              />
              <Route path="/recipient/items" element={<Protected><Catalog mode="recipient" /></Protected>} />
              <Route
                path="/market"
                element={
                  <Protected>
                    <Catalog mode="buyer" />
                  </Protected>
                }
              />
              <Route
                path="/volunteer"
                element={
                  <Protected capability="read">
                    <Operations />
                  </Protected>
                }
              />
              <Route
                path="/admin"
                element={
                  <Protected platform>
                    <Admin />
                  </Protected>
                }
              />
              <Route
                path="/reports"
                element={
                  <Protected capability="read">
                    <Reports />
                  </Protected>
                }
              />
              <Route
                path="/orders"
                element={
                  <Protected>
                    <Orders />
                  </Protected>
                }
              />
              <Route
                path="/profile"
                element={
                  <Protected>
                    <Profile />
                  </Protected>
                }
              />
              <Route
                path="/notifications"
                element={
                  <Protected>
                    <Notifications />
                  </Protected>
                }
              />
              <Route path="/privacy" element={<Legal kind="privacy" />} />
              <Route path="/terms" element={<Legal kind="terms" />} />
              <Route
                path="*"
                element={
                  <div className="stack">
                    <PageHead
                      title="Page not found"
                      description="This link may have moved. Return home to find your workspace."
                    />
                    <Link className="btn" to="/">
                      Return home
                    </Link>
                  </div>
                }
              />
            </Routes>
          </Suspense>
        </main>
        <Footer />
    </>
  )
}
export default function App() { return <ErrorBoundary><AuthProvider><WorkspaceProvider><Application /></WorkspaceProvider></AuthProvider></ErrorBoundary> }
