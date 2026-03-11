import { PDFDocument, PDFDict, PDFArray, PDFName, PDFString, PDFRef, degrees } from 'pdf-lib'
import type { PDFPage } from 'pdf-lib'
import type { PageBox, StitchSettings } from '../types'
import { decryptPdf } from './decryptPdf'

function getBox(page: PDFPage, box: PageBox) {
  const r = (() => {
    switch (box) {
      case 'media': return page.getMediaBox()
      case 'crop':  return page.getCropBox()
      case 'bleed': return page.getBleedBox()
      case 'art':   return page.getArtBox()
      default:      return page.getTrimBox()
    }
  })()
  // Swap width/height when page is rotated 90° or 270° so tile dims match visual orientation
  const angle = page.getRotation().angle
  if (angle === 90 || angle === 270) {
    return { x: r.y, y: r.x, width: r.height, height: r.width }
  }
  return r
}

const MM_TO_PT = 72 / 25.4

/**
 * Build the ordered tile sequence, inserting null (blank) at the specified
 * 1-based slot positions. Source pages fill all remaining slots in order.
 */
function buildTileSequence(
  pageIndices: number[],
  blankSlots: number[],
): (number | null)[] {
  const blankSet = new Set(blankSlots)
  const tiles: (number | null)[] = []
  let pageIdx = 0
  const totalSlots = pageIndices.length + blankSet.size

  for (let pos = 1; pos <= totalSlots; pos++) {
    if (blankSet.has(pos)) {
      tiles.push(null)
    } else if (pageIdx < pageIndices.length) {
      tiles.push(pageIndices[pageIdx++])
    }
  }

  // Append any remaining pages if blankSlots contained out-of-range values
  while (pageIdx < pageIndices.length) {
    tiles.push(pageIndices[pageIdx++])
  }

  return tiles
}

function applyDisabledLayers(doc: PDFDocument, disabledNames: string[]): void {
  const disabled = new Set(disabledNames)
  const allRefs: PDFRef[] = []
  const offRefs: PDFRef[] = []

  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue
    if (obj.get(PDFName.of('Type'))?.toString() !== '/OCG') continue
    const nameObj = obj.get(PDFName.of('Name'))
    if (!(nameObj instanceof PDFString)) continue
    allRefs.push(ref)
    if (disabled.has(nameObj.decodeText())) offRefs.push(ref)
  }

  if (!allRefs.length) return

  const ocgsArr = PDFArray.withContext(doc.context)
  allRefs.forEach(r => ocgsArr.push(r))

  const offArr = PDFArray.withContext(doc.context)
  offRefs.forEach(r => offArr.push(r))

  const dDict = PDFDict.withContext(doc.context)
  dDict.set(PDFName.of('BaseState'), PDFName.of('ON'))
  dDict.set(PDFName.of('OFF'), offArr)

  const ocProps = PDFDict.withContext(doc.context)
  ocProps.set(PDFName.of('OCGs'), ocgsArr)
  ocProps.set(PDFName.of('D'), dDict)

  doc.catalog.set(PDFName.of('OCProperties'), ocProps)
}

export async function logPageBoxes(fileBytes: ArrayBuffer): Promise<void> {
  let bytes: ArrayBuffer | Uint8Array = fileBytes
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  } catch {
    console.warn('logPageBoxes: could not load PDF')
    return
  }
  let pages: PDFPage[]
  try {
    pages = doc.getPages()
  } catch {
    try {
      bytes = await decryptPdf(bytes)
      doc = await PDFDocument.load(bytes)
      pages = doc.getPages()
    } catch {
      console.warn('logPageBoxes: could not read page tree (encrypted/malformed PDF)')
      return
    }
  }
  console.group(`PDF boxes — ${pages.length} page(s)`)
  pages.forEach((page, i) => {
    const m = page.getMediaBox()
    const c = page.getCropBox()
    const b = page.getBleedBox()
    const t = page.getTrimBox()
    const a = page.getArtBox()
    const fmt = (r: { x: number; y: number; width: number; height: number }) =>
      `${r.width.toFixed(2)} × ${r.height.toFixed(2)}  (x:${r.x.toFixed(2)} y:${r.y.toFixed(2)})`
    const rot = page.getRotation().angle
    console.group(`Page ${i + 1}${rot ? `  [rotate: ${rot}°]` : ''}`)
    console.log(`  Media: ${fmt(m)}`)
    console.log(`   Crop: ${fmt(c)}`)
    console.log(`  Bleed: ${fmt(b)}`)
    console.log(`   Trim: ${fmt(t)}`)
    console.log(`    Art: ${fmt(a)}`)
    console.groupEnd()
  })
  console.groupEnd()
}

export interface StitchResult {
  bytes: Uint8Array
  widthPt: number
  heightPt: number
}

export async function stitchPdf(
  fileBytes: ArrayBuffer,
  settings: StitchSettings,
): Promise<StitchResult> {
  let bytes: ArrayBuffer | Uint8Array = fileBytes
  let srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  let allPages: PDFPage[]
  try {
    allPages = srcDoc.getPages()
  } catch {
    // pdf-lib can't parse the page tree — try decrypting via mupdf first
    bytes = await decryptPdf(bytes)
    srcDoc = await PDFDocument.load(bytes)
    allPages = srcDoc.getPages()
  }
  const total = allPages.length

  const [rangeStart, rangeEnd] = settings.pageRange ?? [1, total]
  const startIdx = Math.max(0, rangeStart - 1)
  const endIdx = Math.min(total - 1, rangeEnd - 1)

  const rangeIndices = Array.from(
    { length: endIdx - startIdx + 1 },
    (_, i) => startIdx + i,
  )

  const tiles = buildTileSequence(rangeIndices, settings.blankSlots)

  const overlapX = settings.overlapX * MM_TO_PT
  const overlapY = settings.overlapY * MM_TO_PT
  const { columns } = settings
  const rows = Math.ceil(tiles.length / columns)

  const refBox = getBox(allPages[startIdx], settings.pageBox)
  const tileW = refBox.width
  const tileH = refBox.height

  const strideX = tileW - overlapX
  const strideY = tileH - overlapY
  const pageW = columns * strideX + overlapX
  const pageH = rows * strideY + overlapY

  // Embed all needed source pages up front (deduplicated)
  const neededIndices = [...new Set(tiles.filter((t): t is number => t !== null))]
  const newDoc = await PDFDocument.create()
  const embeddedPages = await newDoc.embedPdf(srcDoc, neededIndices)
  const embeddedMap = new Map(neededIndices.map((idx, i) => [idx, embeddedPages[i]]))

  const page = newDoc.addPage([pageW, pageH])

  for (let i = 0; i < tiles.length; i++) {
    const tileIdx = tiles[i]
    if (tileIdx === null) continue

    const embedded = embeddedMap.get(tileIdx)
    if (!embedded) continue

    const col = i % columns
    const row = Math.floor(i / columns)
    let x = col * strideX - refBox.x
    let y = (rows - 1 - row) * strideY - refBox.y

    // PDF /Rotate is clockwise. embedPdf bakes the content stream but not the
    // rotation, so we must apply it manually and shift the draw origin so the
    // rotated content still lands in the correct tile slot.
    const tileAngle = allPages[tileIdx].getRotation().angle
    if (tileAngle === 90)       { y += tileH }
    else if (tileAngle === 180) { x += tileW; y += tileH }
    else if (tileAngle === 270) { x += tileW }

    page.drawPage(embedded, {
      x, y,
      ...(tileAngle ? { rotate: degrees(-tileAngle) } : {}),
    })
  }

  if (settings.disabledLayers.length) {
    applyDisabledLayers(newDoc, settings.disabledLayers)
  }

  return { bytes: await newDoc.save(), widthPt: pageW, heightPt: pageH }
}
