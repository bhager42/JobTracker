function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      notation: value >= 10_000 ? 'compact' : 'standard',
      maximumFractionDigits: value >= 10_000 ? 1 : 0,
    }).format(value)
  } catch {
    // Unknown currency code: fall back to a plain number.
    return `${value.toLocaleString()} ${currency}`
  }
}

/** "$120K–$150K", "$120K+", "Up to $150K", or "" when neither bound is set. */
export function formatSalary(
  min: number | null,
  max: number | null,
  currency: string | null,
): string {
  const code = currency ?? 'USD'
  if (min !== null && max !== null) {
    return min === max ? money(min, code) : `${money(min, code)}–${money(max, code)}`
  }
  if (min !== null) return `${money(min, code)}+`
  if (max !== null) return `Up to ${money(max, code)}`
  return ''
}

/** A 0–1 rate as a whole percentage, or "—" when there's nothing to divide by. */
export const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`
