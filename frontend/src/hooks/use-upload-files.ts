import { toast } from 'sonner'

import { useUploadDocument, type DocumentUploaded } from '@/api/documents'
import { ACCEPTED_LABEL, hasAcceptedExtension } from '@/lib/documents'
import type { DocumentKind } from '@/lib/enums'

/**
 * Uploads files one at a time with a toast for each outcome. Resolves to the documents that
 * are now in the library (new or already there), skipping files that failed.
 */
export function useUploadFiles() {
  const upload = useUploadDocument()

  const uploadFiles = async (files: File[], kind: DocumentKind): Promise<DocumentUploaded[]> => {
    const done: DocumentUploaded[] = []
    for (const file of files) {
      if (!hasAcceptedExtension(file.name)) {
        toast.error(`${file.name}: only ${ACCEPTED_LABEL} files can be uploaded`)
        continue
      }
      try {
        const doc = await upload.mutateAsync({ file, kind })
        done.push(doc)
        if (doc.duplicate) {
          toast.info(`${file.name} is already in your library as “${doc.display_name}”`)
        } else {
          toast.success(`Uploaded ${doc.display_name}`)
        }
      } catch (err) {
        toast.error(`${file.name}: ${err instanceof Error ? err.message : 'upload failed'}`)
      }
    }
    return done
  }

  return { uploadFiles, isUploading: upload.isPending }
}
