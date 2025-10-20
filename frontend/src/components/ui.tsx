import { cn } from '@/utils/cn'
import { Loader2 } from 'lucide-react'
import React from 'react'


export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn('rounded-2xl shadow-sm border p-4 bg-white', className)} {...props} />
}
export function Button({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    return <button className={cn('rounded-2xl px-4 py-2 border shadow-sm hover:shadow transition active:scale-[.99] disabled:opacity-50', className)} {...props} />
}
export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
    return <input className={cn('w-full rounded-xl border px-3 py-2', className)} {...props} />
}
export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
    return <label className={cn('text-sm text-gray-700', className)} {...props} />
}
export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
    return <select className={cn('w-full rounded-xl border px-3 py-2 bg-white', className)} {...props}>{children}</select>
}
export function Spinner() { return <Loader2 className="animate-spin" /> }