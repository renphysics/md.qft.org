<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { onSlideLeave } from '@slidev/client'

const phase = ref(0)
const playing = ref(false)
let animation: number | undefined
let previous = 0
const radians = computed(() => Number(phase.value) * Math.PI / 180)
const intensity = computed(() => (1 + Math.cos(radians.value)) / 2)
const path = (offset: number, combine = false) => Array.from({ length: 241 }, (_, i) => {
  const x = i / 240 * 720
  const angle = i / 240 * 6 * Math.PI
  const value = combine ? (Math.sin(angle) + Math.sin(angle + offset)) / 2 : Math.sin(angle + offset)
  return `${i ? 'L' : 'M'}${(x + 24).toFixed(2)},${(100 - 64 * value).toFixed(2)}`
}).join(' ')
const first = computed(() => path(0))
const second = computed(() => path(radians.value))
const combined = computed(() => path(radians.value, true))
function frame(now: number) {
  if (!playing.value) return
  if (previous) phase.value = (Number(phase.value) + (now - previous) * .035) % 360
  previous = now
  animation = requestAnimationFrame(frame)
}
function pause() {
  playing.value = false
  previous = 0
  if (animation !== undefined) cancelAnimationFrame(animation)
}
function toggle() {
  if (playing.value) pause()
  else { playing.value = true; previous = 0; animation = requestAnimationFrame(frame) }
}
function setPhase(value: number) { pause(); phase.value = value }
onBeforeUnmount(pause)
onSlideLeave(pause)
</script>

<template>
  <div class="interference-demo" @keydown.stop @pointerdown.stop>
    <div class="demo-legend"><span><i class="legend-first" /> Wave 1</span><span><i class="legend-second" /> Wave 2</span><span><i class="legend-total" /> Their sum, normalized</span></div>
    <svg viewBox="0 0 768 205" role="img" :aria-label="`Two coherent waves with relative phase ${Math.round(Number(phase))} degrees`">
      <defs><pattern id="phase-grid" width="60" height="32" patternUnits="userSpaceOnUse"><path d="M 60 0 L 0 0 0 32" fill="none" stroke="#e8e2db" stroke-width="1" /></pattern></defs>
      <rect x="24" y="20" width="720" height="160" fill="url(#phase-grid)" />
      <path d="M24 100 H744" stroke="#c7c4bf" stroke-width="1" />
      <path :d="first" fill="none" stroke="#a2b4bd" stroke-width="2" stroke-dasharray="6 5" />
      <path :d="second" fill="none" stroke="#d6a386" stroke-width="2" stroke-dasharray="6 5" />
      <path :d="combined" fill="none" stroke="#854252" stroke-width="3.5" />
    </svg>
    <div class="phase-controls">
      <label class="phase-slider"><span>Relative phase <strong>{{ Math.round(Number(phase)) }}°</strong></span><input v-model="phase" type="range" min="0" max="360" step="1" aria-label="Relative phase in degrees" @input="pause" /></label>
      <div class="intensity-value"><span>Normalized intensity</span><strong>{{ intensity.toFixed(2) }}</strong><div class="intensity-track"><i :style="{ width: `${intensity * 100}%` }" /></div></div>
    </div>
    <div class="phase-actions"><button type="button" @click="setPhase(0)">In phase · 0°</button><button type="button" @click="setPhase(180)">Opposite · 180°</button><button type="button" class="play-button" :aria-pressed="playing" @click="toggle">{{ playing ? 'Pause animation' : 'Animate phase' }}</button></div>
  </div>
</template>

<style scoped>
.interference-demo { margin-top: -10px; padding: 18px 24px; border: 1px solid #e4ddd5; border-radius: 16px; background: #fffefa; }
.demo-legend { display: flex; gap: 22px; font-size: 12px; color: #69737b; }
.demo-legend span { display: inline-flex; align-items: center; gap: 7px; }
.demo-legend i { display: inline-block; width: 18px; height: 3px; border-radius: 2px; }
.legend-first { background: #a2b4bd; }.legend-second { background: #d6a386; }.legend-total { background: #854252; }
svg { display: block; width: 100%; height: 187px; }
.phase-controls { display: grid; grid-template-columns: 1fr 185px; gap: 40px; align-items: center; }
.phase-slider > span { display: flex; justify-content: space-between; font-size: 15px; color: #58636b; }
.phase-slider strong { color: #854252; font-variant-numeric: tabular-nums; }
input[type=range] { width: 100%; margin-top: 15px; accent-color: #854252; cursor: pointer; }
.intensity-value > span { display: block; font-size: 11px; color: #727a80; }
.intensity-value > strong { display: block; font-size: 26px; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.3; color: #854252; }
.intensity-track { height: 5px; background: #eee4e5; border-radius: 5px; margin-top: 3px; overflow: hidden; }
.intensity-track i { display: block; height: 5px; background: #854252; }
.phase-actions { display: flex; gap: 10px; margin-top: 18px; }
button { border: 1px solid #d9d3cb; border-radius: 7px; background: transparent; color: #58636b; font: inherit; font-size: 12px; padding: 7px 11px; cursor: pointer; }
button:hover { background: #f5f0e9; } button:focus-visible { outline: 2px solid #854252; outline-offset: 3px; }
.play-button { margin-left: auto; background: #854252; color: white; border-color: #854252; }
.play-button:hover { background: #713847; }
</style>
