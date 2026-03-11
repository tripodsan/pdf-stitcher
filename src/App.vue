<script setup lang="ts">
import { ref, reactive } from 'vue'
import StitchSettings from './components/StitchSettings.vue'
import PdfViewer from './components/PdfViewer.vue'
import { stitchPdf } from './lib/stitcher'
import type { StitchSettings as StitchSettingsType } from './types'

const file = ref<File | null>(null)
const totalPages = ref(0)
const isDragging = ref(false)
const processing = ref(false)
const error = ref<string | null>(null)
const resultUrl = ref<string | null>(null)
const sourceBytes = ref<ArrayBuffer | null>(null)
const resultBytes = ref<ArrayBuffer | null>(null)

const settings = reactive<StitchSettingsType>({
  pageRange: null,
  columns: 2,
  overlapX: 5,
  overlapY: 5,
  blankSlots: [],
})

function onSourceLoaded(pages: number) {
  totalPages.value = pages
  settings.pageRange = [1, pages]
  settings.columns = Math.max(1, Math.round(Math.sqrt(pages)))
}

async function onFileSelected(f: File) {
  file.value = f
  resultUrl.value = null
  resultBytes.value = null
  error.value = null
  try {
    sourceBytes.value = await f.arrayBuffer()
  } catch {
    error.value = 'Could not read PDF. Make sure the file is a valid PDF.'
    file.value = null
    sourceBytes.value = null
  }
}

function onInputChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.[0]) onFileSelected(input.files[0])
}

function onDrop(e: DragEvent) {
  isDragging.value = false
  const f = e.dataTransfer?.files[0]
  if (f?.type === 'application/pdf') onFileSelected(f)
}

async function process() {
  if (!sourceBytes.value) return
  processing.value = true
  error.value = null
  if (resultUrl.value) {
    URL.revokeObjectURL(resultUrl.value)
    resultUrl.value = null
  }
  try {
    const result = await stitchPdf(sourceBytes.value, settings)
    const buf = result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) as ArrayBuffer
    resultBytes.value = buf
    const blob = new Blob([buf], { type: 'application/pdf' })
    resultUrl.value = URL.createObjectURL(blob)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'An unexpected error occurred.'
  } finally {
    processing.value = false
  }
}

function downloadResult() {
  if (!resultUrl.value || !file.value) return
  const a = document.createElement('a')
  a.href = resultUrl.value
  const base = file.value.name.replace(/\.pdf$/i, '')
  a.download = `${base}-stitched.pdf`
  a.click()
}

function clearFile() {
  file.value = null
  sourceBytes.value = null
  resultBytes.value = null
  resultUrl.value = null
  totalPages.value = 0
}
</script>

<template>
  <div class="app">
    <header>
      <h1>PDF Stitcher</h1>
      <p>Reassemble tiled PDF pages into a single large page.</p>
    </header>

    <main>
      <!-- Drop zone -->
      <div
        class="dropzone"
        :class="{ dragging: isDragging, 'has-file': file }"
        @dragenter.prevent="isDragging = true"
        @dragover.prevent="isDragging = true"
        @dragleave.prevent="isDragging = false"
        @drop.prevent="onDrop"
      >
        <template v-if="!file">
          <svg class="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m6.75 12-3-3m0 0-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
          </svg>
          <p>Drop a PDF here or <label class="browse-link">browse<input type="file" accept=".pdf" @change="onInputChange" /></label></p>
        </template>
        <template v-else>
          <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
          </svg>
          <div class="file-info">
            <span class="file-name">{{ file.name }}</span>
            <span class="file-meta">{{ totalPages }} pages</span>
          </div>
          <button class="btn-ghost" @click="clearFile">Change</button>
        </template>
      </div>

      <!-- Three-column: source viewer + settings + result viewer -->
      <div v-if="file" class="workspace" :class="{ 'has-result': resultBytes }">
        <PdfViewer
          class="source-viewer"
          :source="sourceBytes"
          label="Source"
          @loaded="onSourceLoaded"
        />

        <div class="controls">
          <StitchSettings v-model="settings" :total-pages="totalPages" />

          <div class="actions">
            <button class="btn-primary" :disabled="processing" @click="process">
              <span v-if="processing">Processing…</span>
              <span v-else>Stitch PDF</span>
            </button>
            <button v-if="resultUrl" class="btn-secondary" @click="downloadResult">
              Download result
            </button>
          </div>

          <p v-if="error" class="error">{{ error }}</p>
          <p v-if="resultUrl && !error" class="success">Done! Click "Download result" to save.</p>
        </div>

        <PdfViewer
          v-if="resultBytes"
          class="result-viewer"
          :source="resultBytes"
          :oversample="3"
          :preserve-view="true"
          label="Result"
        />
      </div>
    </main>
  </div>
</template>

<style>
:root {
  --color-bg: #f8f8f7;
  --color-surface: #ffffff;
  --color-border: #e2e2df;
  --color-text: #1a1a18;
  --color-text-muted: #6b6b67;
  --color-accent: #2563eb;
  --color-accent-hover: #1d4ed8;
  --color-input-bg: #fafaf9;
  --color-error: #dc2626;
  --color-success: #16a34a;
}

*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 16px;
  line-height: 1.5;
}
</style>

<style scoped>
.app {
  max-width: 1600px;
  margin: 0 auto;
  padding: 2rem 1rem 4rem;
}

header {
  margin-bottom: 2rem;
}

h1 {
  margin: 0 0 0.25rem;
  font-size: 1.5rem;
  font-weight: 700;
}

header p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.9rem;
}

.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 2.5rem 1.5rem;
  border: 2px dashed var(--color-border);
  border-radius: 12px;
  background: var(--color-surface);
  text-align: center;
  transition: border-color 0.15s, background 0.15s;
  cursor: default;
}

.dropzone.dragging {
  border-color: var(--color-accent);
  background: #eff6ff;
}

.dropzone.has-file {
  flex-direction: row;
  padding: 1.25rem 1.5rem;
  border-style: solid;
  border-color: var(--color-border);
}

.upload-icon, .file-icon {
  width: 2.5rem;
  height: 2.5rem;
  color: var(--color-text-muted);
}

.dropzone p {
  margin: 0;
  font-size: 0.9rem;
  color: var(--color-text-muted);
}

.browse-link {
  color: var(--color-accent);
  cursor: pointer;
  text-decoration: underline;
}

.browse-link input[type="file"] {
  display: none;
}

.file-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  flex: 1;
  min-width: 0;
  margin-left: 0.75rem;
}

.file-name {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.file-meta {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.workspace {
  margin-top: 1.5rem;
  display: grid;
  grid-template-columns: 400px 1fr;
  gap: 1.5rem;
  align-items: start;
}

.workspace.has-result {
  grid-template-columns: 400px 1fr 750px;
}

@media (max-width: 700px) {
  .workspace,
  .workspace.has-result {
    grid-template-columns: 1fr;
  }
}

.controls {
  padding: 1.5rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.result-viewer { }

.actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

button {
  padding: 0.55rem 1.25rem;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: background 0.15s;
}

.btn-primary {
  background: var(--color-accent);
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--color-bg);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.btn-secondary:hover {
  background: var(--color-border);
}

.btn-ghost {
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  margin-left: auto;
}

.btn-ghost:hover {
  background: var(--color-bg);
}

.error {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-error);
}

.success {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-success);
}
</style>
