import { Upload } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'

import { useDocuments } from '@/api/documents'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useUploadFiles } from '@/hooks/use-upload-files'
import { ACCEPT_ATTRIBUTE } from '@/lib/documents'
import type { DocumentKind } from '@/lib/enums'
import { cn } from '@/lib/utils'

const NONE = '__none__'
const UPLOAD = '__upload__'

/**
 * Picks one library document of a kind, or uploads a new one and picks it: from the menu, by
 * dropping a file on the picker or the strip under it, or by clicking that strip.
 */
export function DocumentSelect({
  id,
  kind,
  value,
  onChange,
}: {
  id: string
  kind: DocumentKind
  value: number | null
  onChange: (id: number | null) => void
}) {
  const { data: all = [] } = useDocuments()
  // Keep the chosen document listed even if it is filed under another kind (e.g. an upload
  // that matched an existing library file).
  const options = all.filter((doc) => doc.kind === kind || doc.id === value)
  const { uploadFiles, isUploading } = useUploadFiles()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const noun = kind === 'cover_letter' ? 'cover letter' : kind

  const upload = async (file: File) => {
    const [doc] = await uploadFiles([file], kind)
    if (doc) onChange(doc.id)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const file = e.dataTransfer.files[0]
    if (file && !isUploading) void upload(file)
  }

  return (
    <div
      className="grid min-w-0 gap-1.5"
      onDragOver={(e) => {
        e.preventDefault()
        if (!isUploading) setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={onDrop}
    >
      <Select
        value={value === null ? NONE : String(value)}
        onValueChange={(v) => {
          // Radix reports "" when the selected item is added to the list in the same render
          // (a just-uploaded document); Number("") would select a nonexistent document 0.
          if (v === '') return
          if (v === UPLOAD) input.current?.click()
          else onChange(v === NONE ? null : Number(v))
        }}
        disabled={isUploading}
      >
        <SelectTrigger
          id={id}
          className={cn(
            'w-full min-w-0 *:data-[slot=select-value]:block *:data-[slot=select-value]:truncate',
            over && 'border-primary bg-muted',
          )}
        >
          <SelectValue placeholder="None">
            {isUploading ? 'Uploading…' : over ? 'Drop to upload' : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE} className="text-muted-foreground">
            None
          </SelectItem>
          {options.map((doc) => (
            <SelectItem key={doc.id} value={String(doc.id)}>
              {doc.display_name}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={UPLOAD}>Upload new…</SelectItem>
        </SelectContent>
      </Select>
      <button
        type="button"
        disabled={isUploading}
        aria-label={`Upload a ${noun}: drop a file here or press to browse`}
        onClick={() => input.current?.click()}
        className={cn(
          'flex items-center justify-center gap-1.5 rounded-lg border border-dashed px-2 py-1.5 text-xs text-muted-foreground transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60',
          over && 'border-primary bg-muted text-foreground',
        )}
      >
        <Upload className="size-3.5" aria-hidden />
        {over ? 'Drop to upload' : 'Drop a file here, or click to browse'}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept={ACCEPT_ATTRIBUTE}
        aria-label={`Upload a ${noun}`}
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) await upload(file)
        }}
      />
    </div>
  )
}
