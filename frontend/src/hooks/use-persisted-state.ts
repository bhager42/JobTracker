import { useState } from 'react'

/**
 * State remembered in this browser (localStorage). Storage can be unavailable (private
 * windows, blocked site data), so reads and writes fall back to plain state.
 */
export function usePersistedState<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      const parsed: unknown = raw === null ? null : JSON.parse(raw)
      return isValid(parsed) ? parsed : fallback
    } catch {
      return fallback
    }
  })
  const set = (next: T) => {
    setValue(next)
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      // ignore; the choice still applies for this session
    }
  }
  return [value, set]
}
