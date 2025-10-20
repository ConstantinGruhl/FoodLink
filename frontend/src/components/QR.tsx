import QRCode from 'qrcode'
import { useEffect, useRef } from 'react'


export default function QR({ value, size = 128 }: { value: string; size?: number }) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    useEffect(() => { if (canvasRef.current) QRCode.toCanvas(canvasRef.current, value, { width: size }) }, [value, size])
    return <canvas ref={canvasRef} width={size} height={size} />
}