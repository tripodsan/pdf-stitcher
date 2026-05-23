#!/usr/bin/env node
/**
 * Analyzes PDF content streams to identify helper-mark signatures.
 * Usage: node scripts/analyze-pdf-streams.mjs <file.pdf> [maxPages]
 *
 * Reports per-page findings useful for writing removeBorders rules:
 *   - /OC BDC blocks (with re count and color operators)
 *   - /Cs* CS color spaces (PAT-style corner marks)
 *   - 0 G re S border rectangles (PAT-style border)
 *   - Specific rg/RG/scn/SCN color values
 *   - /Fm* Do XObject calls (pagination overlays)
 */

import { readFileSync } from 'fs'
import * as mupdf from 'mupdf'

const [, , filePath, maxPagesArg] = process.argv
if (!filePath) { console.error('Usage: node analyze-pdf-streams.mjs <file.pdf> [maxPages]'); process.exit(1) }

const maxPages = maxPagesArg ? parseInt(maxPagesArg, 10) : Infinity
const bytes = readFileSync(filePath).buffer
const doc = mupdf.Document.openDocument(bytes, 'application/pdf')
const pdfDoc = doc.asPDF()
const pageCount = Math.min(doc.countPages(), maxPages)

console.log(`\nFile: ${filePath}  (${doc.countPages()} pages, analyzing ${pageCount})\n`)

for (let i = 0; i < pageCount; i++) {
  const pageDict = doc.findPage(i).resolve()
  const contents = pageDict.get('Contents')
  if (!contents || contents.isNull()) continue

  const streamNums = []
  if (contents.isArray()) {
    for (let j = 0; j < contents.length; j++) {
      const ref = contents.get(j)
      if (ref.isIndirect()) streamNums.push(ref.asIndirect())
    }
  } else if (contents.isIndirect()) {
    streamNums.push(contents.asIndirect())
  }

  const findings = []

  for (const num of streamNums) {
    const obj = pdfDoc.newIndirect(num)
    if (!obj.isStream()) continue
    const tokens = tokenize(obj.readStream().asString())

    // /OC BDC blocks
    for (let t = 2; t < tokens.length; t++) {
      if ((tokens[t] === 'BDC' || tokens[t] === 'BMC') && tokens[t - 2] === '/OC') {
        const mcName = tokens[t - 1]
        let depth = 1, emcIdx = -1
        for (let j = t + 1; j < tokens.length; j++) {
          if (tokens[j] === 'BDC' || tokens[j] === 'BMC') depth++
          else if (tokens[j] === 'EMC') { depth--; if (depth === 0) { emcIdx = j; break } }
        }
        if (emcIdx === -1) continue
        const inner = tokens.slice(t + 1, emcIdx)
        const reCount = inner.filter(x => x === 're').length
        const colors = extractColors(inner)
        const hasDo = inner.some((x, i) => x === 'Do' && inner[i - 1]?.startsWith('/Fm'))
        findings.push(`  /OC ${mcName} BDC (len=${emcIdx - t - 1}): re×${reCount}${colors}${hasDo ? ', /Fm* Do' : ''}`)
      }
    }

    // /Cs* CS color spaces
    const csNames = new Set()
    for (let t = 1; t < tokens.length; t++) {
      if (tokens[t] === 'CS' && tokens[t - 1].startsWith('/Cs')) csNames.add(tokens[t - 1])
    }
    if (csNames.size) findings.push(`  Color spaces: ${[...csNames].join(' ')}`)

    // 0 G re S border rect
    if (findBorderRectEnd(tokens) !== null) findings.push('  PAT border: 0 G ... re S found')

    // /Fm* Do outside BDC
    const fmDo = []
    for (let t = 1; t < tokens.length; t++) {
      if (tokens[t] === 'Do' && tokens[t - 1].startsWith('/Fm')) fmDo.push(tokens[t - 1])
    }
    if (fmDo.length) findings.push(`  /Fm Do (outside BDC): ${fmDo.join(' ')}`)

    // Prominent rg/RG/scn/SCN color values
    const colorOps = collectColorOps(tokens)
    if (colorOps.length) findings.push(`  Colors: ${colorOps.join('  ')}`)
  }

  if (findings.length) {
    console.log(`Page ${i + 1}:`)
    findings.forEach(f => console.log(f))
  }
}

// ---------------------------------------------------------------------------

function extractColors(tokens) {
  const seen = []
  for (let i = 3; i < tokens.length; i++) {
    const op = tokens[i]
    if (['rg', 'RG', 'scn', 'SCN'].includes(op)) {
      const rgb = `${tokens[i-3]} ${tokens[i-2]} ${tokens[i-1]} ${op}`
      seen.push(rgb)
    }
    if (['g', 'G'].includes(op)) seen.push(`${tokens[i-1]} ${op}`)
  }
  return seen.length ? ', ' + [...new Set(seen)].join('; ') : ''
}

function collectColorOps(tokens) {
  const results = []
  for (let i = 3; i < tokens.length; i++) {
    const op = tokens[i]
    if (['rg', 'RG'].includes(op)) {
      const r = parseFloat(tokens[i-3]), g = parseFloat(tokens[i-2]), b = parseFloat(tokens[i-1])
      if (!isNaN(r)) results.push(`${r} ${g} ${b} ${op}`)
    }
    if (['scn', 'SCN'].includes(op) && !isNaN(parseFloat(tokens[i-3]))) {
      results.push(`${tokens[i-3]} ${tokens[i-2]} ${tokens[i-1]} ${op}`)
    }
  }
  return [...new Set(results)]
}

function findBorderRectEnd(tokens) {
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === 'G' && tokens[i - 1] === '0') {
      for (let j = i + 1; j < tokens.length; j++) {
        const t = tokens[j]
        if (t === 'S') { if (tokens.slice(i, j).includes('re')) return j; break }
        if (['q', 'Q', 'BT', 'rg', 'RG', 'cs', 'CS'].includes(t) && j > i + 2) break
      }
    }
  }
  return null
}

function tokenize(stream) {
  const tokens = []
  let i = 0
  const n = stream.length
  while (i < n) {
    while (i < n && stream[i] <= ' ') i++
    if (i >= n) break
    const ch = stream[i]
    if (ch === '%') {
      while (i < n && stream[i] !== '\n' && stream[i] !== '\r') i++
    } else if (ch === '/') {
      let j = i + 1
      while (j < n && stream[j] > ' ' && !'/<>[](){}%'.includes(stream[j])) j++
      tokens.push(stream.slice(i, j)); i = j
    } else if (ch === '(') {
      let j = i + 1, depth = 1
      while (j < n && depth > 0) {
        if (stream[j] === '\\') { j += 2; continue }
        if (stream[j] === '(') depth++
        else if (stream[j] === ')') depth--
        j++
      }
      tokens.push(stream.slice(i, j)); i = j
    } else if (ch === '[') {
      let j = i + 1, depth = 1
      while (j < n && depth > 0) {
        if (stream[j] === '(') {
          j++; let sd = 1
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
      tokens.push(stream.slice(i, j)); i = j
    } else if (ch === '<' && stream[i + 1] === '<') {
      let j = i + 2, depth = 1
      while (j < n - 1 && depth > 0) {
        if (stream[j] === '<' && stream[j + 1] === '<') { depth++; j++ }
        else if (stream[j] === '>' && stream[j + 1] === '>') { depth--; j++ }
        j++
      }
      tokens.push(stream.slice(i, j)); i = j
    } else {
      let j = i
      while (j < n && stream[j] > ' ' && !'/<>[](){}%'.includes(stream[j])) j++
      tokens.push(stream.slice(i, j)); i = j
    }
  }
  return tokens
}
