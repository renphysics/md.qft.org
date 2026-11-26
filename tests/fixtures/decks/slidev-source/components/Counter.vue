<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ start?: number }>()
const count = ref(props.start ?? 0)
</script>

<template>
  <button type="button" @click="count++">Nodes: {{ count }}</button>
</template>
