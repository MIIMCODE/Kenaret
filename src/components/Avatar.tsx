import { useEffect, useState } from 'react'
import { resolveAvatarSrc } from '../lib/avatars'

interface Props {
  src: string | null | undefined
  name?: string | null
  size?: number
  className?: string
  ring?: boolean
}

const GRADIENTS = [
  'from-blush-200 to-blush-400',
  'from-lilac-300 to-lilac-500',
  'from-mint-100 to-mint-500',
  'from-amber-200 to-orange-300',
  'from-sky-200 to-sky-400',
]

function gradientFor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 997
  return GRADIENTS[hash % GRADIENTS.length]
}

export default function Avatar({ src, name, size = 56, className = '', ring = false }: Props) {
  const [resolved, setResolved] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setFailed(false)
    setResolved(null)
    if (!src) return
    resolveAvatarSrc(src)
      .then((url) => {
        if (active) setResolved(url)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [src])

  const initial = (name?.trim()?.[0] ?? '؟').toUpperCase()
  const showImage = resolved && !failed

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full bg-gradient-to-br ${
        showImage ? 'bg-blush-100' : gradientFor(name ?? initial)
      } ${ring ? 'ring-4 ring-white shadow-soft' : ''} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden={!name}
    >
      {showImage ? (
        <img
          src={resolved}
          alt={name ? `عکس ${name}` : ''}
          width={size}
          height={size}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center font-extrabold text-white drop-shadow-sm"
          style={{ fontSize: Math.max(12, size * 0.38) }}
        >
          {initial}
        </span>
      )}
    </div>
  )
}
