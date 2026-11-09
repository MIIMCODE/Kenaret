import { useState } from 'react'
import { INTEREST_OPTIONS, MAX_CUSTOM_INTEREST_LENGTH, MAX_INTERESTS } from '../../lib/constants'

interface Props {
  selected: string[]
  onChange: (next: string[]) => void
}

export default function InterestsStep({ selected, onChange }: Props) {
  const [custom, setCustom] = useState('')
  const atLimit = selected.length >= MAX_INTERESTS

  function toggle(tag: string) {
    if (selected.includes(tag)) {
      onChange(selected.filter((item) => item !== tag))
      return
    }
    if (atLimit) return
    onChange([...selected, tag])
  }

  function addCustom() {
    const value = custom.trim()
    if (!value) return
    if (value.length > MAX_CUSTOM_INTEREST_LENGTH) return
    if (selected.includes(value)) {
      setCustom('')
      return
    }
    if (atLimit) return
    onChange([...selected, value])
    setCustom('')
  }

  // Custom tags the user added are not part of the preset list — show them too.
  const customTags = selected.filter(
    (tag) => !(INTEREST_OPTIONS as readonly string[]).includes(tag),
  )

  return (
    <div className="space-y-4">
      <p className="hint">
        تا {toFa(MAX_INTERESTS)} علاقه‌مندی انتخاب کن؛ این‌ها را شریکت می‌بیند و می‌تواند بهانه‌ی
        یک گفت‌وگوی تازه باشد.
      </p>

      <div className="flex flex-wrap gap-2">
        {INTEREST_OPTIONS.map((tag) => {
          const active = selected.includes(tag)
          return (
            <button
              key={tag}
              type="button"
              onClick={() => toggle(tag)}
              aria-pressed={active}
              disabled={!active && atLimit}
              className={`chip ${active ? 'chip-active' : ''} ${
                !active && atLimit ? 'cursor-not-allowed opacity-40' : ''
              }`}
            >
              {tag}
            </button>
          )
        })}

        {customTags.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => toggle(tag)}
            aria-pressed
            className="chip chip-active"
          >
            {tag} <span className="mr-1 text-[11px] opacity-80">×</span>
          </button>
        ))}
      </div>

      <div>
        <label className="label" htmlFor="custom-interest">
          علاقه‌مندی خودت را اضافه کن
        </label>
        <div className="flex gap-2">
          <input
            id="custom-interest"
            className="field"
            placeholder="مثلاً: کوهنوردی"
            value={custom}
            maxLength={MAX_CUSTOM_INTEREST_LENGTH}
            disabled={atLimit}
            onChange={(event) => setCustom(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addCustom()
              }
            }}
          />
          <button
            type="button"
            onClick={addCustom}
            disabled={atLimit || !custom.trim()}
            className="btn-soft shrink-0 !px-4"
            aria-label="افزودن علاقه‌مندی"
          >
            افزودن
          </button>
        </div>
        <p className="hint mt-1.5">
          {selected.length > 0
            ? `${toFa(selected.length)} از ${toFa(MAX_INTERESTS)} انتخاب شده`
            : 'می‌توانی این بخش را هم خالی رد کنی.'}
        </p>
      </div>
    </div>
  )
}

function toFa(value: number): string {
  return String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])
}
