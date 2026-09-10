import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { z } from 'zod'
import { useAuth } from './auth'
import { errorMessage, request, setLocationId } from './api'
import { membershipSchema } from './schemas'

export const organizationSchema = z.object({
  id: z.string(), name: z.string(), slug: z.string(), currency: z.string(), timezone: z.string(), active: z.boolean(),
  supportEmail: z.string().optional(), address: z.string().optional(), privacyContact: z.string().optional(),
  policies: z.record(z.unknown()).optional(),
})
export const locationSchema = z.object({
  id: z.string(), organizationId: z.string(), organizationName: z.string(), name: z.string(), code: z.string(),
  address: z.string(), city: z.string(), postalCode: z.string(), latitude: z.number().nullable(), longitude: z.number().nullable(),
  openingHours: z.string(), receivingInstructions: z.string(), collectionAvailable: z.boolean(), storageTypes: z.array(z.string()),
  active: z.boolean(), settings: z.record(z.unknown()),
})
export const householdSchema = z.object({
  id: z.string(), organizationId: z.string(), label: z.string(), approvedSize: z.number(), status: z.string(),
  notes: z.string().nullable().optional(), members: z.array(z.object({ id: z.string(), name: z.string(), email: z.string() })),
})
export const workspaceSchema = z.object({
  location: locationSchema, organization: organizationSchema, memberships: z.array(membershipSchema),
  capabilities: z.array(z.string()), households: z.array(householdSchema),
})
export type Location = z.infer<typeof locationSchema>
export type Household = z.infer<typeof householdSchema>
type Workspace = z.infer<typeof workspaceSchema>
type Context = {
  locations: Location[]; selectedId: string; location: Location | null; workspace: Workspace | null;
  loading: boolean; error: string; select: (id: string) => void; reload: () => void; can: (capability: string) => boolean;
}
const Context = createContext<Context | null>(null)
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user, loading: sessionLoading } = useAuth()
  const [locations, setLocations] = useState<Location[]>([]), [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [selectedId, setSelected] = useState(() => localStorage.getItem('foodlink_location') || '')
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision(v => v + 1), [])
  useEffect(() => {
    if (sessionLoading) return
    let current = true
    setLoading(true); setError(''); setWorkspace(null)
    void (async () => {
      try {
        const directory = await request('/locations', z.array(locationSchema))
        if (!current) return
        setLocations(directory)
        const preferred = directory.find(l => l.id === selectedId) || directory.find(l => user?.memberships?.some(m => m.locationId === l.id || (m.organizationId === l.organizationId && !m.locationId))) || directory[0]
        const id = preferred?.id || ''
        setLocationId(id || null)
        if (id !== selectedId) { setSelected(id); localStorage.setItem('foodlink_location', id); return }
        if (user) {
          const value = await request('/workspace', workspaceSchema)
          if (current) setWorkspace(value)
        }
      } catch (e) { if (current) setError(errorMessage(e)) }
      finally { if (current) setLoading(false) }
    })()
    return () => { current = false }
  }, [user?.id, selectedId, revision, sessionLoading])
  const select = useCallback((id: string) => {
    setLocationId(id); localStorage.setItem('foodlink_location', id); setWorkspace(null); setSelected(id)
  }, [])
  const location = locations.find(l => l.id === selectedId) || null
  return <Context.Provider value={{ locations, selectedId, location, workspace, loading, error, select, reload, can: capability => workspace?.capabilities.includes(capability) || false }}>{children}</Context.Provider>
}
export function useWorkspace() {
  return useContext(Context) || { locations: [], selectedId: '', location: null, workspace: null, loading: false, error: '', select: () => {}, reload: () => {}, can: () => false }
}
