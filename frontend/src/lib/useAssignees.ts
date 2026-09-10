import { useCallback, useEffect, useState } from 'react'
import { z } from 'zod'
import { errorMessage, request } from './api'
const assigneesSchema = z.array(z.object({ id: z.string(), name: z.string() }))
export type Assignee = z.infer<typeof assigneesSchema>[number]
/** Fetch the filtered directory in pages so older eligible staff remain assignable. */
export function useAssignees(enabled: boolean) {
  const [data, setData] = useState<Assignee[]>([]),
    [loading, setLoading] = useState(enabled),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!enabled) {
      setData([])
      setLoading(false)
      setError('')
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setData([])
    async function load() {
      const people = new Map<string, Assignee>()
      for (let offset = 0; offset <= 100000; offset += 100) {
        const page = await request(`/admin/assignees?limit=100&offset=${offset}`, assigneesSchema, {
          signal: controller.signal,
        })
        for (const person of page) people.set(person.id, person)
        if (page.length < 100) {
          if (!controller.signal.aborted) setData([...people.values()])
          return
        }
      }
      throw new Error('The staff directory is too large to load. Contact the operator.')
    }
    void load()
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [enabled, revision])
  const reload = useCallback(() => setRevision((v) => v + 1), [])
  return { data, loading, error, reload }
}
