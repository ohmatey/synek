import type { FileUIPart } from 'ai'

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// Files travel to the model as self-contained data-URL file parts.
export async function filesToParts(files: File[]): Promise<FileUIPart[]> {
  return Promise.all(
    files.map(async (f) => ({
      type: 'file' as const,
      mediaType: f.type || 'application/octet-stream',
      filename: f.name,
      url: await fileToDataUrl(f),
    })),
  )
}
