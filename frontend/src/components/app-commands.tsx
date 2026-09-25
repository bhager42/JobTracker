import { useNavigate } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'

import { CommandPalette } from '@/components/command-palette'
import { QuickAddDialog } from '@/components/quick-add-dialog'
import { AppCommandsContext } from '@/hooks/use-app-commands'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'

/** Hosts quick add and the command palette once for the whole app, plus global shortcuts. */
export function AppCommandsProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [quickAddOpen, setQuickAddOpen] = useState(false)

  useKeyboardShortcuts({
    togglePalette: () => setPaletteOpen((open) => !open),
    quickAdd: () => setQuickAddOpen(true),
    focusSearch: () => {
      // Pages with their own search box mark it; elsewhere "/" opens the palette.
      const box = document.querySelector<HTMLInputElement>('[data-page-search]')
      if (box) box.focus()
      else setPaletteOpen(true)
    },
    go: (to) => void navigate({ to }),
  })

  return (
    <AppCommandsContext
      value={{
        openQuickAdd: () => setQuickAddOpen(true),
        openPalette: () => setPaletteOpen(true),
      }}
    >
      {children}
      <QuickAddDialog open={quickAddOpen} onOpenChange={setQuickAddOpen} />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNewApplication={() => setQuickAddOpen(true)}
      />
    </AppCommandsContext>
  )
}
