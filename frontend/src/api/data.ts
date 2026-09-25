import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, unwrap, type Schemas } from '@/api/client'

export type DataStats = Schemas['DataStats']
export type CsvPreview = Schemas['CsvPreview']
export type CsvImportResult = Schemas['CsvImportResult']
export type ImportResult = Schemas['ImportResultOut']

export const EXPORT_URL = '/api/export'

export function useStats() {
  return useQuery({
    // Under "applications" so it refreshes after any change.
    queryKey: ['applications', 'stats'],
    queryFn: () => unwrap(api.GET('/api/stats')),
  })
}

/** Everything changes after an import: refetch it all. */
function useRefreshAll() {
  const client = useQueryClient()
  return () => client.invalidateQueries()
}

const fileForm =
  (file: File, extra: Record<string, string> = {}) =>
  () => {
    const form = new FormData()
    form.append('file', file)
    for (const [k, v] of Object.entries(extra)) form.append(k, v)
    return form
  }

export function useImportBackup() {
  const refresh = useRefreshAll()
  return useMutation({
    mutationFn: (file: File) =>
      unwrap(
        api.POST('/api/import', {
          // The generated type says `file: string` (OpenAPI "binary"); the serializer sends
          // the real File as multipart/form-data.
          body: { file: file as unknown as string },
          bodySerializer: fileForm(file),
        }),
      ),
    onSuccess: refresh,
  })
}

export function useCsvPreview() {
  return useMutation({
    mutationFn: (file: File) =>
      unwrap(
        api.POST('/api/import/csv/preview', {
          body: { file: file as unknown as string },
          bodySerializer: fileForm(file),
        }),
      ),
  })
}

export function useCsvImport() {
  const refresh = useRefreshAll()
  return useMutation({
    mutationFn: ({
      file,
      mapping,
      dryRun,
    }: {
      file: File
      mapping: Record<string, string>
      dryRun: boolean
    }) =>
      unwrap(
        api.POST('/api/import/csv', {
          body: {
            file: file as unknown as string,
            mapping: JSON.stringify(mapping),
            dry_run: dryRun,
          },
          bodySerializer: fileForm(file, {
            mapping: JSON.stringify(mapping),
            dry_run: String(dryRun),
          }),
        }),
      ),
    onSuccess: (result, vars) => (vars.dryRun || result.created === 0 ? undefined : refresh()),
  })
}
