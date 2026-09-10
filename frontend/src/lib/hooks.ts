import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { errorMessage, request } from './api'

export function useQuery<T>(path: string | null, schema: z.ZodType<T, z.ZodTypeDef, unknown>) {
  const [data, setData] = useState<T | null>(null),
    [loading, setLoading] = useState(!!path),
    [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const schemaRef = useRef(schema)
  schemaRef.current = schema
  useEffect(() => {
    if (!path) {
      setData(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setData(null)
    setLoading(true)
    setError('')
    request(path, schemaRef.current, { signal: controller.signal })
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [path, revision])
  const reload = useCallback(() => setRevision((v) => v + 1), [])
  return { data, loading, error, reload, setData }
}
export function useAction() {
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('')
  const active = useRef(false)
  async function run<T>(work: () => Promise<T>, message?: string): Promise<T | undefined> {
    if (active.current) return
    active.current = true
    setPending(true)
    setError('')
    setSuccess('')
    try {
      const value = await work()
      if (message) setSuccess(message)
      return value
    } catch (e) {
      setError(errorMessage(e))
      return undefined
    } finally {
      active.current = false
      setPending(false)
    }
  }
  return { pending, error, success, run, setError, setSuccess }
}
