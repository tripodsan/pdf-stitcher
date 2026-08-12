<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import type { Layer } from '../types'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href

const props = defineProps<{
  sourceBytes: ArrayBuffer | null
  pageRange: [number, number] | null
  columns: number
  modelValue: (number | null)[]
  fillOrder: 'row' | 'column'
  horizontalFlow: 'ltr' | 'rtl'
  verticalFlow: 'ttb' | 'btt'
  rotations: Partial<Record<number, 90 | 180 | 270>>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: (number | null)[]]
  'update:fillOrder': [value: 'row' | 'column']
  'update:horizontalFlow': [value: 'ltr' | 'rtl']
  'update:verticalFlow': [value: 'ttb' | 'btt']
  'update:rotations': [value: Partial<Record<number, 90 | 180 | 270>>]
  loaded: [totalPages: number]
  layersLoaded: [layers: Layer[]]
}>()

const sequence = ref<(number | null)[]>([])
const thumbnails = ref<Map<number, string>>(new Map())
let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null
const dragIndex = ref<number | null>(null)
const dropIndex = ref<number | null>(null)

function rangeLen(): number {
  if (!props.pageRange) return 0
  return props.pageRange[1] - props.pageRange[0] + 1
}

// Absolute 0-based source page index for a 1-based within-range page number —
// matches the indexing stitcher.ts uses, so rotations stay attached to the
// right physical page even if the page range is later changed.
function absolutePageIndex(rangeRelativeNum: number): number {
  return (props.pageRange![0] - 1) + (rangeRelativeNum - 1)
}

function tileRotation(rangePageNum: number | null): number {
  if (rangePageNum === null) return 0
  return props.rotations[absolutePageIndex(rangePageNum)] ?? 0
}

function advanceRotation(rotations: Partial<Record<number, 90 | 180 | 270>>, idx: number) {
  const current = rotations[idx] ?? 0
  const next = ((current + 90) % 360) as 0 | 90 | 180 | 270
  if (next === 0) {
    delete rotations[idx]
  } else {
    rotations[idx] = next
  }
}

function rotateTile(rangePageNum: number) {
  const updated = { ...props.rotations }
  advanceRotation(updated, absolutePageIndex(rangePageNum))
  emit('update:rotations', updated)
}

function rotateAll() {
  const updated = { ...props.rotations }
  for (const tile of sequence.value) {
    if (tile === null) continue
    advanceRotation(updated, absolutePageIndex(tile))
  }
  emit('update:rotations', updated)
}

function computeNaturalOrder(
  len: number,
  overrides: {
    fillOrder?: 'row' | 'column'
    horizontalFlow?: 'ltr' | 'rtl'
    verticalFlow?: 'ttb' | 'btt'
  } = {},
): (number | null)[] {
  const cols = props.columns
  const rows = Math.ceil(len / cols)
  const fillOrder = overrides.fillOrder ?? props.fillOrder
  const horizontalFlow = overrides.horizontalFlow ?? props.horizontalFlow
  const verticalFlow = overrides.verticalFlow ?? props.verticalFlow
  const effRow = (r: number) => (verticalFlow === 'btt' ? rows - 1 - r : r)
  const effCol = (c: number) => (horizontalFlow === 'rtl' ? cols - 1 - c : c)

  if (fillOrder === 'row') {
    // The flat array is already stored row-major, so the existing `len`
    // positions (decoded row-major) are exactly the real tiles — no padding
    // needed, and this matches the plain 1..len order by default.
    const positions = Array.from({ length: len }, (_, i) => ({
      row: Math.floor(i / cols),
      col: i % cols,
    }))
    const sortKey = (p: { row: number; col: number }) => effRow(p.row) * cols + effCol(p.col)
    const order = [...positions].sort((a, b) => sortKey(a) - sortKey(b))
    const seq = new Array<number>(len)
    order.forEach((p, idx) => {
      seq[p.row * cols + p.col] = idx + 1
    })
    return seq
  }

  // Column-major: rank every slot in the full rows x cols grid by fill
  // traversal order, then assign real page numbers to the first `len` slots
  // and blanks to the rest. This puts any leftover tiles (when len isn't a
  // multiple of rows) at the tail of the traversal — e.g. a short last
  // column — instead of scattered across a row-major-shaped hole, which
  // would otherwise misplace tiles near the end of a partial grid.
  const total = rows * cols
  const positions: { row: number; col: number }[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) positions.push({ row, col })
  }
  const sortKey = (p: { row: number; col: number }) => effCol(p.col) * rows + effRow(p.row)
  const order = [...positions].sort((a, b) => sortKey(a) - sortKey(b))
  const seq = new Array<number | null>(total).fill(null)
  order.forEach((p, idx) => {
    seq[p.row * cols + p.col] = idx < len ? idx + 1 : null
  })
  return seq
}

async function generateThumbnail(rangePageNum: number) {
  if (!pdfDoc || !props.pageRange) return
  try {
    const pdfjsPageNum = props.pageRange[0] + rangePageNum - 1
    const page = await pdfDoc.getPage(pdfjsPageNum)
    const naturalVp = page.getViewport({ scale: 1 })
    const scale = 192 / naturalVp.width
    const vp = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(vp.width)
    canvas.height = Math.round(vp.height)
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp, canvas }).promise
    thumbnails.value = new Map(thumbnails.value).set(rangePageNum, canvas.toDataURL('image/jpeg', 0.8))
  } catch {
    // ignore render errors for individual thumbnails
  }
}

// Step 1: load the document when sourceBytes changes; emit loaded/layersLoaded
watch(
  () => props.sourceBytes,
  async (bytes) => {
    if (pdfDoc) {
      await pdfDoc.destroy()
      pdfDoc = null
    }
    thumbnails.value = new Map()
    sequence.value = []

    if (!bytes) return

    const copy = bytes.slice(0)
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(copy) })
    pdfDoc = await loadingTask.promise
    emit('loaded', pdfDoc.numPages)

    // Extract OCG layers if present
    try {
      const ocConfig = await pdfDoc.getOptionalContentConfig()
      if (ocConfig) {
        const layers: Layer[] = []
        for (const [id, group] of ocConfig) {
          const name = (group as { name: string; visible: boolean })?.name
          if (!name) continue
          const visible = (group as { name: string; visible: boolean }).visible ?? true
          layers.push({ id: String(id), name, visible })
        }
        if (layers.length) {
          emit('layersLoaded', layers)
        }
      }
    } catch {
      // PDF has no OCG support — silently skip
    }
  },
  { immediate: true },
)

// Step 2: once pageRange is set (by the parent reacting to `loaded`), init sequence and thumbnails
watch(
  () => props.pageRange,
  (range) => {
    if (!pdfDoc || !range) return
    const len = range[1] - range[0] + 1
    thumbnails.value = new Map()
    if (props.modelValue.length === 0) {
      const nat = computeNaturalOrder(len)
      sequence.value = nat
      emit('update:modelValue', [...nat])
    } else {
      sequence.value = [...props.modelValue]
    }
    for (let n = 1; n <= len; n++) {
      generateThumbnail(n)
    }
  },
)

// Grid dimensions changed (e.g. via the Columns/Rows setting) — regenerate,
// since the existing sequence was laid out for the previous grid shape.
watch(
  () => props.columns,
  () => {
    if (!pdfDoc || !props.pageRange) return
    reset()
  },
)

watch(
  () => props.modelValue,
  (val) => {
    if (val.length > 0 && JSON.stringify(val) !== JSON.stringify(sequence.value)) {
      sequence.value = [...val]
    }
  },
)

function reset() {
  const nat = computeNaturalOrder(rangeLen())
  sequence.value = nat
  emit('update:modelValue', [...nat])
}

function setFillOrder(value: 'row' | 'column') {
  emit('update:fillOrder', value)
  const nat = computeNaturalOrder(rangeLen(), { fillOrder: value })
  sequence.value = nat
  emit('update:modelValue', [...nat])
}

function setHorizontalFlow(value: 'ltr' | 'rtl') {
  emit('update:horizontalFlow', value)
  const nat = computeNaturalOrder(rangeLen(), { horizontalFlow: value })
  sequence.value = nat
  emit('update:modelValue', [...nat])
}

function setVerticalFlow(value: 'ttb' | 'btt') {
  emit('update:verticalFlow', value)
  const nat = computeNaturalOrder(rangeLen(), { verticalFlow: value })
  sequence.value = nat
  emit('update:modelValue', [...nat])
}

function insertBlank(beforeIndex: number) {
  const next = [...sequence.value]
  next.splice(beforeIndex, 0, null)
  sequence.value = next
  emit('update:modelValue', [...next])
}

function removeTile(index: number) {
  const next = sequence.value.filter((_, i) => i !== index)
  const len = rangeLen()
  sequence.value = next.length ? next : computeNaturalOrder(len)
  emit('update:modelValue', [...sequence.value])
}

function onDragStart(index: number) {
  dragIndex.value = index
}

function onDragOver(e: DragEvent, index: number) {
  e.preventDefault()
  dropIndex.value = index
}

function onDrop(e: DragEvent, index: number) {
  e.preventDefault()
  if (dragIndex.value === null || dragIndex.value === index) {
    dragIndex.value = null
    dropIndex.value = null
    return
  }
  const next = [...sequence.value]
  const [item] = next.splice(dragIndex.value, 1)
  const insertAt = index > dragIndex.value ? index - 1 : index
  next.splice(insertAt, 0, item)
  sequence.value = next
  emit('update:modelValue', [...next])
  dragIndex.value = null
  dropIndex.value = null
}

function onDragEnd() {
  dragIndex.value = null
  dropIndex.value = null
}

onUnmounted(async () => {
  if (pdfDoc) await pdfDoc.destroy()
})
</script>

<template>
  <div class="tile-grid-section">
    <div class="tile-grid-header">
      <span class="tile-grid-title">Tile Order</span>
      <div class="tile-grid-controls">
        <button
          class="btn-reset"
          :title="props.fillOrder === 'row' ? 'Switch to column-by-column fill' : 'Switch to row-by-row fill'"
          @click="setFillOrder(props.fillOrder === 'row' ? 'column' : 'row')"
        >
          Fill: {{ props.fillOrder === 'row' ? 'Rows' : 'Columns' }}
        </button>
        <button
          class="btn-reset"
          title="Toggle horizontal flow direction"
          @click="setHorizontalFlow(props.horizontalFlow === 'ltr' ? 'rtl' : 'ltr')"
        >
          {{ props.horizontalFlow === 'ltr' ? '→' : '←' }}
        </button>
        <button
          class="btn-reset"
          title="Toggle vertical flow direction"
          @click="setVerticalFlow(props.verticalFlow === 'ttb' ? 'btt' : 'ttb')"
        >
          {{ props.verticalFlow === 'ttb' ? '↓' : '↑' }}
        </button>
        <button class="btn-reset" title="Rotate all tiles 90°" @click="rotateAll">⟳ Rotate All</button>
        <button class="btn-reset" @click="reset">Reset</button>
      </div>
    </div>
    <div
      class="tile-grid"
      :style="{ gridTemplateColumns: `repeat(${columns}, 1fr)` }"
    >
      <div
        v-for="(tile, i) in sequence"
        :key="tile === null ? `blank-${i}` : `page-${tile}-${i}`"
        class="tile"
        :class="{ 'tile-blank': tile === null, 'tile-drag-over': dropIndex === i }"
        draggable="true"
        @dragstart="onDragStart(i)"
        @dragover="onDragOver($event, i)"
        @drop="onDrop($event, i)"
        @dragend="onDragEnd"
      >
        <div class="tile-thumb">
          <img
            v-if="tile !== null && thumbnails.get(tile)"
            :src="thumbnails.get(tile)"
            :style="tileRotation(tile) ? { transform: `rotate(${tileRotation(tile)}deg)` } : undefined"
            alt=""
          />
          <div v-else-if="tile !== null" class="thumb-shimmer" />
          <div v-else class="thumb-blank" />
        </div>
        <div class="tile-label">{{ tile !== null ? `p${tile}` : '—' }}</div>
        <button class="tile-insert" title="Insert blank before" @click.stop="insertBlank(i)">+</button>
        <button class="tile-remove" title="Remove" @click.stop="removeTile(i)">×</button>
        <button
          v-if="tile !== null"
          class="tile-rotate"
          :class="{ 'tile-rotate-active': tileRotation(tile) !== 0 }"
          :title="`Rotate 90° (currently ${tileRotation(tile)}°)`"
          @click.stop="rotateTile(tile)"
        >⟳</button>
      </div>
    </div>
    <p v-if="sequence.length === 0" class="tile-empty">Load a PDF to see tiles here.</p>
  </div>
</template>

<style scoped>
.tile-grid-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  min-height: 200px;
}

.tile-grid-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.tile-grid-controls {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.tile-grid-title {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}

.btn-reset {
  padding: 0.25rem 0.7rem;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 500;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  cursor: pointer;
}

.btn-reset:hover {
  background: var(--color-border);
}

.tile-grid {
  display: grid;
  gap: 0.75rem;
  align-items: start;
  overflow-y: auto;
}

.tile {
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  padding: 0.4rem;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  cursor: grab;
  user-select: none;
  transition: border-color 0.1s, box-shadow 0.1s;
}

.tile:hover {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}

.tile:active {
  cursor: grabbing;
}

.tile-drag-over {
  border-color: var(--color-accent);
  box-shadow: -3px 0 0 var(--color-accent);
}

.tile-blank {
  opacity: 0.5;
  cursor: default;
}

.tile-thumb {
  width: 100%;
  aspect-ratio: 1 / 1.414;
  border-radius: 3px;
  overflow: hidden;
  background: #e5e5e5;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tile-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.thumb-shimmer {
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, #e5e5e5 25%, #f0f0f0 50%, #e5e5e5 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.thumb-blank {
  width: 100%;
  height: 100%;
  background: repeating-linear-gradient(
    45deg,
    #e5e5e5,
    #e5e5e5 4px,
    #f5f5f5 4px,
    #f5f5f5 10px
  );
}

.tile-label {
  font-size: 0.7rem;
  color: var(--color-text-muted);
  font-weight: 500;
}

.tile-insert,
.tile-remove {
  position: absolute;
  top: 3px;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 50%;
  border: none;
  font-size: 0.75rem;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s;
}

.tile-insert {
  left: 3px;
  background: rgba(0,0,0,0.15);
  color: #fff;
}

.tile-remove {
  right: 3px;
  background: rgba(0,0,0,0.15);
  color: #fff;
}

.tile:hover .tile-insert,
.tile:hover .tile-remove {
  opacity: 1;
}

.tile-insert:hover {
  background: var(--color-accent);
}

.tile-remove:hover {
  background: var(--color-error);
}

.tile-rotate {
  position: absolute;
  bottom: 3px;
  right: 3px;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 50%;
  border: none;
  font-size: 0.85rem;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.15);
  color: #fff;
  opacity: 0;
  transition: opacity 0.15s;
}

.tile:hover .tile-rotate {
  opacity: 1;
}

.tile-rotate:hover {
  background: var(--color-accent);
}

.tile-rotate-active {
  opacity: 1;
  background: var(--color-accent);
}

.tile-empty {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text-muted);
  text-align: center;
  padding: 2rem 0;
}
</style>
