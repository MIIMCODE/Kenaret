import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import Avatar from '../components/Avatar'
import Spinner from '../components/Spinner'
import {
  deleteMessage,
  editMessage,
  fetchCurrentCouple,
  fetchMessages,
  fetchPairingState,
  fetchPinned,
  forwardMessage,
  markMessagesRead,
  partnerIsTyping,
  searchMessages,
  sendImage,
  sendMessage,
  sendVoice,
  setTyping,
  togglePin,
} from '../lib/api'
import {
  dayLabel,
  draftMessage,
  formatTime,
  localDay,
  quoteLine,
  readImageSize,
  resolveChatAudio,
  resolveChatImage,
  uploadChatImage,
  uploadChatVoice,
  validateChatImage,
} from '../lib/chat'
import {
  canRecordVoice,
  formatDuration,
  intervalToSeconds,
  VoiceRecorder,
  VOICE_MAX_SECONDS,
} from '../lib/recorder'
import { toPersianError } from '../lib/errors'
import { toPersianDigits } from '../lib/jalali'
import { useAuth } from '../hooks/useAuth'
import type { ChatMessage } from '../types/database'

/**
 * گفت‌وگو.
 *
 * Deliberate decisions, because a chat between two people is easy to get
 * subtly wrong:
 *
 * · Newest-first in state, oldest-first on screen. The server pages backwards
 *   from a cursor, which is the only shape that stays cheap when the thread is
 *   a year old; the render reverses it.
 *
 * · Reads are *sent*, not inferred. Opening the screen marks everything up to
 *   the newest message, but nothing is marked while the tab is hidden — a phone
 *   in a pocket must not swallow «دیده شد».
 *
 * · Sending is optimistic but honest. The bubble appears at once, becomes ✓ when
 *   the server confirms, and on failure hands the text back to the composer.
 *
 * · Polling, not websockets. Two people send a handful of messages a day; a
 *   short poll that stops when the tab hides cannot half-open on a slept phone.
 *   Push covers the closed-app case.
 */

const POLL_MS = 6000
const PAGE_SIZE = 30

type Sheet = null | 'search' | 'pinned' | 'info'

export default function ChatPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [partner, setPartner] = useState<{ id: string; name: string; avatar: string | null } | null>(
    null,
  )
  const [coupleId, setCoupleId] = useState<string | null>(null)

  const [body, setBody] = useState('')
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [editBody, setEditBody] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const [uploading, setUploading] = useState(false)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [highlight, setHighlight] = useState<string | null>(null)

  // ---- voice ----
  const [recording, setRecording] = useState(false)
  const [recordMs, setRecordMs] = useState(0)
  const recorderRef = useRef<VoiceRecorder | null>(null)
  const voiceSupported = useRef(canRecordVoice())

  // ---- typing ----
  const [partnerTyping, setPartnerTyping] = useState(false)
  const lastTypingSent = useRef(0)

  const bottomRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const pollRef = useRef<number | null>(null)
  const pendingRef = useRef<Set<string>>(new Set())
  const landedRef = useRef(false)

  // ----------------------------------------------------------------
  // Who am I talking to
  // ----------------------------------------------------------------
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const state = await fetchPairingState()
        if (!alive) return
        if (!state.partner) {
          navigate('/app', { replace: true })
          return
        }
        setPartner({
          id: state.partner.id,
          name: state.partner.display_name ?? 'شریکت',
          avatar: state.partner.avatar_url,
        })
        const couple = await fetchCurrentCouple()
        setCoupleId(couple?.id ?? null)
      } catch (err) {
        if (alive) setError(toPersianError(err))
      }
    })()
    return () => {
      alive = false
    }
  }, [navigate])

  // ----------------------------------------------------------------
  // Loading + polling
  // ----------------------------------------------------------------
  const mergeLatest = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true)
    try {
      const page = await fetchMessages(null, PAGE_SIZE)
      setMessages((prev) => {
        const optimistic = prev.filter((m) => pendingRef.current.has(m.id))
        const ids = new Set(page.map((m) => m.id))
        const merged = [...page, ...optimistic.filter((m) => !ids.has(m.id))]
        merged.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        return merged
      })
      setHasMore(page.length === PAGE_SIZE)
      setError(null)
    } catch (err) {
      setError(toPersianError(err))
    } finally {
      if (showSpinner) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void mergeLatest(true)
  }, [mergeLatest])

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return
      void mergeLatest(false)
      void partnerIsTyping().then(setPartnerTyping, () => undefined)
    }

    const start = () => {
      if (pollRef.current !== null) return
      pollRef.current = window.setInterval(tick, POLL_MS)
    }
    const stop = () => {
      if (pollRef.current === null) return
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void mergeLatest(false)
        start()
      } else {
        stop()
        setPartnerTyping(false)
      }
    }

    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [mergeLatest])

  const newestIncoming = messages.find((m) => m.sender_id !== user?.id && !m.deleted_at)
  useEffect(() => {
    if (!newestIncoming) return
    if (document.visibilityState !== 'visible') return
    void markMessagesRead(newestIncoming.created_at).catch(() => undefined)
  }, [newestIncoming])

  // ----------------------------------------------------------------
  // Scrolling
  // ----------------------------------------------------------------
  const scrollToBottom = useCallback((smooth = false) => {
    // `scrollIntoView` is missing on some older Android WebViews, and an
    // optional chain on the *element* does not save you from that.
    const anchor = bottomRef.current
    const list = listRef.current
    if (anchor && typeof anchor.scrollIntoView === 'function') {
      anchor.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' })
    } else if (list) {
      list.scrollTop = list.scrollHeight
    }
  }, [])

  useEffect(() => {
    if (landedRef.current || loading || messages.length === 0) return
    landedRef.current = true
    requestAnimationFrame(() => scrollToBottom(false))
  }, [loading, messages.length, scrollToBottom])

  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMore || messages.length === 0) return
    const oldest = messages[messages.length - 1]
    setLoadingOlder(true)
    const before = listRef.current?.scrollHeight ?? 0
    try {
      const older = await fetchMessages(oldest.created_at, PAGE_SIZE)
      setHasMore(older.length === PAGE_SIZE)
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id))
        return [...prev, ...older.filter((m) => !ids.has(m.id))]
      })
      requestAnimationFrame(() => {
        const el = listRef.current
        if (el) el.scrollTop += el.scrollHeight - before
      })
    } catch (err) {
      setError(toPersianError(err))
    } finally {
      setLoadingOlder(false)
    }
  }, [hasMore, loadingOlder, messages])

  // ----------------------------------------------------------------
  // Typing signal (throttled: one write every few seconds is plenty)
  // ----------------------------------------------------------------
  const notifyTyping = useCallback(() => {
    const now = Date.now()
    if (now - lastTypingSent.current < 3000) return
    lastTypingSent.current = now
    void setTyping()
  }, [])

  // ----------------------------------------------------------------
  // Sending
  // ----------------------------------------------------------------
  const send = useCallback(async () => {
    const text = body.trim()
    if (!text || sending) return

    const tempId = `temp-${crypto.randomUUID()}`
    const optimistic = draftMessage({
      id: tempId,
      senderId: user?.id ?? '',
      body: text,
      replyTo: replyTo?.id ?? null,
      replyBody: replyTo ? quoteLine(replyTo) : null,
      replyKind: replyTo?.kind ?? null,
    })

    pendingRef.current.add(tempId)
    setMessages((prev) => [optimistic, ...prev])
    setBody('')
    setReplyTo(null)
    setSendError(null)
    setSending(true)
    requestAnimationFrame(() => scrollToBottom(true))

    try {
      const saved = await sendMessage(text, optimistic.reply_to)
      pendingRef.current.delete(tempId)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId ? { ...m, id: saved.id, created_at: saved.created_at } : m,
        ),
      )
    } catch (err) {
      pendingRef.current.delete(tempId)
      setMessages((prev) => prev.filter((m) => m.id !== tempId))
      // Never lose what someone just wrote.
      setBody(text)
      setReplyTo(replyTo)
      setSendError(toPersianError(err))
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }, [body, replyTo, scrollToBottom, sending, user?.id])

  const pickImage = useCallback(
    async (file: File | undefined) => {
      if (!file || !coupleId) return
      const problem = validateChatImage(file)
      if (problem) {
        setSendError(problem)
        return
      }
      setUploading(true)
      setSendError(null)
      try {
        const size = await readImageSize(file)
        const path = await uploadChatImage(coupleId, file)
        const saved = await sendImage(path, size?.width ?? null, size?.height ?? null)
        setMessages((prev) => [
          draftMessage({
            id: saved.id,
            senderId: user?.id ?? '',
            kind: 'image',
            mediaPath: path,
            mediaW: size?.width ?? null,
            mediaH: size?.height ?? null,
            createdAt: saved.created_at,
          }),
          ...prev.filter((m) => m.id !== saved.id),
        ])
        requestAnimationFrame(() => scrollToBottom(true))
      } catch (err) {
        setSendError(toPersianError(err))
      } finally {
        setUploading(false)
        if (fileRef.current) fileRef.current.value = ''
      }
    },
    [coupleId, scrollToBottom, user?.id],
  )

  // ----------------------------------------------------------------
  // Voice
  // ----------------------------------------------------------------
  const startRecording = useCallback(async () => {
    if (recording || !coupleId) return
    setSendError(null)
    try {
      const recorder = new VoiceRecorder()
      recorder.onTick = setRecordMs
      await recorder.start()
      recorderRef.current = recorder
      setRecordMs(0)
      setRecording(true)
    } catch {
      setSendError('دسترسی به میکروفون نشد. از تنظیمات مرورگر اجازه بده.')
    }
  }, [coupleId, recording])

  const cancelRecording = useCallback(() => {
    recorderRef.current?.cancel()
    recorderRef.current = null
    setRecording(false)
    setRecordMs(0)
  }, [])

  const finishRecording = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder || !coupleId) return
    setRecording(false)
    try {
      const take = await recorder.stop()
      recorderRef.current = null
      setUploading(true)
      const path = await uploadChatVoice(coupleId, take.blob, take.extension)
      const seconds = Math.round(take.ms / 1000)
      const saved = await sendVoice(path, seconds, replyTo?.id ?? null)
      setMessages((prev) => [
        draftMessage({
          id: saved.id,
          senderId: user?.id ?? '',
          kind: 'voice',
          mediaPath: path,
          duration: `00:00:${String(seconds).padStart(2, '0')}`,
          replyTo: replyTo?.id ?? null,
          replyBody: replyTo ? quoteLine(replyTo) : null,
          replyKind: replyTo?.kind ?? null,
          createdAt: saved.created_at,
        }),
        ...prev.filter((m) => m.id !== saved.id),
      ])
      setReplyTo(null)
      requestAnimationFrame(() => scrollToBottom(true))
    } catch (err) {
      recorderRef.current = null
      const message = err instanceof Error ? err.message : ''
      setSendError(
        message === 'TOO_SHORT'
          ? 'خیلی کوتاه بود — دستت را کمی بیشتر نگه دار.'
          : toPersianError(err),
      )
    } finally {
      setUploading(false)
      setRecordMs(0)
    }
  }, [coupleId, replyTo, scrollToBottom, user?.id])

  // ----------------------------------------------------------------
  // Edit / delete / pin / forward
  // ----------------------------------------------------------------
  const startEdit = useCallback((message: ChatMessage) => {
    setEditing(message)
    setEditBody(message.body)
    setSendError(null)
  }, [])

  const submitEdit = useCallback(async () => {
    if (!editing) return
    const text = editBody.trim()
    if (!text) return
    setBusyId(editing.id)
    try {
      await editMessage(editing.id, text)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === editing.id ? { ...m, body: text, edited_at: new Date().toISOString() } : m,
        ),
      )
      setEditing(null)
      setEditBody('')
    } catch (err) {
      setSendError(toPersianError(err))
    } finally {
      setBusyId(null)
    }
  }, [editBody, editing])

  const remove = useCallback(async (message: ChatMessage) => {
    if (!confirm('این پیام برای هر دو نفر حذف می‌شود. مطمئنی؟')) return
    setBusyId(message.id)
    try {
      await deleteMessage(message.id)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === message.id
            ? { ...m, body: '', media_path: null, deleted_at: new Date().toISOString(), pinned: false }
            : m,
        ),
      )
    } catch (err) {
      setSendError(toPersianError(err))
    } finally {
      setBusyId(null)
    }
  }, [])

  const pin = useCallback(async (message: ChatMessage) => {
    setBusyId(message.id)
    try {
      const pinned = await togglePin(message.id)
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, pinned } : m)))
    } catch (err) {
      setSendError(toPersianError(err))
    } finally {
      setBusyId(null)
    }
  }, [])

  const forwardAs = useCallback(
    async (message: ChatMessage) => {
      setBusyId(message.id)
      try {
        const saved = await forwardMessage(message.id)
        setMessages((prev) => [
          {
            ...message,
            id: saved.id,
            sender_id: user?.id ?? message.sender_id,
            created_at: saved.created_at,
            forward: true,
            pinned: false,
            seen: false,
            reply_to: null,
            reply_body: null,
            reply_kind: null,
            edited_at: null,
          },
          ...prev,
        ])
        requestAnimationFrame(() => scrollToBottom(true))
      } catch (err) {
        setSendError(toPersianError(err))
      } finally {
        setBusyId(null)
      }
    },
    [scrollToBottom, user?.id],
  )

  /** Jumping to a searched message: load until it is on screen, then flash it. */
  const jumpTo = useCallback(
    async (target: ChatMessage) => {
      setSheet(null)
      setHighlight(target.id)
      const already = messages.some((m) => m.id === target.id)
      if (!already) {
        try {
          // Walk back until the target is in the loaded window (bounded).
          let cursor: string | null = messages[messages.length - 1]?.created_at ?? null
          let collected = messages
          for (let i = 0; i < 12 && cursor; i += 1) {
            const page: ChatMessage[] = await fetchMessages(cursor, PAGE_SIZE)
            if (page.length === 0) break
            collected = [...collected, ...page]
            cursor = page[page.length - 1].created_at
            if (page.some((m) => m.id === target.id)) break
          }
          setMessages(collected)
        } catch {
          // Falling back to "not found on screen" is better than an error wall.
        }
      }
      requestAnimationFrame(() => {
        const el = document.getElementById(`m-${target.id}`)
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      })
      window.setTimeout(() => setHighlight(null), 2400)
    },
    [messages],
  )

  // ----------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------
  const chronological = useMemo(() => [...messages].reverse(), [messages])

  const rows = useMemo(
    () =>
      chronological.map((message, index) => {
        const prev = chronological[index - 1]
        const newDay = !prev || localDay(prev.created_at) !== localDay(message.created_at)
        return { message, daySeparator: newDay ? dayLabel(message.created_at) : null }
      }),
    [chronological],
  )

  const pinnedCount = messages.filter((m) => m.pinned).length

  return (
    <div className="flex min-h-dvh flex-col bg-cream">
      <AppHeader />

      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col">
        {/* ---- header ---- */}
        <div className="sticky top-[61px] z-20 flex items-center gap-2.5 border-b border-blush-100/70 bg-cream/95 px-4 py-2.5 backdrop-blur">
          <Link
            to="/app"
            aria-label="بازگشت"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/80 text-ink-500 shadow-card"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M9 6l6 6-6 6"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                transform="rotate(180 12 12)"
              />
            </svg>
          </Link>

          <Avatar src={partner?.avatar} name={partner?.name} size={36} />

          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-extrabold text-ink-900">
              {partner?.name ?? '…'}
            </p>
            <p className="h-[13px] text-[10px] text-ink-500">
              {partnerTyping ? (
                <span className="text-blush-600">دارد می‌نویسد…</span>
              ) : (
                'فقط شما دو نفر می‌بینید'
              )}
            </p>
          </div>

          <IconButton label="جست‌وجو" onClick={() => setSheet('search')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
              <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </IconButton>

          <IconButton
            label="سنجاق‌شده‌ها"
            onClick={() => setSheet('pinned')}
            badge={pinnedCount > 0 ? pinnedCount : undefined}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 17v5M9 3h6l-1 6 3 3H7l3-3-1-6z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </IconButton>
        </div>

        {/* ---- thread ---- */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto px-3 py-3"
          style={{
            maxHeight: 'calc(100dvh - 235px)',
            minHeight: '46vh',
            /* The composer now floats above the tab bar, so the last message
               needs that extra strip of room or it ends up under the pill. */
            paddingBottom: 'calc(5.5rem + env(safe-area-inset-bottom))',
          }}
        >
          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner className="h-6 w-6 text-blush-500" />
            </div>
          ) : messages.length === 0 ? (
            <EmptyThread partnerName={partner?.name} />
          ) : (
            <>
              {hasMore && (
                <div className="mb-3 flex justify-center">
                  <button
                    type="button"
                    onClick={() => void loadOlder()}
                    disabled={loadingOlder}
                    className="rounded-full bg-white px-4 py-1.5 text-[12px] font-bold text-blush-600 shadow-card disabled:opacity-50"
                  >
                    {loadingOlder ? 'در حال آوردن…' : 'پیام‌های قدیمی‌تر'}
                  </button>
                </div>
              )}

              {rows.map(({ message, daySeparator }) => (
                <div key={message.id} id={`m-${message.id}`}>
                  {daySeparator && (
                    <div className="my-3.5 flex items-center gap-3">
                      <div className="h-px flex-1 bg-blush-100" />
                      <span className="text-[10.5px] font-bold text-ink-500">{daySeparator}</span>
                      <div className="h-px flex-1 bg-blush-100" />
                    </div>
                  )}
                  <Bubble
                    message={message}
                    mine={message.sender_id === user?.id}
                    pending={pendingRef.current.has(message.id)}
                    busy={busyId === message.id}
                    highlighted={highlight === message.id}
                    onReply={() => {
                      setReplyTo(message)
                      inputRef.current?.focus()
                    }}
                    onEdit={startEdit}
                    onDelete={remove}
                    onPin={pin}
                    onForward={forwardAs}
                  />
                </div>
              ))}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {error && (
          <div className="mx-3 mb-2 rounded-2xl bg-red-50 px-4 py-2.5 text-[12px] font-bold text-red-600">
            {error}
          </div>
        )}
        {sendError && (
          <div className="mx-3 mb-2 flex items-start gap-2 rounded-2xl bg-red-50 px-4 py-2.5">
            <p className="flex-1 text-[12px] font-bold text-red-600">{sendError}</p>
            <button
              type="button"
              onClick={() => setSendError(null)}
              className="text-[11px] font-bold text-red-400"
            >
              بستن
            </button>
          </div>
        )}

        {/* ---- composer ---- */}
        <div
          className="sticky z-10 border-t border-blush-100 bg-cream/95 px-2.5 pt-2 backdrop-blur"
          style={{
            /* Sit on top of the tab bar, not under it. Measured height of the
               pill is 62px plus its own 12px bottom gap; the safe-area inset is
               already inside that number because the bar includes it. */
            bottom: 'calc(4.75rem + env(safe-area-inset-bottom))',
            paddingBottom: '0.625rem',
          }}
        >
          {/* reply preview */}
          {replyTo && !recording && (
            <div className="mb-2 flex items-center gap-2 rounded-2xl bg-blush-50 px-3 py-1.5">
              <span className="h-6 w-0.5 shrink-0 rounded bg-blush-400" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold text-blush-700">
                  {replyTo.sender_id === user?.id ? 'به خودت' : `به ${partner?.name ?? 'شریکت'}`}
                </p>
                <p className="truncate text-[11px] text-ink-700">{quoteLine(replyTo)}</p>
              </div>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                aria-label="لغو پاسخ"
                className="text-ink-500"
              >
                ✕
              </button>
            </div>
          )}

          {recording ? (
            /* ---- recording bar ---- */
            <div className="flex items-center gap-2.5 px-1 py-1">
              <button
                type="button"
                onClick={cancelRecording}
                aria-label="لغو ضبط"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blush-50 text-red-500"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>

              <div className="flex flex-1 items-center gap-2 rounded-3xl bg-white px-4 py-2.5">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
                <span className="text-[13px] font-extrabold tabular-nums text-ink-900">
                  {formatDuration(recordMs)}
                </span>
                <span className="text-[10.5px] text-ink-500">
                  {VOICE_MAX_SECONDS - Math.round(recordMs / 1000) > 0
                    ? `تا ${toPersianDigits(VOICE_MAX_SECONDS - Math.round(recordMs / 1000))} ثانیه`
                    : 'در حال فرستادن…'}
                </span>
              </div>

              <button
                type="button"
                onClick={() => void finishRecording()}
                aria-label="فرستادن صدا"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blush-500 text-white shadow-soft active:scale-95"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M4 12l16-7-7 16-2.2-6.8L4 12z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                    transform="scale(-1 1) translate(-24 0)"
                  />
                </svg>
              </button>
            </div>
          ) : (
            <div className="flex items-end gap-1.5">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => void pickImage(event.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || !coupleId}
                aria-label="فرستادن عکس"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-ink-500 shadow-card transition hover:text-blush-600 disabled:opacity-40"
              >
                {uploading ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="1.7" />
                    <circle cx="8.5" cy="10" r="1.6" fill="currentColor" />
                    <path
                      d="M4 16.5l4.5-4a2 2 0 0 1 2.7 0L20 20"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
              </button>

              <textarea
                ref={inputRef}
                value={body}
                onChange={(event) => {
                  setBody(event.target.value)
                  if (sendError) setSendError(null)
                  if (event.target.value.trim()) notifyTyping()
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void send()
                  }
                  if (event.key === 'Escape') setReplyTo(null)
                }}
                rows={1}
                maxLength={2000}
                placeholder="یک چیزی بنویس…"
                aria-label="متن پیام"
                className="max-h-32 min-h-[40px] flex-1 resize-none rounded-3xl border border-blush-100 bg-white px-4 py-2.5 text-[14px] text-ink-900 outline-none placeholder:text-ink-500/60 focus:border-blush-300"
                style={{ fieldSizing: 'content' } as React.CSSProperties}
              />

              {/* Mic when there is nothing to send, send button when there is. */}
              {body.trim() ? (
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={sending}
                  aria-label="فرستادن"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blush-500 text-white shadow-soft transition active:scale-95 disabled:opacity-40"
                >
                  {sending ? (
                    <Spinner className="h-4 w-4 text-white" />
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M4 12l16-7-7 16-2.2-6.8L4 12z"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinejoin="round"
                        transform="scale(-1 1) translate(-24 0)"
                      />
                    </svg>
                  )}
                </button>
              ) : voiceSupported.current ? (
                <button
                  type="button"
                  onClick={() => void startRecording()}
                  disabled={uploading || !coupleId}
                  aria-label="ضبط پیام صوتی"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blush-500 text-white shadow-soft transition active:scale-95 disabled:opacity-40"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
                    <path
                      d="M5 11a7 7 0 0 0 14 0M12 18v3"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled
                  aria-label="فرستادن"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blush-200 text-white"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M4 12l16-7-7 16-2.2-6.8L4 12z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinejoin="round"
                      transform="scale(-1 1) translate(-24 0)"
                    />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---- sheets ---- */}
      {sheet === 'search' && (
        <SearchSheet onClose={() => setSheet(null)} onJump={(m) => void jumpTo(m)} />
      )}
      {sheet === 'pinned' && (
        <PinnedSheet onClose={() => setSheet(null)} onJump={(m) => void jumpTo(m)} />
      )}

      {/* ---- edit sheet ---- */}
      {editing && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink-900/40 px-4 pb-6 sm:items-center">
          <div className="w-full max-w-lg rounded-4xl bg-white p-5 shadow-soft">
            <p className="mb-3 text-[14px] font-extrabold text-ink-900">ویرایش پیام</p>
            <textarea
              value={editBody}
              onChange={(event) => setEditBody(event.target.value)}
              rows={3}
              maxLength={2000}
              className="w-full resize-none rounded-2xl border border-blush-100 bg-cream px-4 py-3 text-[14px] text-ink-900 outline-none focus:border-blush-300"
            />
            <p className="mt-1.5 text-[11px] text-ink-500">
              شریکت می‌بیند که این پیام ویرایش شده — چیزی بی‌صدا عوض نمی‌شود.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditing(null)
                  setEditBody('')
                }}
                className="flex-1 rounded-full bg-blush-50 py-2.5 text-[13px] font-bold text-ink-700"
              >
                بی‌خیال
              </button>
              <button
                type="button"
                onClick={() => void submitEdit()}
                disabled={!editBody.trim() || busyId === editing.id}
                className="flex-1 rounded-full bg-blush-500 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
              >
                {busyId === editing.id ? '…' : 'ذخیره'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------
// Small pieces
// ------------------------------------------------------------------
function IconButton({
  label,
  onClick,
  badge,
  children,
}: {
  label: string
  onClick: () => void
  badge?: number
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/80 text-ink-500 shadow-card transition hover:text-blush-600"
    >
      {children}
      {badge !== undefined && (
        <span className="absolute -top-0.5 -left-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-blush-500 px-0.5 text-[8.5px] font-extrabold leading-none text-white">
          {toPersianDigits(badge)}
        </span>
      )}
    </button>
  )
}

/** A quoted original inside a reply. */
function Quote({ message }: { message: ChatMessage }) {
  const text =
    message.reply_kind === 'image'
      ? '📷 عکس'
      : message.reply_kind === 'voice'
        ? '🎙 پیام صوتی'
        : message.reply_body?.trim() || 'پیام حذف شد'

  return (
    <div className="mb-1.5 flex items-start gap-1.5 rounded-xl bg-black/10 px-2 py-1">
      <span className="mt-0.5 h-4 w-0.5 shrink-0 rounded-full bg-current opacity-60" aria-hidden="true" />
      <p className="line-clamp-2 text-[10.5px] leading-4 opacity-80">{text}</p>
    </div>
  )
}

// ------------------------------------------------------------------
// One bubble
// ------------------------------------------------------------------
function Bubble({
  message,
  mine,
  pending,
  busy,
  highlighted,
  onReply,
  onEdit,
  onDelete,
  onPin,
  onForward,
}: {
  message: ChatMessage
  mine: boolean
  pending: boolean
  busy: boolean
  highlighted: boolean
  onReply: () => void
  onEdit: (m: ChatMessage) => void
  onDelete: (m: ChatMessage) => void
  onPin: (m: ChatMessage) => void
  onForward: (m: ChatMessage) => void
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [actions, setActions] = useState(false)

  const isImage = message.kind === 'image'
  const isVoice = message.kind === 'voice'

  useEffect(() => {
    if (message.deleted_at || !message.media_path) return
    if (!isImage && !isVoice) return
    let alive = true

    if (isImage) {
      void resolveChatImage(message.media_path).then((url) => {
        if (!alive) return
        if (url) setImageUrl(url)
        else setFailed(true)
      })
    } else {
      void resolveChatAudio(message.media_path).then((url) => {
        if (!alive) return
        if (url) setAudioUrl(url)
        else setFailed(true)
      })
    }
    return () => {
      alive = false
    }
  }, [isImage, isVoice, message.media_path, message.deleted_at])

  if (message.deleted_at) {
    return (
      <div className={`mb-1.5 flex ${mine ? 'justify-start' : 'justify-end'}`}>
        <div className="rounded-3xl border border-dashed border-blush-200 px-4 py-2">
          <p className="text-[11.5px] italic text-ink-500">پیام حذف شد</p>
        </div>
      </div>
    )
  }

  const aspect =
    message.media_w && message.media_h ? message.media_w / message.media_h : undefined
  const seconds = intervalToSeconds(message.duration)

  return (
    <div className={`mb-1.5 flex ${mine ? 'justify-start' : 'justify-end'}`}>
      <div className={`flex max-w-[84%] flex-col ${mine ? 'items-start' : 'items-end'}`}>
        <div
          className={`relative rounded-3xl px-3.5 py-2 transition-shadow ${
            mine ? 'bg-blush-500 text-white shadow-soft' : 'bg-white text-ink-900 shadow-card'
          } ${highlighted ? 'ring-2 ring-lilac-500 ring-offset-2' : ''}`}
        >
          {message.forward && (
            <p className="mb-1 flex items-center gap-1 text-[9.5px] font-bold opacity-70">
              <span aria-hidden="true">↱</span> هدایت‌شده
            </p>
          )}

          {message.reply_to && <Quote message={message} />}

          {isImage ? (
            failed ? (
              <p className={`text-[12px] ${mine ? 'text-white/90' : 'text-ink-500'}`}>
                عکس بارگذاری نشد.
              </p>
            ) : imageUrl ? (
              <button
                type="button"
                onClick={() => setActions((v) => !v)}
                className="block"
                aria-label="عکس — برای گزینه‌ها بزن"
              >
                <img
                  src={imageUrl}
                  alt="عکس فرستاده‌شده"
                  loading="lazy"
                  width={message.media_w ?? undefined}
                  height={message.media_h ?? undefined}
                  style={aspect ? { aspectRatio: String(aspect) } : undefined}
                  className="max-h-72 w-auto max-w-full rounded-2xl object-cover"
                />
              </button>
            ) : (
              <div className="h-28 w-36 animate-pulse rounded-2xl bg-black/10" />
            )
          ) : isVoice ? (
            <VoiceBubble
              url={audioUrl}
              seconds={seconds}
              mine={mine}
              failed={failed}
              failedLabel="صدا بارگذاری نشد."
            />
          ) : (
            <p className="whitespace-pre-wrap break-words text-[14px] leading-6">{message.body}</p>
          )}

          <div className={`mt-1 flex items-center gap-1.5 ${mine ? 'justify-end' : 'justify-start'}`}>
            {message.pinned && (
              <span className="text-[9px]" aria-label="سنجاق‌شده">
                📌
              </span>
            )}
            {message.edited_at && (
              <span className={`text-[9.5px] ${mine ? 'text-white/70' : 'text-ink-500/70'}`}>
                ویرایش‌شده
              </span>
            )}
            <span className={`text-[9.5px] tabular-nums ${mine ? 'text-white/70' : 'text-ink-500/70'}`}>
              {formatTime(message.created_at)}
            </span>
            {mine && (
              <span
                className="text-[9.5px] text-white/80"
                aria-label={pending ? 'در حال فرستادن' : message.seen ? 'دیده شد' : 'فرستاده شد'}
              >
                {pending ? '◷' : message.seen ? '✓✓' : '✓'}
              </span>
            )}
          </div>
        </div>

        {/* actions: visible on tap for touch, on hover for a mouse */}
        {!pending && (
          <div className="mt-0.5 flex flex-wrap items-center gap-2 px-1">
            <button
              type="button"
              onClick={() => setActions((v) => !v)}
              aria-label="گزینه‌های پیام"
              className="text-[10px] font-bold text-ink-500/60 hover:text-blush-600"
            >
              ⋯
            </button>

            {actions && (
              <>
                <Action onClick={onReply}>پاسخ</Action>
                <Action onClick={() => onForward(message)} disabled={busy}>
                  هدایت
                </Action>
                <Action onClick={() => onPin(message)} disabled={busy}>
                  {message.pinned ? 'برداشتن سنجاق' : 'سنجاق'}
                </Action>
                {mine && message.kind === 'text' && (
                  <Action onClick={() => onEdit(message)} disabled={busy}>
                    ویرایش
                  </Action>
                )}
                {mine && (
                  <Action onClick={() => onDelete(message)} disabled={busy} danger>
                    حذف
                  </Action>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Action({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-[10px] font-bold transition disabled:opacity-40 ${
        danger ? 'text-red-400 hover:text-red-500' : 'text-ink-500 hover:text-blush-600'
      }`}
    >
      {children}
    </button>
  )
}

// ------------------------------------------------------------------
// Voice playback
// ------------------------------------------------------------------
function VoiceBubble({
  url,
  seconds,
  mine,
  failed,
  failedLabel,
}: {
  url: string | null
  seconds: number
  mine: boolean
  failed: boolean
  failedLabel: string
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)

  // A waveform is a lie unless it came from the file, so this is a progress
  // bar that fills as it plays — honest, and it still reads at a glance.
  const bars = 24

  return (
    <div className="flex min-w-[150px] items-center gap-2">
      {failed || !url ? (
        <p className={`text-[12px] ${mine ? 'text-white/90' : 'text-ink-500'}`}>
          {failed ? failedLabel : '…'}
        </p>
      ) : (
        <>
          <audio
            ref={audioRef}
            src={url}
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              setPlaying(false)
              setProgress(0)
            }}
            onTimeUpdate={(event) => {
              const el = event.currentTarget
              if (el.duration && Number.isFinite(el.duration)) {
                setProgress(el.currentTime / el.duration)
              }
            }}
          />

          <button
            type="button"
            onClick={() => {
              const el = audioRef.current
              if (!el) return
              if (el.paused) void el.play()
              else el.pause()
            }}
            aria-label={playing ? 'توقف' : 'پخش'}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
              mine ? 'bg-white/20 text-white' : 'bg-blush-100 text-blush-600'
            }`}
          >
            {playing ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5l11 7-11 7V5z" />
              </svg>
            )}
          </button>

          <div className="flex h-6 flex-1 items-center gap-[2px]" aria-hidden="true">
            {Array.from({ length: bars }).map((_, index) => {
              const filled = index / bars <= progress
              return (
                <span
                  key={index}
                  className={`w-[2px] rounded-full transition-colors ${
                    filled ? (mine ? 'bg-white' : 'bg-blush-500') : mine ? 'bg-white/35' : 'bg-blush-200'
                  }`}
                  style={{ height: `${30 + ((index * 37) % 60)}%` }}
                />
              )
            })}
          </div>

          <span className={`shrink-0 text-[10px] tabular-nums ${mine ? 'text-white/80' : 'text-ink-500'}`}>
            {formatDuration(seconds * 1000)}
          </span>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------
// Sheets
// ------------------------------------------------------------------
function SheetShell({
  title,
  children,
  onClose,
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink-900/40 sm:items-center">
      <div className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-4xl bg-cream shadow-soft sm:rounded-4xl">
        <div className="flex items-center justify-between gap-2 border-b border-blush-100 px-5 py-3">
          <p className="text-[14px] font-extrabold text-ink-900">{title}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-ink-500 shadow-card"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
      </div>
    </div>
  )
}

function SearchSheet({
  onClose,
  onJump,
}: {
  onClose: () => void
  onJump: (m: ChatMessage) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearched(false)
      return
    }
    // Debounced: typing "سلام" should be one request, not four.
    const timer = window.setTimeout(() => {
      setBusy(true)
      void searchMessages(q)
        .then((rows) => {
          setResults(rows)
          setSearched(true)
        })
        .catch(() => setResults([]))
        .finally(() => setBusy(false))
    }, 320)
    return () => window.clearTimeout(timer)
  }, [query])

  return (
    <SheetShell title="جست‌وجو در گفت‌وگو" onClose={onClose}>
      <input
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="چی را پیدا کنم؟"
        className="w-full rounded-2xl border border-blush-100 bg-white px-4 py-2.5 text-[13.5px] outline-none focus:border-blush-300"
      />

      {busy && <p className="mt-3 text-center text-[11.5px] text-ink-500">می‌گردم…</p>}

      {!busy && query.trim().length >= 2 && searched && results.length === 0 && (
        <p className="mt-6 text-center text-[12px] leading-6 text-ink-500">
          چیزی با «{query.trim()}» پیدا نشد.
        </p>
      )}

      <ul className="mt-2 space-y-1.5">
        {results.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => onJump(row)}
              className="w-full rounded-2xl bg-white px-3.5 py-2.5 text-right shadow-card transition hover:shadow-soft"
            >
              <p className="line-clamp-2 text-[12.5px] text-ink-900">
                {row.kind === 'image' ? '📷 عکس' : row.kind === 'voice' ? '🎙 پیام صوتی' : row.body}
              </p>
              <p className="mt-0.5 text-[10px] text-ink-500">{dayLabel(row.created_at)}</p>
            </button>
          </li>
        ))}
      </ul>
    </SheetShell>
  )
}

function PinnedSheet({
  onClose,
  onJump,
}: {
  onClose: () => void
  onJump: (m: ChatMessage) => void
}) {
  const [rows, setRows] = useState<ChatMessage[] | null>(null)

  useEffect(() => {
    void fetchPinned()
      .then(setRows)
      .catch(() => setRows([]))
  }, [])

  return (
    <SheetShell title="سنجاق‌شده‌ها" onClose={onClose}>
      {rows === null ? (
        <div className="flex justify-center py-8">
          <Spinner className="h-5 w-5 text-blush-500" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-[12px] leading-6 text-ink-500">
          هنوز چیزی سنجاق نکرده‌اید. روی «⋯» هر پیام بزن و «سنجاق» را انتخاب کن.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onJump(row)}
                className="w-full rounded-2xl bg-white px-3.5 py-2.5 text-right shadow-card"
              >
                <p className="line-clamp-2 text-[12.5px] text-ink-900">
                  {row.kind === 'image'
                    ? '📷 عکس'
                    : row.kind === 'voice'
                      ? '🎙 پیام صوتی'
                      : row.body}
                </p>
                <p className="mt-0.5 text-[10px] text-ink-500">{dayLabel(row.created_at)}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SheetShell>
  )
}

// ------------------------------------------------------------------
// First-run state
// ------------------------------------------------------------------
function EmptyThread({ partnerName }: { partnerName?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blush-50 text-3xl">
        🤍
      </div>
      <p className="text-[15px] font-extrabold text-ink-900">هنوز چیزی نگفته‌اید</p>
      <p className="mt-2 max-w-xs text-[12.5px] leading-6 text-ink-500">
        اینجا فقط بین تو و {partnerName ?? 'شریکت'} است. یک «سلام» کافی است تا شروع شود.
      </p>
    </div>
  )
}
