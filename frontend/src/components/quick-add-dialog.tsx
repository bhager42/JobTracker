import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'

import { useCreateApplication } from '@/api/applications'
import { DocumentSelect } from '@/components/document-select'
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
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  applicationFormSchema,
  emptyApplicationForm,
  toCreateBody,
  type ApplicationFormValues,
} from '@/lib/application-form'
import { todayISO } from '@/lib/dates'
import { errorProps } from '@/lib/aria'
import { STATUS_LABELS } from '@/lib/status'

export function QuickAddDialog() {
  const [open, setOpen] = useState(false)
  const [resumeId, setResumeId] = useState<number | null>(null)
  const [coverLetterId, setCoverLetterId] = useState<number | null>(null)
  const navigate = useNavigate()
  const create = useCreateApplication()
  const form = useForm<ApplicationFormValues>({
    resolver: zodResolver(applicationFormSchema),
    defaultValues: emptyApplicationForm(todayISO()),
  })
  const { errors } = form.formState
  const status = useWatch({ control: form.control, name: 'status' })

  const onOpenChange = (next: boolean) => {
    if (next) {
      form.reset(emptyApplicationForm(todayISO()))
      setResumeId(null)
      setCoverLetterId(null)
    }
    setOpen(next)
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const document_ids = [resumeId, coverLetterId].filter((id) => id !== null)
      const app = await create.mutateAsync({ ...toCreateBody(values), document_ids })
      setOpen(false)
      toast.success(`Added ${app.company}`, {
        action: {
          label: 'Open',
          onClick: () => navigate({ to: '/applications/$id', params: { id: String(app.id) } }),
        },
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add the application')
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          New application
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New application</DialogTitle>
          <DialogDescription>
            Just the basics. Everything else can be added from the detail page.
          </DialogDescription>
        </DialogHeader>
        <form id="quick-add" onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Company" htmlFor="qa-company" error={errors.company?.message}>
              <Input
                id="qa-company"
                autoFocus
                autoComplete="off"
                {...errorProps('qa-company', errors.company?.message)}
                {...form.register('company')}
              />
            </FormField>
            <FormField label="Job title" htmlFor="qa-title" error={errors.job_title?.message}>
              <Input
                id="qa-title"
                autoComplete="off"
                {...errorProps('qa-title', errors.job_title?.message)}
                {...form.register('job_title')}
              />
            </FormField>
          </div>
          <FormField label="Job posting URL" htmlFor="qa-url" error={errors.job_url?.message}>
            <Input
              id="qa-url"
              type="url"
              placeholder="https://"
              {...errorProps('qa-url', errors.job_url?.message)}
              {...form.register('job_url')}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Status" htmlFor="qa-status">
              <Controller
                control={form.control}
                name="status"
                render={({ field }) => (
                  <EnumSelect
                    id="qa-status"
                    labels={STATUS_LABELS}
                    allowEmpty={false}
                    value={field.value}
                    onChange={(v) => v && field.onChange(v)}
                  />
                )}
              />
            </FormField>
            <FormField
              label="Date applied"
              htmlFor="qa-date"
              error={errors.date_applied?.message}
              hint={status === 'saved' ? 'Optional for saved jobs' : undefined}
            >
              <Input
                id="qa-date"
                type="date"
                {...errorProps('qa-date', errors.date_applied?.message)}
                {...form.register('date_applied')}
              />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Resume" htmlFor="qa-resume">
              <DocumentSelect
                id="qa-resume"
                kind="resume"
                value={resumeId}
                onChange={setResumeId}
              />
            </FormField>
            <FormField label="Cover letter" htmlFor="qa-cover">
              <DocumentSelect
                id="qa-cover"
                kind="cover_letter"
                value={coverLetterId}
                onChange={setCoverLetterId}
              />
            </FormField>
          </div>
        </form>
        <DialogFooter>
          <Button type="submit" form="quick-add" disabled={create.isPending}>
            {create.isPending ? 'Adding…' : 'Add application'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
