import { motion } from 'motion/react'
import { useId } from 'react'

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  small
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  small?: boolean
}) {
  const id = useId()
  return (
    <div className={`seg${small ? ' small' : ''}`} role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.value === value && (
            <motion.span layoutId={`pill-${id}`} className="seg-pill" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
          )}
          {o.label}
        </button>
      ))}
    </div>
  )
}
