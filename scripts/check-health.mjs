const base = process.env.FOODLINK_URL || 'http://localhost:5173'
const start = Date.now()
try {
  const response = await fetch(`${base}/api/ready`, { signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error(`Readiness returned ${response.status}`)
  console.log(
    JSON.stringify({
      status: 'healthy',
      url: base,
      latencyMs: Date.now() - start,
      checkedAt: new Date().toISOString(),
    }),
  )
} catch (error) {
  console.error(
    JSON.stringify({
      status: 'unhealthy',
      url: base,
      message: error.message,
      checkedAt: new Date().toISOString(),
    }),
  )
  process.exit(1)
}
