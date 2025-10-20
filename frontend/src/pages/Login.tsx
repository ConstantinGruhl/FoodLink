import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Input, Label } from '@/components/ui'
import { useAuth } from '@/store/useAuth'

function roleHomePath(role?: string) {
    switch (role) {
        case 'recipient': return '/recipient'
        case 'buyer': return '/market'
        case 'donor': return '/donor'
        case 'volunteer': return '/volunteer'
        case 'admin': return '/admin'
        default: return '/'
    }
}

export default function Login() {
    const [email, setEmail] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const { login } = useAuth()
    const nav = useNavigate()

    const onSubmit = async () => {
        setError(null)
        const e = email.trim().toLowerCase()
        if (!e) return setError('Please enter your email.')
        setLoading(true)
        try {
            // IMPORTANT: await login and use returned user
            const user = await login(e)
            nav(roleHomePath(user?.role), { replace: true })
        } catch (err: any) {
            setError(err?.message || 'Login failed. Check the email and try again.')
        } finally {
            setLoading(false)
        }
    }

    const onKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
        if (ev.key === 'Enter') onSubmit()
    }

    return (
        <Card className="max-w-md mx-auto">
            <h2 className="text-xl font-semibold mb-4">Login</h2>
            <div className="space-y-3">
                <div>
                    <Label>Email</Label>
                    <Input
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        onKeyDown={onKeyDown}
                        placeholder="you@example.com"
                        autoFocus
                        type="email"
                    />
                    {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
                </div>
                <Button onClick={onSubmit} disabled={loading}>
                    {loading ? 'Signing in…' : 'Login'}
                </Button>
                <p className="text-sm text-gray-500">
                    Try: admin@email.com, recipient@email.com,
                    buyer@email.com, donor@email.com,
                    volunteer@email.com
                </p>
            </div>
        </Card>
    )
}
