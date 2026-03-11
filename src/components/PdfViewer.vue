<script setup lang="ts">
import { ref, watch, onUnmounted, nextTick } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'

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
}>()

const emit = defineEmits<{
  loaded: [totalPages: number]
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

let panOrigin = { x: 0, y: 0, px: 0, py: 0 }
let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null
let renderTask: pdfjsLib.RenderTask | null = null

async function loadDocument(bytes: ArrayBuffer) {
  if (pdfDoc) {
    await pdfDoc.destroy()
    pdfDoc = null
  }
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
  await renderPage(1)
}

async function renderPage(pageNum: number) {
  if (!pdfDoc || !canvas.value) return
  await nextTick()  // ensure DOM is laid out before measuring container width
  if (renderTask) {
    renderTask.cancel()
    renderTask = null
  }
  rendering.value = true
  try {
    const page = await pdfDoc.getPage(pageNum)
    const containerWidth = canvas.value.parentElement!.clientWidth || 600
    const naturalVp = page.getViewport({ scale: 1 })
    const fitScale = containerWidth / naturalVp.width
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
    renderTask = page.render({ canvasContext: ctx, viewport: renderViewport, canvas: c })
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
  await renderPage(currentPage.value)
}

async function next() {
  if (currentPage.value >= totalPages.value) return
  currentPage.value++
  panX.value = 0
  panY.value = 0
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
    </div>
    <div v-if="totalPages > 0" class="nav">
      <button class="btn-nav" :disabled="currentPage <= 1 || rendering" @click="prev">‹</button>
      <span class="page-count">{{ currentPage }} / {{ totalPages }}</span>
      <button class="btn-nav" :disabled="currentPage >= totalPages || rendering" @click="next">›</button>
      <span class="nav-sep" />
      <button class="btn-nav" :disabled="rendering" @click="zoomOut">−</button>
      <button class="btn-zoom-label" :disabled="rendering" @click="zoomReset">{{ Math.round(userZoom * 100) }}%</button>
      <button class="btn-nav" :disabled="rendering" @click="zoomIn">+</button>
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
</style>
