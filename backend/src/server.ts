import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { initDb, pool } from './db.js'
import uploads from "./uploads.js"
import routes from './routes.js'
import donationsRouter from './routes/donations.js'
import usersRouter from './routes/users.js'
import itemsRouter from './routes/items.js'
import uploadsRouter from './routes/uploads.js'
dotenv.config()

const app = express()
app.use(express.json())
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? '*' }))

app.use('/api', routes)
app.use("/api", uploads)
app.use('/api/donations', donationsRouter)
app.use('/api/users', usersRouter)
app.use('/api/items', itemsRouter)
app.use('/api/uploads', uploadsRouter)

const PORT = process.env.PORT || 8080

async function start() {
    await initDb()

    app.listen(PORT, () => console.log(`Backend listening on :${PORT}`))
}
start()
