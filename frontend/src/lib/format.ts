import type { BasketLine, Item, Role } from './schemas'

export const roleHome: Record<Role, string> = {
  recipient: '/recipient',
  buyer: '/market',
  donor: '/donor',
  volunteer: '/volunteer',
  admin: '/admin',
  charity_manager: '/workspace',
  location_manager: '/workspace',
}
export function formatDate(value: string | null | undefined, timezone = 'Europe/Berlin', withTime = false) {
  if (!value) return 'Not specified'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Not specified'
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' as const } : {}),
    timeZone: timezone,
  }).format(date)
}
export function money(cents: number, currency = 'EUR') {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(cents / 100)
}
export function dateOnly(value: string) {
  return value.slice(0, 10)
}
export function shortId(value: string) {
  return value.slice(0, 8).toUpperCase()
}
export function csvList(value: string) {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}
export function setBasketQuantity(
  basket: BasketLine[],
  itemId: string,
  quantity: number,
  available: number,
): BasketLine[] {
  const qty = Math.min(
    Math.max(0, Math.floor(Number.isFinite(quantity) ? quantity : 0)),
    Math.max(0, available),
  )
  const next = basket.filter((line) => line.itemId !== itemId)
  if (qty > 0) next.push({ itemId, qty })
  return next
}
export function validateBasket(basket: BasketLine[], items: Item[]): string | null {
  if (!basket.length) return 'Add at least one item to your basket.'
  if (new Set(basket.map((x) => x.itemId)).size !== basket.length) return 'Each item may appear only once.'
  for (const line of basket) {
    const item = items.find((x) => x.id === line.itemId)
    if (!item || !Number.isInteger(line.qty) || line.qty < 1 || line.qty > item.qty)
      return 'Some quantities are no longer available. Update your basket.'
  }
  return null
}
export function basketTotal(basket: BasketLine[], items: Item[]) {
  return basket.reduce(
    (sum, line) => sum + (items.find((i) => i.id === line.itemId)?.priceCents || 0) * line.qty,
    0,
  )
}
export function localInputDate(value: string) {
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return ''
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}
export function storageLabel(storage: string) {
  return { ambient: 'Room temperature', chilled: 'Keep chilled', frozen: 'Keep frozen' }[storage] || storage
}
export function printRecord(element: HTMLElement | null) {
  if (!element) {
    window.print()
    return
  }
  const host = document.createElement('section')
  host.id = 'foodlink-print'
  host.className = 'print-only'
  host.append(element.cloneNode(true))
  document.body.append(host)
  document.body.classList.add('printing-record')
  try {
    window.print()
  } finally {
    document.body.classList.remove('printing-record')
    host.remove()
  }
}
export function calendarDay(timezone = 'Europe/Berlin', value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}-${parts.find((p) => p.type === 'day')!.value}`
}
export function signInDestination(role: Role, returnTo: unknown) {
  if (typeof returnTo !== 'string' || !returnTo.startsWith('/') || returnTo.startsWith('//'))
    return roleHome[role]
  const pathname = returnTo.split(/[?#]/, 1)[0]
  if (pathname.startsWith('/invite/')) return returnTo
  if (['charity_manager','location_manager'].includes(role)) return ['/workspace','/volunteer','/reports','/profile'].includes(pathname) ? returnTo : '/workspace'
  const allowed: Record<string, Role[]> = {
    '/donor': ['donor', 'admin'],
    '/recipient': ['recipient'],
    '/market': ['buyer'],
    '/volunteer': ['volunteer', 'admin'],
    '/reports': ['volunteer', 'admin'],
    '/admin': ['admin'],
    '/orders': ['donor', 'recipient', 'buyer', 'volunteer', 'admin'],
    '/profile': ['donor', 'recipient', 'buyer', 'volunteer', 'admin'],
    '/notifications': ['donor', 'recipient', 'buyer', 'volunteer', 'admin'],
  }
  return allowed[pathname]?.includes(role) ? returnTo : roleHome[role]
}
