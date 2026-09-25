import { Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useAppCommands } from '@/hooks/use-app-commands'

/** The top bar's global search: opens the command palette. */
export function SearchButton() {
  const { openPalette } = useAppCommands()
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return (
    <Button
      variant="outline"
      onClick={openPalette}
      className="w-full max-w-sm justify-start text-muted-foreground sm:w-64"
    >
      <Search data-icon="inline-start" />
      <span className="flex-1 text-left">Search…</span>
      <kbd className="pointer-events-none hidden rounded border bg-background px-1.5 font-mono text-[10px] font-medium text-foreground/80 sm:inline">
        {mac ? '⌘' : 'Ctrl'} K
      </kbd>
    </Button>
  )
}
