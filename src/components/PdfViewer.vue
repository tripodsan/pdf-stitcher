<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import type { Layer } from '../types'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href

const props = defineProps<{
  source: ArrayBuffer | null
  label: string
  subtitle?: string
  oversample?: number
  preserveView?: boolean
  layerVisibility?: Record<string, boolean> | null
}>()

const emit = defineEmits<{
  loaded: [totalPages: number]
  layersLoaded: [layers: Layer[]]
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
const wrap = ref<HTMLDivElement | null>(null)
const currentPage = ref(1)
const totalPages = ref(0)
const rendering = ref(false)
const userZoom = ref(1.0)
const panX = ref(0)
const panY = ref(0)
const isPanning = ref(false)
const fitScaleRef = ref(1)

const isMeasuring   = ref(false)
const isMeasureDrag = ref(false)
const measureStartPt = ref<{ x: number; y: number } | null>(null)
const measureLivePt  = ref<{ x: number; y: number } | null>(null)
const measureEndPt   = ref<{ x: number; y: number } | null>(null)

let panOrigin = { x: 0, y: 0, px: 0, py: 0 }
let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null
let renderTask: pdfjsLib.RenderTask | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ocConfigRef: any = null
let nameToIdRef = new Map<string, string>()

async function loadDocument(bytes: ArrayBuffer) {
  if (pdfDoc) {
    await pdfDoc.destroy()
    pdfDoc = null
  }
  ocConfigRef = null
  nameToIdRef = new Map()
  const copy = bytes.slice(0)
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(copy) })
  pdfDoc = await loadingTask.promise
  totalPages.value = pdfDoc.numPages
  currentPage.value = 1
  if (!props.preserveView) {
    userZoom.value = 1.0
    panX.value = 0
    panY.value = 0
  }
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
        nameToIdRef.set(name, String(id))
      }
      if (layers.length) {
        ocConfigRef = ocConfig
        emit('layersLoaded', layers)
      }
    }
  } catch {
    // PDF has no OCG support — silently skip
  }

  await renderPage(1)
}

async function renderPage(pageNum: number) {
  if (!pdfDoc || !canvas.value) return
  await nextTick()  // ensure DOM is laid out before measuring container width
  if (renderTask) {
    const stale = renderTask
    renderTask = null
    stale.cancel()
    try { await stale.promise } catch { /* RenderingCancelledException — expected */ }
  }
  rendering.value = true
  try {
    const page = await pdfDoc.getPage(pageNum)
    const containerWidth = canvas.value.parentElement!.clientWidth || 600
    const naturalVp = page.getViewport({ scale: 1 })
    const fitScale = containerWidth / naturalVp.width
    fitScaleRef.value = fitScale
    const n = props.oversample ?? 1
    const renderViewport = page.getViewport({ scale: fitScale * n })
    const displayWidth = containerWidth
    const displayHeight = naturalVp.height * fitScale
    const c = canvas.value
    c.width = renderViewport.width
    c.height = renderViewport.height
    c.style.width = displayWidth + 'px'
    c.style.height = displayHeight + 'px'
    if (wrap.value) {
      wrap.value.style.height = displayHeight + 'px'
    }
    const ctx = c.getContext('2d')!
    renderTask = page.render({
      canvasContext: ctx,
      viewport: renderViewport,
      canvas: c,
      ...(ocConfigRef ? { optionalContentConfigPromise: Promise.resolve(ocConfigRef) } : {}),
    })
    await renderTask.promise
  } catch (e: unknown) {
    if ((e as { name?: string }).name !== 'RenderingCancelledException') throw e
  } finally {
    rendering.value = false
    renderTask = null
  }
}

async function prev() {
  if (currentPage.value <= 1) return
  currentPage.value--
  panX.value = 0
  panY.value = 0
  clearMeasure()
  await renderPage(currentPage.value)
}

async function next() {
  if (currentPage.value >= totalPages.value) return
  currentPage.value++
  panX.value = 0
  panY.value = 0
  clearMeasure()
  await renderPage(currentPage.value)
}

function zoomIn() {
  userZoom.value *= 1.25
  panX.value = 0
  panY.value = 0
}

function zoomOut() {
  userZoom.value /= 1.25
  panX.value = 0
  panY.value = 0
}

function zoomReset() {
  userZoom.value = 1.0
  panX.value = 0
  panY.value = 0
}

function startPan(e: MouseEvent) {
  isPanning.value = true
  panOrigin = { x: e.clientX, y: e.clientY, px: panX.value, py: panY.value }
}

function doPan(e: MouseEvent) {
  if (!isPanning.value) return
  panX.value = panOrigin.px + (e.clientX - panOrigin.x)
  panY.value = panOrigin.py + (e.clientY - panOrigin.y)
}

function endPan() {
  isPanning.value = false
}

function screenToPt(clientX: number, clientY: number) {
  const rect = wrap.value!.getBoundingClientRect()
  const scale = fitScaleRef.value * userZoom.value
  return {
    x: (clientX - rect.left - panX.value) / scale,
    y: (clientY - rect.top  - panY.value) / scale,
  }
}

const measureSvgA = computed(() => {
  if (!measureStartPt.value) return null
  const scale = fitScaleRef.value * userZoom.value
  return {
    x: measureStartPt.value.x * scale + panX.value,
    y: measureStartPt.value.y * scale + panY.value,
  }
})

const measureSvgB = computed(() => {
  const end = isMeasureDrag.value ? measureLivePt.value : measureEndPt.value
  if (!end) return null
  const scale = fitScaleRef.value * userZoom.value
  return { x: end.x * scale + panX.value, y: end.y * scale + panY.value }
})

const measureResult = computed(() => {
  if (!measureStartPt.value || !measureEndPt.value) return null
  const dx = Math.abs(measureEndPt.value.x - measureStartPt.value.x) * 25.4 / 72
  const dy = Math.abs(measureEndPt.value.y - measureStartPt.value.y) * 25.4 / 72
  return { dxMm: dx, dyMm: dy }
})

function clearMeasure() {
  measureStartPt.value = null
  measureEndPt.value   = null
  measureLivePt.value  = null
  isMeasureDrag.value  = false
}

function toggleMeasure() {
  isMeasuring.value = !isMeasuring.value
  if (!isMeasuring.value) clearMeasure()
}

function onMeasureDown(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  measureStartPt.value = screenToPt(e.clientX, e.clientY)
  measureEndPt.value   = null
  measureLivePt.value  = measureStartPt.value
  isMeasureDrag.value  = true
}

function onMeasureMove(e: MouseEvent) {
  e.stopPropagation()
  if (!isMeasureDrag.value) return
  measureLivePt.value = screenToPt(e.clientX, e.clientY)
}

function onMeasureUp(e: MouseEvent) {
  e.stopPropagation()
  if (!isMeasureDrag.value) return
  measureEndPt.value  = screenToPt(e.clientX, e.clientY)
  measureLivePt.value = null
  isMeasureDrag.value = false
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
  const newZoom = Math.max(0.2, Math.min(8, userZoom.value * factor))
  const ratio = newZoom / userZoom.value
  const rect = wrap.value!.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  panX.value = mx + (panX.value - mx) * ratio
  panY.value = my + (panY.value - my) * ratio
  userZoom.value = newZoom
}

function onKeyEsc(e: KeyboardEvent) {
  if (e.key === 'Escape' && isMeasuring.value) {
    isMeasuring.value = false
    clearMeasure()
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeyEsc)
  wrap.value?.addEventListener('wheel', onWheel, { passive: false })
})

watch(
  () => props.layerVisibility,
  (vis, prev) => {
    if (!ocConfigRef || !vis || !prev) return
    for (const [name, visible] of Object.entries(vis)) {
      const id = nameToIdRef.get(name)
      if (id !== undefined) ocConfigRef.setVisibility(id, visible)
    }
    renderPage(currentPage.value)
  },
)

watch(
  () => props.source,
  async (bytes) => {
    if (bytes) {
      await loadDocument(bytes)
    } else {
      if (pdfDoc) {
        await pdfDoc.destroy()
        pdfDoc = null
      }
      totalPages.value = 0
      currentPage.value = 1
    }
  },
  { immediate: true },
)

onUnmounted(async () => {
  document.removeEventListener('keydown', onKeyEsc)
  wrap.value?.removeEventListener('wheel', onWheel)
  if (renderTask) renderTask.cancel()
  if (pdfDoc) await pdfDoc.destroy()
})
</script>

<template>
  <div class="viewer">
    <div class="viewer-label">{{ label }}</div>
    <div v-if="subtitle" class="viewer-subtitle">{{ subtitle }}</div>
    <div
      ref="wrap"
      class="canvas-wrap"
      :class="{ panning: isPanning }"
      @mousedown="startPan"
      @mousemove="doPan"
      @mouseup="endPan"
      @mouseleave="endPan"
    >
      <canvas
        ref="canvas"
        :style="{ transform: `translate(${panX}px, ${panY}px) scale(${userZoom})`, transformOrigin: '0 0' }"
      />
      <div v-if="rendering" class="overlay">Rendering…</div>
      <svg
        v-if="isMeasuring"
        class="measure-overlay"
        @mousedown="onMeasureDown"
        @mousemove="onMeasureMove"
        @mouseup="onMeasureUp"
        @mouseleave="onMeasureUp"
      >
        <template v-if="measureSvgA && measureSvgB">
          <line :x1="measureSvgA.x" :y1="measureSvgA.y" :x2="measureSvgB.x" :y2="measureSvgB.y" class="measure-line-main" />
          <line :x1="measureSvgA.x" :y1="measureSvgA.y" :x2="measureSvgB.x" :y2="measureSvgA.y" class="measure-line-comp" />
          <line :x1="measureSvgB.x" :y1="measureSvgA.y" :x2="measureSvgB.x" :y2="measureSvgB.y" class="measure-line-comp" />
          <text v-if="measureResult" :x="(measureSvgA.x + measureSvgB.x) / 2" :y="measureSvgA.y - 6" class="measure-text" text-anchor="middle">{{ measureResult.dxMm.toFixed(1) }} mm</text>
          <text v-if="measureResult" :x="measureSvgB.x + 6" :y="(measureSvgA.y + measureSvgB.y) / 2" class="measure-text" dominant-baseline="middle">{{ measureResult.dyMm.toFixed(1) }} mm</text>
          <circle :cx="measureSvgA.x" :cy="measureSvgA.y" r="3" class="measure-dot" />
          <circle :cx="measureSvgB.x" :cy="measureSvgB.y" r="3" class="measure-dot" />
        </template>
      </svg>
    </div>
    <div v-if="totalPages > 0" class="nav">
      <button class="btn-nav" :disabled="currentPage <= 1 || rendering" @click="prev">‹</button>
      <span class="page-count">{{ currentPage }} / {{ totalPages }}</span>
      <button class="btn-nav" :disabled="currentPage >= totalPages || rendering" @click="next">›</button>
      <span class="nav-sep" />
      <button class="btn-nav" :disabled="rendering" @click="zoomOut">−</button>
      <button class="btn-zoom-label" :disabled="rendering" @click="zoomReset">{{ Math.round(userZoom * 100) }}%</button>
      <button class="btn-nav" :disabled="rendering" @click="zoomIn">+</button>
      <span class="nav-sep" />
      <button class="btn-nav" :class="{ active: isMeasuring }" :title="isMeasuring ? 'Exit ruler (Esc)' : 'Measure distance'" @click="toggleMeasure">⊢</button>
    </div>
  </div>
</template>

<style scoped>
.viewer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 1rem;
}

.viewer-label {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  align-self: flex-start;
}

.viewer-subtitle {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  align-self: flex-start;
  margin-top: -0.5rem;
}

.canvas-wrap {
  position: relative;
  width: 100%;
  background: #e5e5e5;
  border-radius: 6px;
  overflow: hidden;
  cursor: grab;
  min-height: 200px;
}

.canvas-wrap.panning {
  cursor: grabbing;
}

.canvas-wrap canvas {
  display: block;
}

.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.7);
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

.nav {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.nav-sep {
  width: 1px;
  height: 1.2em;
  background: var(--color-border);
  margin: 0 0.25rem;
}

.page-count {
  font-size: 0.875rem;
  color: var(--color-text-muted);
  min-width: 5ch;
  text-align: center;
}

.btn-nav {
  padding: 0.25rem 0.6rem;
  border-radius: 6px;
  font-size: 1.1rem;
  line-height: 1;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  cursor: pointer;
  transition: background 0.15s;
}

.btn-nav:hover:not(:disabled) {
  background: var(--color-border);
}

.btn-nav:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-zoom-label {
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
  font-size: 0.8rem;
  min-width: 4ch;
  text-align: center;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background 0.15s;
}

.btn-zoom-label:hover:not(:disabled) {
  background: var(--color-border);
}

.btn-zoom-label:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-nav.active {
  background: var(--color-border);
  color: var(--color-text);
}

.measure-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  cursor: crosshair;
  z-index: 10;
}

.measure-line-main {
  stroke: #2563eb;
  stroke-width: 1.5;
  stroke-dasharray: 5 3;
}

.measure-line-comp {
  stroke: #2563eb;
  stroke-width: 1;
  opacity: 0.5;
}

.measure-dot {
  fill: #2563eb;
}

.measure-text {
  font-size: 11px;
  font-family: monospace;
  fill: #1d4ed8;
  paint-order: stroke;
  stroke: white;
  stroke-width: 3px;
  pointer-events: none;
}
</style>
