import { createContext, useContext } from 'react'

export interface AppCommands {
  openQuickAdd: () => void
  openPalette: () => void
}

export const AppCommandsContext = createContext<AppCommands | null>(null)

/** App-wide actions: quick add and the command palette, reachable from any page. */
export function useAppCommands(): AppCommands {
  const ctx = useContext(AppCommandsContext)
  if (!ctx) throw new Error('useAppCommands must be used inside AppCommandsProvider')
  return ctx
}
