// src/store/useAuth.ts
import { create } from 'zustand'
import { User } from '@/types'
import { api } from '@/lib/api'

export type RegisterPayload = {
    name: string
    email: string
    role: User['role']
    householdSize?: number
    dietaryNeeds?: string[]
    ngoCode?: string
}

export type AuthState = {
    user: User | null
    login: (email: string) => Promise<User>
    logout: () => void
    register: (payload: RegisterPayload) => Promise<User>
}

const LS_KEY = 'foodshare_user'

function extractUser(data: any): User | null {
    // Accept either { user: {...} } or bare user object
    if (!data) return null
    if (typeof data === 'object' && 'user' in data) return data.user as User
    return data as User
}

export const useAuth = create<AuthState>((set) => ({
    user: (() => {
        try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null') as User | null } catch { return null }
    })(),

    login: async (email: string) => {
        const normalized = email.trim().toLowerCase()
        if (!normalized) throw new Error('Please enter your email.')

        try {
            const { data } = await api.post('/auth/login', { email: normalized })
            const user = extractUser(data)
            if (!user || !user.id) {
                throw new Error('No account found for that email')
            }
            localStorage.setItem(LS_KEY, JSON.stringify(user))
            set({ user })
            return user
        } catch (err: any) {
            // Axios-style error handling
            const status = err?.response?.status
            const msg = err?.response?.data?.message || err?.message

            if (status === 404 || status === 401) {
                throw new Error('No account found for that email')
            }
            throw new Error(msg || 'Login failed. Please try again.')
        }
    },

    logout: () => {
        localStorage.removeItem(LS_KEY)
        set({ user: null })
        // Optionally: await api.post('/auth/logout').catch(() => {})
    },

    register: async (payload) => {
        // Normalize email for consistency
        const body = { ...payload, email: payload.email.trim().toLowerCase() }
        try {
            const { data } = await api.post('/auth/register', body)
            const user = extractUser(data)
            if (!user || !user.id) {
                throw new Error('Registration failed. Please try again.')
            }
            localStorage.setItem(LS_KEY, JSON.stringify(user))
            set({ user })
            return user
        } catch (err: any) {
            const msg = err?.response?.data?.message || err?.message
            throw new Error(msg || 'Registration failed. Please try again.')
        }
    },
}))
