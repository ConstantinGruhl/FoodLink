import { Pool, PoolClient } from 'pg'
import { config } from './config.js'
export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 15,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
})
pool.on('error', () => console.error(JSON.stringify({ event: 'database_connection_error' })))
export type Db = Pick<PoolClient, 'query'>
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      if (attempt >= 2 || !['40P01', '40001'].includes((error as { code?: string }).code || '')) throw error
    } finally {
      client.release()
    }
    await new Promise((resolve) => setTimeout(resolve, 25 + Math.random() * 75))
  }
}
