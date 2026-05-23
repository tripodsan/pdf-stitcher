/**
 * Strips A4 helper borders from every page of a PDF before stitching.
 * Uses mupdf for stream access, same lazy-load pattern as decryptPdf.ts.
 *
 * Handles two known PDF styles:
 *   PAT-style   — /Cs8 CS corner marks + 0 G re S border rect
 *   BECKY-style — 0.925/0.125/0.153 re S borders, blue 0.184/0.208/0.561 fill diamonds,
 *                 /Fm* Do pagination overlays
 */
export async function removeBorders(fileBytes: ArrayBuffer): Promise<Uint8Array> {
  const mupdf = await import('mupdf')
  const doc = mupdf.Document.openDocument(fileBytes, 'application/pdf') as InstanceType<typeof mupdf.PDFDocument>
  const pdfDoc = doc.asPDF() as InstanceType<typeof mupdf.PDFDocument>
  const pageCount = doc.countPages()

  for (let i = 0; i < pageCount; i++) {
    const pageDict = doc.findPage(i).resolve()
    const contents = pageDict.get('Contents')
    if (!contents || contents.isNull()) continue

    const streamNums: number[] = []
    if (contents.isArray()) {
      for (let j = 0; j < contents.length; j++) {
        const ref = contents.get(j)
        if (ref.isIndirect()) streamNums.push(ref.asIndirect())
      }
    } else if (contents.isIndirect()) {
      streamNums.push(contents.asIndirect())
    }

    for (const num of streamNums) {
      const obj = pdfDoc.newIndirect(num)
      if (!obj.isStream()) continue
      const original = obj.readStream().asString()
      const cleaned = stripHelperBorders(original)
      if (cleaned !== original) {
        const buf = new mupdf.Buffer()
        buf.write(cleaned)
        obj.writeStream(buf)
      }
    }
  }

  return doc.saveToBuffer('').asUint8Array()
}

// ---------------------------------------------------------------------------
// Stream processing
// ---------------------------------------------------------------------------

function stripHelperBorders(stream: string): string {
  const tokens = tokenize(stream)
  const ranges: Array<[number, number]> = []

  // PAT-style: /Cs8 CS corner marks + 0 G ... re S border rect
  {
    let cs8Idx = -1
    for (let i = 0; i < tokens.length - 1; i++) {
      if (tokens[i] === '/Cs8' && tokens[i + 1] === 'CS') { cs8Idx = i; break }
    }
    const borderEnd = findBorderRectEnd(tokens)
    if (cs8Idx !== -1 || borderEnd !== null) {
      const searchFrom = cs8Idx !== -1 ? cs8Idx : borderEnd!
      const start = findSectionStart(tokens, searchFrom)
      const end = borderEnd !== null ? borderEnd + 1 : findFallbackEnd(tokens, cs8Idx)
      ranges.push([start, end])
    }
  }

  // BECKY-style: S blocks that contain `re` AND the specific red stroke color
  // (covers both the 4-rect full-border and single-edge rect variants)
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === 'S') {
      const sectionStart = findSectionStart(tokens, i)
      let hasRect = false
      let hasRedColor = false
      for (let j = sectionStart; j < i; j++) {
        if (tokens[j] === 're') hasRect = true
        if (tokens[j] === 'SCN' && j >= 3 && isApproxColor(tokens, j - 3, [0.925, 0.125, 0.153])) {
          hasRedColor = true
        }
      }
      if (hasRect && hasRedColor) ranges.push([sectionStart, i + 1])
    }
  }

  // BECKY-style: blue fill shapes — alignment diamond triangles
  for (let i = 3; i < tokens.length; i++) {
    if (tokens[i] === 'scn' && isApproxColor(tokens, i - 3, [0.184, 0.208, 0.561])) {
      const sectionStart = findSectionStart(tokens, i - 3)
      const blockEnd = findQDepthBlockEnd(tokens, i + 1)
      ranges.push([sectionStart, blockEnd])
    }
  }

  // BECKY-style: /Fm* Do calls — pagination watermarks and page-number overlays
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === 'Do' && tokens[i - 1].startsWith('/Fm')) {
      const sectionStart = findSectionStart(tokens, i - 1)
      const blockEnd = findQDepthBlockEnd(tokens, i + 1)
      ranges.push([sectionStart, blockEnd])
    }
  }

  // PAT-style: red badge circle (0.87611 0 0 rg ... h f)
  for (let i = 3; i < tokens.length; i++) {
    if (tokens[i] === 'rg' && isApproxColor(tokens, i - 3, [0.87611, 0, 0])) {
      const sectionStart = findSectionStart(tokens, i - 3)
      const blockEnd = findQDepthBlockEnd(tokens, i + 1)
      ranges.push([sectionStart, blockEnd])
    }
  }

  // Birkin-style: /OC BDC blocks containing black border rects + triangle marks
  for (let i = 2; i < tokens.length; i++) {
    if ((tokens[i] === 'BDC' || tokens[i] === 'BMC') && tokens[i - 2] === '/OC') {
      let depth = 1, emcIdx = -1
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j] === 'BDC' || tokens[j] === 'BMC') depth++
        else if (tokens[j] === 'EMC') { depth--; if (depth === 0) { emcIdx = j; break } }
      }
      if (emcIdx === -1) continue
      let hasBlackRGB = false, reCount = 0
      for (let j = i + 1; j < emcIdx; j++) {
        if (tokens[j] === 'RG' && j >= 3 && isApproxColor(tokens, j - 3, [0, 0, 0])) hasBlackRGB = true
        if (tokens[j] === 're') reCount++
      }
      if (hasBlackRGB && reCount >= 3) ranges.push([i - 2, emcIdx + 1])
    }
  }

  // PAT-style: rotated badge text (q 0 1 -1 0 x y cm ... BT...ET Q)
  for (let i = 0; i + 7 < tokens.length; i++) {
    if (tokens[i] === 'q' && tokens[i + 7] === 'cm' &&
        Math.abs(parseFloat(tokens[i + 1])) < 0.001 &&
        Math.abs(parseFloat(tokens[i + 2]) - 1) < 0.001 &&
        Math.abs(parseFloat(tokens[i + 3]) + 1) < 0.001 &&
        Math.abs(parseFloat(tokens[i + 4])) < 0.001) {
      const blockEnd = findQDepthBlockEnd(tokens, i + 1)
      ranges.push([i, blockEnd])
    }
  }

  if (ranges.length === 0) return stream
  return applyExcisions(tokens, ranges)
}

// ---------------------------------------------------------------------------
// Range helpers
// ---------------------------------------------------------------------------

/** Apply sorted (possibly overlapping) excision ranges; returns the reassembled stream. */
function applyExcisions(tokens: string[], ranges: Array<[number, number]>): string {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const kept: string[] = []
  let pos = 0
  for (const [start, end] of sorted) {
    for (let i = pos; i < start; i++) kept.push(tokens[i])
    pos = Math.max(pos, end)
  }
  for (let i = pos; i < tokens.length; i++) kept.push(tokens[i])
  return kept.join(' ')
}

/** Check whether three consecutive tokens approximate the given RGB values. */
function isApproxColor(tokens: string[], startIdx: number, values: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    const n = parseFloat(tokens[startIdx + i])
    if (isNaN(n) || Math.abs(n - values[i]) > 0.001) return false
  }
  return true
}

/**
 * Scan forward from `from`, tracking q/Q depth.
 * Stops (and returns index+1) at:
 *   - A Q that brings depth back to 0 after we entered at least one q, OR
 *   - A Q encountered before any q (closes something outside our section), OR
 *   - A path-painting operator (f F B b n f* B*) when depth is 0.
 */
function findQDepthBlockEnd(tokens: string[], from: number): number {
  const terminators = new Set(['f', 'F', 'B', 'b', 'n', 'f*', 'B*'])
  let depth = 0
  for (let i = from; i < tokens.length; i++) {
    if (tokens[i] === 'q') {
      depth++
    } else if (tokens[i] === 'Q') {
      if (depth > 0) {
        depth--
        if (depth === 0) return i + 1
      } else {
        return i + 1
      }
    } else if (depth === 0 && terminators.has(tokens[i])) {
      return i + 1
    }
  }
  return tokens.length
}

/** Walk backward from `from` to find the last content-boundary token; return its index + 1. */
function findSectionStart(tokens: string[], from: number): number {
  const boundaries = new Set(['S', 's', 'f', 'F', 'B', 'b', 'n', 'Q', 'ET'])
  for (let i = from - 1; i >= 0; i--) {
    if (boundaries.has(tokens[i])) return i + 1
  }
  return 0
}

/**
 * Scan for the `0 G ... re S` border rectangle pattern (PAT-style).
 * Returns the index of the `S` token, or null if not found.
 */
function findBorderRectEnd(tokens: string[]): number | null {
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === 'G' && tokens[i - 1] === '0') {
      for (let j = i + 1; j < tokens.length; j++) {
        const t = tokens[j]
        if (t === 'S') {
          if (tokens.slice(i, j).includes('re')) return j
          break
        }
        if (['q', 'Q', 'BT', 'rg', 'RG', 'cs', 'CS'].includes(t) && j > i + 2) break
      }
    }
  }
  return null
}

/** From `from`, scan forward for the next `Q` and return its index + 1. */
function findFallbackEnd(tokens: string[], from: number): number {
  for (let i = from + 2; i < tokens.length; i++) {
    if (tokens[i] === 'Q') return i + 1
  }
  return tokens.length
}

// ---------------------------------------------------------------------------
// PDF content stream tokenizer
// ---------------------------------------------------------------------------

function tokenize(stream: string): string[] {
  const tokens: string[] = []
  let i = 0
  const n = stream.length

  while (i < n) {
    // Skip whitespace
    while (i < n && stream[i] <= ' ') i++
    if (i >= n) break

    const ch = stream[i]

    if (ch === '%') {
      // Comment — skip to end of line
      while (i < n && stream[i] !== '\n' && stream[i] !== '\r') i++
    } else if (ch === '/') {
      // Name object
      let j = i + 1
      while (j < n && stream[j] > ' ' && !'/<>[](){}%'.includes(stream[j])) j++
      tokens.push(stream.slice(i, j))
      i = j
    } else if (ch === '(') {
      // Literal string — handle balanced parens and backslash escapes
      let j = i + 1
      let depth = 1
      while (j < n && depth > 0) {
        if (stream[j] === '\\') { j += 2; continue }
        if (stream[j] === '(') depth++
        else if (stream[j] === ')') depth--
        j++
      }
      tokens.push(stream.slice(i, j))
      i = j
    } else if (ch === '[') {
      // Array — must skip (string) literals to avoid miscounting [ and ] inside them
      let j = i + 1
      let depth = 1
      while (j < n && depth > 0) {
        if (stream[j] === '(') {
          j++
          let sd = 1
          while (j < n && sd > 0) {
            if (stream[j] === '\\') { j += 2; continue }
            if (stream[j] === '(') sd++
            else if (stream[j] === ')') sd--
            j++
          }
        } else if (stream[j] === '[') { depth++; j++ }
        else if (stream[j] === ']') { depth--; j++ }
        else j++
      }
      tokens.push(stream.slice(i, j))
      i = j
    } else if (ch === '<' && stream[i + 1] === '<') {
      // Dictionary (rare in content streams)
      let j = i + 2
      let depth = 1
      while (j < n - 1 && depth > 0) {
        if (stream[j] === '<' && stream[j + 1] === '<') { depth++; j++ }
        else if (stream[j] === '>' && stream[j + 1] === '>') { depth--; j++ }
        j++
      }
      tokens.push(stream.slice(i, j))
      i = j
    } else {
      // Number, operator, or hex string
      let j = i
      while (j < n && stream[j] > ' ' && !'/<>[](){}%'.includes(stream[j])) j++
      tokens.push(stream.slice(i, j))
      i = j
    }
  }

  return tokens
}
