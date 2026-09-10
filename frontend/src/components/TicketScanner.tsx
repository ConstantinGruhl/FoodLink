import { useEffect, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { errorMessage } from '../lib/api'
import { Alert } from './ui'
type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> }
type DetectorConstructor = new (options: { formats: string[] }) => Detector
export default function TicketScanner({ onDetected }: { onDetected: (token: string) => void }) {
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    running = useRef(false)
  const [scanning, setScanning] = useState(false),
    [error, setError] = useState('')
  function stop() {
    running.current = false
    if (timer.current) clearTimeout(timer.current)
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    setScanning(false)
  }
  useEffect(
    () => () => {
      running.current = false
      if (timer.current) clearTimeout(timer.current)
      stream.current?.getTracks().forEach((track) => track.stop())
    },
    [],
  )
  async function start() {
    setError('')
    try {
      const Detector = (window as Window & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector
      if (!Detector)
        throw new Error(
          'Camera scanning is unavailable in this browser. Paste or type the text ticket below.',
        )
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error('Camera access requires HTTPS or localhost. Paste the text ticket below.')
      const detector = new Detector({ formats: ['qr_code'] })
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      if (!video.current) return
      video.current.srcObject = stream.current
      await video.current.play()
      running.current = true
      setScanning(true)
      async function scan() {
        if (!running.current || !video.current) return
        try {
          const codes = await detector.detect(video.current)
          if (codes[0]?.rawValue) {
            onDetected(codes[0].rawValue)
            stop()
            return
          }
        } catch {
          /* Frames may be temporarily unavailable while the camera focuses. */
        }
        timer.current = setTimeout(() => void scan(), 350)
      }
      void scan()
    } catch (e) {
      stop()
      setError(errorMessage(e))
    }
  }
  return (
    <div className="stack">
      <div className="row">
        <button type="button" className="btn secondary" onClick={() => (scanning ? stop() : void start())}>
          <Camera size={17} />
          {scanning ? 'Stop camera' : 'Scan QR with camera'}
        </button>
      </div>
      {error && <Alert kind="info">{error}</Alert>}
      <video
        ref={video}
        muted
        playsInline
        style={{ display: scanning ? 'block' : 'none', width: '100%', maxWidth: 450, borderRadius: 12 }}
        aria-label="Ticket scanning camera preview"
      />
    </div>
  )
}
