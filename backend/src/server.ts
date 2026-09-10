import { app } from './app.js'
import { config, validateConfig } from './config.js'
import { pool } from './db.js'
import { migrate } from './migrate.js'
import { initializeStorage, cleanOrphanImages, s3 } from './storage.js'
import { processMail } from './communications.js'
import { maintenance, processRefunds } from './orders.js'
async function start() {
  validateConfig()
  if (process.env.MIGRATE_ON_START !== 'false') await migrate()
  await initializeStorage()
  const server = app.listen(config.port, '0.0.0.0', () =>
    console.log(JSON.stringify({ event: 'listening', port: config.port })),
  )
  server.requestTimeout = 30000
  server.headersTimeout = 15000
  let working = false
  const tick = async () => {
    if (working) return
    working = true
    try {
      const results = await Promise.allSettled([maintenance(), processMail(), processRefunds()])
      for (const result of results)
        if (result.status === 'rejected')
          console.error(
            JSON.stringify({
              event: 'worker_job_failed',
              message: result.reason instanceof Error ? result.reason.message : 'unknown',
            }),
          )
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'worker_error',
          message: error instanceof Error ? error.message : 'unknown',
        }),
      )
    } finally {
      working = false
    }
  }
  const runJobs = process.env.RUN_BACKGROUND_JOBS !== 'false'
  const interval = setInterval(() => {
    if (runJobs) void tick()
  }, 15000)
  const cleanup = setInterval(
    () =>
      runJobs &&
      void cleanOrphanImages().catch(() => console.error(JSON.stringify({ event: 'orphan_cleanup_failed' }))),
    3600000,
  )
  interval.unref()
  cleanup.unref()
  if (runJobs) void tick()
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    clearInterval(interval)
    clearInterval(cleanup)
    const timeout = setTimeout(() => process.exit(1), 20000)
    timeout.unref()
    server.close(async () => {
      while (working) await new Promise((resolve) => setTimeout(resolve, 50))
      await pool.end()
      s3.destroy()
      clearTimeout(timeout)
      process.exitCode = 0
    })
    server.closeIdleConnections()
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}
start().catch((error) => {
  console.error(JSON.stringify({ event: 'startup_failed', message: error.message }))
  void pool.end()
  process.exitCode = 1
})
