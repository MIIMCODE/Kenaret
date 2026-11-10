/**
 * Voice notes.
 *
 * `MediaRecorder` support is uneven, so everything here degrades to "no voice
 * button" rather than a button that throws. The browser picks the container;
 * we only care that the resulting blob is something the bucket accepts.
 *
 * The tricky part on Android is that the *duration* of a WebM produced by
 * MediaRecorder is frequently `Infinity` — the header is written before the
 * length is known. So the recorder tracks elapsed time itself and the file's
 * metadata is never trusted for the label.
 */

export interface Recording {
  blob: Blob
  /** Milliseconds, measured by the recorder rather than read from the file. */
  ms: number
  mimeType: string
  extension: string
}

/** MIME types in preference order; the first the browser supports wins. */
const CANDIDATES = [
  { mime: 'audio/webm;codecs=opus', ext: 'webm' },
  { mime: 'audio/webm', ext: 'webm' },
  { mime: 'audio/mp4', ext: 'm4a' },
  { mime: 'audio/ogg;codecs=opus', ext: 'ogg' },
  { mime: 'audio/mpeg', ext: 'mp3' },
] as const

export const VOICE_MAX_SECONDS = 300 // 5 minutes, matching the database check

export function pickMimeType(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const candidate of CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate.mime)) {
      return { mime: candidate.mime, ext: candidate.ext }
    }
  }
  // Some browsers report nothing as supported yet still record; let them try
  // with an empty type rather than removing the feature entirely.
  return { mime: '', ext: 'webm' }
}

export function canRecordVoice(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  )
}

export class VoiceRecorder {
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private stream: MediaStream | null = null
  private startedAt = 0
  private timer: number | null = null
  private mime: { mime: string; ext: string } | null = null

  /** Called every 250ms with elapsed milliseconds. */
  onTick: ((ms: number) => void) | null = null

  async start(): Promise<void> {
    if (this.recorder) return

    const picked = pickMimeType()
    if (!picked) throw new Error('UNSUPPORTED')

    // Echo cancellation + noise suppression matter a lot for a phone held at
    // arm's length in a room with a fan.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })

    this.mime = picked
    this.chunks = []
    this.recorder = new MediaRecorder(
      this.stream,
      picked.mime ? { mimeType: picked.mime } : undefined,
    )
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data)
    }

    this.recorder.start()
    this.startedAt = Date.now()
    this.timer = window.setInterval(() => {
      const ms = Date.now() - this.startedAt
      this.onTick?.(ms)
      if (ms >= VOICE_MAX_SECONDS * 1000) void this.stop()
    }, 250)
  }

  get elapsedMs(): number {
    return this.startedAt ? Date.now() - this.startedAt : 0
  }

  /** Stops and resolves with whatever was captured. Rejects if nothing usable. */
  async stop(): Promise<Recording> {
    const recorder = this.recorder
    if (!recorder) throw new Error('NOT_RECORDING')

    const ms = Date.now() - this.startedAt
    const mime = this.mime

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(this.chunks, { type: mime?.mime || 'audio/webm' }))
      }
      recorder.stop()
    })

    this.cleanup()

    // Under a second is a mis-tap, not a message.
    if (ms < 1000 || blob.size === 0) throw new Error('TOO_SHORT')

    return {
      blob,
      ms,
      mimeType: mime?.mime || 'audio/webm',
      extension: mime?.ext || 'webm',
    }
  }

  /** Abandons the recording and releases the microphone. */
  cancel(): void {
    try {
      this.recorder?.stop()
    } catch {
      // Already stopped; nothing to do.
    }
    this.cleanup()
  }

  private cleanup(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer)
      this.timer = null
    }
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    this.recorder = null
    this.chunks = []
    this.startedAt = 0
  }
}

/** `MM:SS` for a duration in milliseconds, in Persian digits. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const mm = Math.floor(total / 60)
  const ss = total % 60
  const text = `${mm}:${String(ss).padStart(2, '0')}`
  return text.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])
}

/** Parses Postgres `interval` text (`HH:MM:SS`) into seconds. */
export function intervalToSeconds(interval: string | null): number {
  if (!interval) return 0
  const parts = interval.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return 0
}
