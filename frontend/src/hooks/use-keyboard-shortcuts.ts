import { useEffect, useRef } from 'react'

export type GoTarget = '/' | '/applications' | '/documents' | '/metrics' | '/settings'

/** "G then <key>" destinations (PLAN.md §7.1). */
export const GO_KEYS: Record<string, GoTarget> = {
  d: '/',
  a: '/applications',
  o: '/documents',
  m: '/metrics',
  s: '/settings',
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.getAttribute('role') === 'combobox'
  )
}

/**
 * Global shortcuts: ⌘K/Ctrl+K palette (works everywhere), and — outside text fields and
 * dialogs — N new application, / search, and G then D/A/O/M/S to switch pages.
 */
export function useKeyboardShortcuts(handlers: {
  togglePalette: () => void
  quickAdd: () => void
  focusSearch: () => void
  go: (to: GoTarget) => void
}) {
  // Read the latest handlers without re-binding the listener on every render.
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })

  useEffect(() => {
    let gPressedAt = 0
    const onKeyDown = (e: KeyboardEvent) => {
      const h = latest.current
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        h.togglePalette()
        return
      }
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      // Ignore keys under an open dialog, but not one that is only animating closed.
      const dialogOpen = document.querySelector(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
      )
      if (isTyping(e.target) || dialogOpen) return
      const key = e.key.toLowerCase()
      if (gPressedAt && e.timeStamp - gPressedAt < 1500) {
        gPressedAt = 0
        const to = GO_KEYS[key]
        if (to) {
          e.preventDefault()
          h.go(to)
        }
        return
      }
      if (key === 'g') {
        gPressedAt = e.timeStamp
      } else if (key === 'n') {
        e.preventDefault()
        h.quickAdd()
      } else if (e.key === '/') {
        e.preventDefault()
        h.focusSearch()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
