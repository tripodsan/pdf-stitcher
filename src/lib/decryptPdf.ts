/**
 * Lazily loads mupdf WASM and returns decrypted PDF bytes.
 * Only called when pdf-lib fails to parse an encrypted document.
 */
export async function decryptPdf(fileBytes: ArrayBuffer): Promise<Uint8Array> {
  const mupdf = await import('mupdf')
  const doc = mupdf.Document.openDocument(fileBytes, 'application/pdf') as InstanceType<typeof mupdf.PDFDocument>

  if (doc.needsPassword()) {
    // Try empty user password (covers owner-only restricted PDFs)
    const ok = doc.authenticatePassword('')
    if (!ok) {
      doc.destroy()
      throw new Error(
        'The PDF is password-protected. Please provide an unlocked copy.',
      )
    }
  }

  const bytes = doc.saveToBuffer('decrypt').asUint8Array()
  doc.destroy()
  return bytes
}
