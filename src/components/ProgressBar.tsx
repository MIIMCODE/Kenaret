interface Props {
  step: number
  total: number
  labels?: string[]
}

export default function ProgressBar({ step, total, labels }: Props) {
  const percent = Math.min(100, Math.max(0, (step / total) * 100))

  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between text-[12px] font-semibold">
        <span className="text-blush-600">
          قدم {toFa(step)} از {toFa(total)}
        </span>
        {labels?.[step - 1] && <span className="text-ink-500">{labels[step - 1]}</span>}
      </div>

      <div
        className="h-2 w-full overflow-hidden rounded-full bg-blush-100"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-valuetext={`قدم ${toFa(step)} از ${toFa(total)}`}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{
            width: `${percent}%`,
            backgroundImage: 'linear-gradient(90deg, #ffaec3, #f9628b 70%, #e84874)',
          }}
        />
      </div>

      {labels && (
        <div className="mt-2 flex justify-center gap-1.5">
          {Array.from({ length: total }, (_, index) => (
            <span
              key={index}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                index + 1 <= step ? 'w-6 bg-blush-400' : 'w-1.5 bg-blush-200'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function toFa(value: number): string {
  return String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])
}

export { toFa }
