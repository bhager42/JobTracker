import { useState } from 'react'

import type { StatusChange } from '@/api/applications'
import { EnumSelect } from '@/components/enum-select'
import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { STATUS_LABELS, asksForRounds, type Status } from '@/lib/status'

/**
 * Picks a new status with an optional note, and the interview round count when the status
 * uses it. Shared by the detail page and bulk actions.
 */
export function StatusChangeDialog({
  open,
  onOpenChange,
  initialStatus,
  initialRounds = 0,
  title = 'Change status',
  description,
  pending,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialStatus: Status
  initialRounds?: number
  title?: string
  description?: string
  pending?: boolean
  onSubmit: (change: StatusChange) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {/* Remount per opening so the fields start from the current values. */}
        {open && (
          <StatusChangeForm
            initialStatus={initialStatus}
            initialRounds={initialRounds}
            pending={pending}
            onSubmit={onSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function StatusChangeForm({
  initialStatus,
  initialRounds,
  pending,
  onSubmit,
}: {
  initialStatus: Status
  initialRounds: number
  pending?: boolean
  onSubmit: (change: StatusChange) => void
}) {
  const [status, setStatus] = useState<Status>(initialStatus)
  const [rounds, setRounds] = useState(String(Math.max(initialRounds, 0)))
  const [note, setNote] = useState('')
  const roundsValid = /^\d{1,2}$/.test(rounds) && Number(rounds) <= 50
  const showRounds = asksForRounds(status)

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (showRounds && !roundsValid) return
        onSubmit({
          status,
          note: note.trim() || null,
          interview_rounds: showRounds ? Number(rounds) : null,
        })
      }}
    >
      <FormField label="Status" htmlFor="sc-status">
        <EnumSelect
          id="sc-status"
          labels={STATUS_LABELS}
          allowEmpty={false}
          value={status}
          onChange={(v) => v && setStatus(v)}
        />
      </FormField>
      {showRounds && (
        <FormField
          label="Interview rounds reached"
          htmlFor="sc-rounds"
          error={roundsValid ? undefined : 'Enter a number from 0 to 50'}
        >
          <Input
            id="sc-rounds"
            type="number"
            inputMode="numeric"
            min={0}
            max={50}
            value={rounds}
            onChange={(e) => setRounds(e.target.value)}
          />
        </FormField>
      )}
      <FormField label="Note" htmlFor="sc-note" hint="Optional. Shown in the timeline.">
        <Textarea
          id="sc-note"
          rows={2}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </FormField>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </form>
  )
}
