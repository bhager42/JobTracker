import { ChevronDown } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'

/** A toolbar button that opens a checklist; an empty selection means "any". */
export function MultiSelectFilter<K extends string>({
  title,
  labels,
  selected,
  onChange,
}: {
  title: string
  labels: Record<K, string>
  selected: readonly K[]
  onChange: (next: K[]) => void
}) {
  const options = Object.entries(labels) as [K, string][]
  const toggle = (key: K, on: boolean) =>
    onChange(
      on
        ? options.map(([k]) => k).filter((k) => k === key || selected.includes(k))
        : selected.filter((k) => k !== key),
    )

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="border-dashed">
          {title}
          {selected.length > 0 && (
            <Badge variant="secondary" className="rounded-md px-1.5 font-mono tabular-nums">
              {selected.length}
            </Badge>
          )}
          <ChevronDown data-icon="inline-end" className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <fieldset className="grid gap-0.5">
          <legend className="sr-only">{title}</legend>
          {options.map(([key, label]) => {
            const id = `filter-${title}-${key}`.replace(/\s+/g, '-').toLowerCase()
            return (
              <div
                key={key}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
              >
                <Checkbox
                  id={id}
                  checked={selected.includes(key)}
                  onCheckedChange={(v) => toggle(key, v === true)}
                />
                <Label htmlFor={id} className="flex-1 cursor-pointer font-normal">
                  {label}
                </Label>
              </div>
            )
          })}
        </fieldset>
        {selected.length > 0 && (
          <>
            <Separator className="my-2" />
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-center"
              onClick={() => onChange([])}
            >
              Clear
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
