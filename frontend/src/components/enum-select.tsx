import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Radix Select reserves the empty string, so "not set" gets its own value.
const NONE = '__none__'

/** A select over an enum's labels. `''` means "not set" when `allowEmpty` is on. */
export function EnumSelect<K extends string>({
  id,
  labels,
  value,
  onChange,
  allowEmpty = true,
  placeholder = 'Not set',
  className,
  ...aria
}: {
  id?: string
  labels: Record<K, string>
  value: K | ''
  onChange: (value: K | '') => void
  allowEmpty?: boolean
  placeholder?: string
  className?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
}) {
  return (
    <Select
      value={value === '' ? NONE : value}
      onValueChange={(v) => onChange(v === NONE ? '' : (v as K))}
    >
      <SelectTrigger id={id} className={className ?? 'w-full'} {...aria}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowEmpty && (
          <SelectItem value={NONE} className="text-muted-foreground">
            {placeholder}
          </SelectItem>
        )}
        {(Object.entries(labels) as [K, string][]).map(([key, label]) => (
          <SelectItem key={key} value={key}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
