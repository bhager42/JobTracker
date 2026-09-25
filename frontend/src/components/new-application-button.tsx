import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useAppCommands } from '@/hooks/use-app-commands'

export function NewApplicationButton() {
  const { openQuickAdd } = useAppCommands()
  return (
    <Button onClick={openQuickAdd}>
      <Plus data-icon="inline-start" />
      New application
    </Button>
  )
}
