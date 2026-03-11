<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href

const props = defineProps<{
  source: ArrayBuffer | null
  label: string
}>()

const emit = defineEmits<{
  loaded: [totalPages: number]
}>()

const canvas = ref<HTMLCanvasElement | null>(null)
const currentPage = ref(1)
const totalPages = ref(0)
const rendering = ref(false)

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
  emit('loaded', pdfDoc.numPages)
  await renderPage(1)
}

async function renderPage(pageNum: number) {
  if (!pdfDoc || !canvas.value) return
  if (renderTask) {
    renderTask.cancel()
    renderTask = null
  }
  rendering.value = true
  try {
    const page = await pdfDoc.getPage(pageNum)
    const viewport = page.getViewport({ scale: 1.5 })
    const c = canvas.value
    c.width = viewport.width
    c.height = viewport.height
    const ctx = c.getContext('2d')!
    renderTask = page.render({ canvasContext: ctx, viewport, canvas: c })
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
  await renderPage(currentPage.value)
}

async function next() {
  if (currentPage.value >= totalPages.value) return
  currentPage.value++
  await renderPage(currentPage.value)
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
)

onUnmounted(async () => {
  if (renderTask) renderTask.cancel()
  if (pdfDoc) await pdfDoc.destroy()
})
</script>

<template>
  <div class="viewer">
    <div class="viewer-label">{{ label }}</div>
    <div class="canvas-wrap">
      <canvas ref="canvas" />
      <div v-if="rendering" class="overlay">Rendering…</div>
    </div>
    <div v-if="totalPages > 0" class="nav">
      <button class="btn-nav" :disabled="currentPage <= 1 || rendering" @click="prev">‹</button>
      <span class="page-count">{{ currentPage }} / {{ totalPages }}</span>
      <button class="btn-nav" :disabled="currentPage >= totalPages || rendering" @click="next">›</button>
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

.canvas-wrap {
  position: relative;
  width: 100%;
  background: #e5e5e5;
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}

.canvas-wrap canvas {
  max-width: 100%;
  height: auto;
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
  gap: 0.75rem;
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
</style>
