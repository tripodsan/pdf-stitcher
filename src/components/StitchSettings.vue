<script setup lang="ts">
import { computed } from 'vue'
import type { StitchSettings } from '../types'

const props = defineProps<{
  modelValue: StitchSettings
  totalPages: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: StitchSettings]
}>()

function update<K extends keyof StitchSettings>(key: K, value: StitchSettings[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

const rangeStart = computed(() => props.modelValue.pageRange?.[0] ?? 1)
const rangeEnd = computed(() => props.modelValue.pageRange?.[1] ?? props.totalPages)

function updateRange(which: 'start' | 'end', raw: string) {
  const val = parseInt(raw, 10)
  if (isNaN(val)) return
  const [s, e] = props.modelValue.pageRange ?? [1, props.totalPages]
  update('pageRange', which === 'start' ? [val, e] : [s, val])
}

const blankSlotsStr = computed(() => props.modelValue.blankSlots.join(', '))

function updateBlankSlots(raw: string) {
  const slots = raw
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => !isNaN(n) && n > 0)
  update('blankSlots', slots)
}
</script>

<template>
  <div class="settings">
    <h2>Settings</h2>

    <section>
      <h3>Grid</h3>
      <div class="row">
        <label>
          Columns
          <input
            type="number" min="1" max="20"
            :value="modelValue.columns"
            @input="update('columns', parseInt(($event.target as HTMLInputElement).value, 10) || 1)"
          />
        </label>
      </div>
    </section>

    <section>
      <h3>Page Box</h3>
      <select
        :value="modelValue.pageBox"
        @change="update('pageBox', ($event.target as HTMLSelectElement).value as import('../types').PageBox)"
      >
        <option value="trim">Trim</option>
        <option value="media">Media</option>
        <option value="crop">Crop</option>
        <option value="bleed">Bleed</option>
        <option value="art">Art</option>
      </select>
      <p class="hint">Which PDF box defines tile size. Use Trim for production PDFs with bleed.</p>
    </section>

    <section>
      <h3>Overlap</h3>
      <div class="row">
        <label>
          Horizontal (mm)
          <input
            type="number" min="0" step="0.5"
            :value="modelValue.overlapX"
            @input="update('overlapX', parseFloat(($event.target as HTMLInputElement).value) || 0)"
          />
        </label>
        <label>
          Vertical (mm)
          <input
            type="number" min="0" step="0.5"
            :value="modelValue.overlapY"
            @input="update('overlapY', parseFloat(($event.target as HTMLInputElement).value) || 0)"
          />
        </label>
      </div>
    </section>

    <section>
      <h3>Page Range</h3>
      <div class="row">
        <label>
          From
          <input
            type="number" min="1" :max="totalPages"
            :value="rangeStart"
            @input="updateRange('start', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label>
          To
          <input
            type="number" min="1" :max="totalPages"
            :value="rangeEnd"
            @input="updateRange('end', ($event.target as HTMLInputElement).value)"
          />
        </label>
      </div>
      <p class="hint">Total pages: {{ totalPages }}</p>
    </section>

    <section>
      <h3>Blank Tiles</h3>
      <label class="full">
        Insert blanks at positions (comma-separated)
        <input
          type="text"
          placeholder="e.g. 1, 4, 7"
          :value="blankSlotsStr"
          @input="updateBlankSlots(($event.target as HTMLInputElement).value)"
        />
      </label>
      <p class="hint">1-based positions in the final tile sequence where blank tiles are inserted.</p>
    </section>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}

h3 {
  margin: 0 0 0.75rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

section {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.875rem;
  color: var(--color-text);
}

label.full {
  grid-column: 1 / -1;
}

input, select {
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-input-bg);
  color: var(--color-text);
  font-size: 0.875rem;
  width: 100%;
  box-sizing: border-box;
}

input:focus, select:focus {
  outline: none;
  border-color: var(--color-accent);
}

.hint {
  margin: 0.25rem 0 0;
  font-size: 0.75rem;
  color: var(--color-text-muted);
}
</style>
