import { Pool } from 'pg'
import dotenv from 'dotenv'
dotenv.config()

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL
})

// Ensure pgcrypto for gen_random_uuid
export async function initDb() {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;')
}
