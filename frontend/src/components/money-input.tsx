import { useLayoutEffect, useRef, type ComponentProps } from 'react'

import { Input } from '@/components/ui/input'
import { currencySymbol, groupDigits } from '@/lib/format'
import { cn } from '@/lib/utils'

const decimalSeparator =
  new Intl.NumberFormat().formatToParts(1.1).find((p) => p.type === 'decimal')?.value ?? '.'

/**
 * A whole-number money field: shows the currency symbol and thousands separators
 * ("$ 120,000") while the value stays a plain digit string ("120000").
 */
export function MoneyInput({
  value,
  onChange,
  currency,
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'value' | 'onChange'> & {
  value: string
  onChange: (digits: string) => void
  currency: string
}) {
  const wrapper = useRef<HTMLDivElement>(null)
  // How many digits sit before the caret, so it stays put when separators are added or removed.
  const digitsBeforeCaret = useRef<number | null>(null)
  const symbol = currencySymbol(currency || 'USD')

  useLayoutEffect(() => {
    const el = wrapper.current?.querySelector('input')
    const target = digitsBeforeCaret.current
    if (!el || target === null || document.activeElement !== el) return
    digitsBeforeCaret.current = null
    let pos = 0
    for (let seen = 0; pos < el.value.length && seen < target; pos++) {
      if (/\d/.test(el.value[pos]!)) seen++
    }
    el.setSelectionRange(pos, pos)
  })

  return (
    <div ref={wrapper} className="relative">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-muted-foreground"
      >
        {symbol}
      </span>
      <Input
        {...props}
        inputMode="numeric"
        className={cn('tabular-nums', className)}
        style={{ paddingLeft: `calc(0.625rem + ${symbol.length}ch + 0.25rem)` }}
        value={groupDigits(value)}
        onChange={(e) => {
          // Drop any cents ("120000.50" → "120000"), then everything that isn't a digit.
          const raw = e.target.value.split(decimalSeparator)[0]!
          const caret = Math.min(e.target.selectionStart ?? raw.length, raw.length)
          digitsBeforeCaret.current = raw.slice(0, caret).replace(/\D/g, '').length
          onChange(raw.replace(/\D/g, ''))
        }}
      />
    </div>
  )
}
