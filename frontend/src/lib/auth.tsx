import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { mutation, request, setCsrfToken, errorMessage } from './api'
import { configSchema, okSchema, sessionSchema, type Config, type User } from './schemas'
const fallback: Config = {
  currency: 'EUR',
  timezone: 'Europe/Berlin',
  paymentsEnabled: false,
  mailMode: 'outbox',
  organizationName: 'FoodLink',
  supportEmail: '',
  organizationAddress: '',
  privacyContact: '',
  retentionDays: 365,
  legalReady: false,
  demoLoginEnabled: false,
}
type AuthContextValue = {
  user: User | null
  loading: boolean
  error: string
  config: Config
  refresh: () => Promise<void>
  login: (email: string, password: string) => Promise<User>
  register: (data: unknown) => Promise<User>
  logout: () => Promise<void>
  clear: () => void
  setUser: (u: User) => void
  refreshConfig: () => Promise<void>
}
const AuthContext = createContext<AuthContextValue | null>(null)
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [config, setConfig] = useState(fallback)
  const clear = useCallback(() => {
    setCsrfToken(null)
    setUser(null)
  }, [])
  const refresh = useCallback(async () => {
    setError('')
    try {
      const s = await request('/auth/session', sessionSchema)
      setUser(s.user)
      setCsrfToken(s.csrfToken)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])
  const refreshConfig = useCallback(async () => {
    try {
      setConfig(await request('/config', configSchema))
    } catch {
      /* The session error provides connection recovery; commerce remains disabled by default. */
    }
  }, [])
  useEffect(() => {
    localStorage.removeItem('foodshare_user')
    void refresh()
    void refreshConfig()
    window.addEventListener('foodlink:session-expired', clear)
    return () => window.removeEventListener('foodlink:session-expired', clear)
  }, [refresh, refreshConfig, clear])
  async function authenticate(path: string, body: unknown) {
    const s = await mutation(path, sessionSchema, body)
    if (!s.user) throw new Error('Sign-in could not be completed.')
    setCsrfToken(s.csrfToken)
    setUser(s.user)
    return s.user
  }
  async function logout() {
    await mutation('/auth/logout', okSchema)
    clear()
  }
  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        config,
        refresh,
        login: (email, password) => authenticate('/auth/login', { email, password }),
        register: (data) => authenticate('/auth/register', data),
        logout,
        clear,
        setUser,
        refreshConfig,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('AuthProvider missing')
  return value
}
