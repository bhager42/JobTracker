import { Upload } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'

import { ACCEPTED_LABEL, ACCEPT_ATTRIBUTE } from '@/lib/documents'
import { cn } from '@/lib/utils'

/** Drag-and-drop target that also opens the file picker on click or Enter/Space. */
export function DocumentDropzone({
  onFiles,
  multiple = true,
  disabled,
  compact,
  className,
}: {
  onFiles: (files: File[]) => void
  multiple?: boolean
  disabled?: boolean
  compact?: boolean
  className?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    if (disabled) return
    const files = Array.from(e.dataTransfer.files)
    if (files.length) onFiles(multiple ? files : files.slice(0, 1))
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={`Upload ${multiple ? 'files' : 'a file'}: drop here or press to browse`}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          input.current?.click()
        }
      }}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-center transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50',
        compact ? 'px-4 py-5' : 'px-6 py-10',
        over && 'border-primary bg-muted',
        disabled && 'pointer-events-none opacity-60',
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
        <Upload className="size-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">
        {over ? 'Drop to upload' : 'Drop files here, or click to browse'}
      </p>
      <p className="text-xs text-muted-foreground">{ACCEPTED_LABEL}</p>
      <input
        ref={input}
        type="file"
        hidden
        multiple={multiple}
        accept={ACCEPT_ATTRIBUTE}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = '' // allow picking the same file again
          if (files.length) onFiles(files)
        }}
      />
    </div>
  )
}
