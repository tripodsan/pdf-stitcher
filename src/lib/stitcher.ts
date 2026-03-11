import { PDFDocument } from 'pdf-lib'
import type { PDFPage } from 'pdf-lib'
import type { PageBox, StitchSettings } from '../types'

function getBox(page: PDFPage, box: PageBox) {
  switch (box) {
    case 'media': return page.getMediaBox()
    case 'crop':  return page.getCropBox()
    case 'bleed': return page.getBleedBox()
    case 'art':   return page.getArtBox()
    default:      return page.getTrimBox()
  }
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

export async function logPageBoxes(fileBytes: ArrayBuffer): Promise<void> {
  const doc = await PDFDocument.load(fileBytes)
  const pages = doc.getPages()
  console.group(`PDF boxes — ${pages.length} page(s)`)
  pages.forEach((page, i) => {
    const m = page.getMediaBox()
    const c = page.getCropBox()
    const b = page.getBleedBox()
    const t = page.getTrimBox()
    const a = page.getArtBox()
    const fmt = (r: { x: number; y: number; width: number; height: number }) =>
      `${r.width.toFixed(2)} × ${r.height.toFixed(2)}  (x:${r.x.toFixed(2)} y:${r.y.toFixed(2)})`
    console.group(`Page ${i + 1}`)
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
  const srcDoc = await PDFDocument.load(fileBytes)
  const allPages = srcDoc.getPages()
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
    const x = col * strideX - refBox.x
    const y = (rows - 1 - row) * strideY - refBox.y

    page.drawPage(embedded, { x, y })
  }

  return { bytes: await newDoc.save(), widthPt: pageW, heightPt: pageH }
}
