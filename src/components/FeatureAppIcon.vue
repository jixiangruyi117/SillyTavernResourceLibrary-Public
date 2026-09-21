<script setup lang="ts">
defineProps<{ name: string }>()
</script>

<template>
  <svg
    v-if="name === 'draw'"
    class="feature-app__svg"
    viewBox="0 0 48 48"
    fill="none"
    aria-hidden="true"
  >
    <rect x="12" y="10" width="22" height="28" rx="3" transform="rotate(-10 12 10)" />
    <rect x="17" y="9" width="22" height="28" rx="3" transform="rotate(8 17 9)" />
    <path
      d="m29 17 1.4 3.6L34 22l-3.6 1.4L29 27l-1.4-3.6L24 22l3.6-1.4L29 17Z"
      fill="currentColor"
      stroke="none"
    />
  </svg>
  <svg
    v-else-if="name === 'appearance'"
    class="feature-app__svg"
    viewBox="0 0 48 48"
    fill="none"
    aria-hidden="true"
  >
    <path d="M11 14h26M11 24h26M11 34h26" />
    <circle cx="19" cy="14" r="4" fill="currentColor" />
    <circle cx="31" cy="24" r="4" fill="currentColor" />
    <circle cx="24" cy="34" r="4" fill="currentColor" />
  </svg>
  <svg
    v-else-if="name === 'folders'"
    class="feature-app__svg"
    viewBox="0 0 48 48"
    fill="none"
    aria-hidden="true"
  >
    <path d="M8 17h32v21H8zM11 13h12l3 4H8v-2a2 2 0 0 1 3-2Z" />
    <path d="M8 25h32M27 31h7" />
  </svg>
  <svg
    v-else-if="name === 'cloud'"
    class="feature-app__svg"
    viewBox="0 0 48 48"
    fill="none"
    aria-hidden="true"
  >
    <path d="M15 35h20a7 7 0 0 0 .7-14A11 11 0 0 0 15 19a8 8 0 0 0 0 16Z" />
    <path d="M24 14v16m0-16-5 5m5-5 5 5" />
  </svg>
  <svg
    v-else-if="name === 'bridge'"
    class="feature-app__svg"
    viewBox="0 0 48 48"
    fill="none"
    aria-hidden="true"
  >
    <path d="M8 17h21m0 0-5-5m5 5-5 5M40 31H19m0 0 5-5m-5 5 5 5" />
    <rect x="8" y="27" width="8" height="8" rx="2" />
    <rect x="32" y="13" width="8" height="8" rx="2" />
  </svg>
  <svg
    v-else-if="name === 'stitch'"
    class="feature-app__svg"
    viewBox="0 0 48 48"
    fill="none"
    aria-hidden="true"
  >
    <path d="m12 35 21-21 5 5-21 21-6 1 1-6Z" />
    <path d="M10 16c5-5 13-5 18 0" stroke-dasharray="3 3" />
    <path d="m31 16 3 3" />
  </svg>
  <svg
    v-else-if="name === 'frontend'"
    class="feature-app__svg"
    viewBox="0 0 48 48"
    fill="none"
    aria-hidden="true"
  >
    <rect x="8" y="11" width="32" height="26" rx="3" />
    <path d="M8 18h32M17 25l-5 4 5 4m14-8 5 4-5 4m-5-10-4 12" />
  </svg>
  <svg
    v-else-if="name === 'imageGeneration'"
    class="feature-app__svg"
    viewBox="0 0 48 48"
    fill="none"
    aria-hidden="true"
  >
    <rect x="8" y="10" width="32" height="28" rx="4" />
    <path d="m12 32 8-8 6 6 4-4 6 6" />
    <path
      d="m34 11 1.5 3.5L39 16l-3.5 1.5L34 21l-1.5-3.5L29 16l3.5-1.5L34 11Z"
      fill="currentColor"
      stroke="none"
    />
  </svg>
  <svg
    v-else-if="name === 'imageAlbum'"
    class="feature-app__svg"
    viewBox="0 0 48 48"
    fill="none"
    aria-hidden="true"
  >
    <rect x="8" y="10" width="32" height="28" rx="4" />
    <circle cx="31" cy="18" r="3" fill="currentColor" stroke="none" />
    <path d="m12 33 8-9 6 6 4-4 6 7M17 39h20" />
  </svg>
  <svg
    v-else-if="name === 'persona'"
    class="feature-app__svg"
    viewBox="0 0 48 48"
    fill="none"
    aria-hidden="true"
  >
    <circle cx="19" cy="18" r="6" />
    <path d="M8 38c1.5-8 6-12 11-12s9.5 4 11 12M31 15h9m-9 8h9m-9 8h6" />
  </svg>
  <svg
    v-else-if="name === 'bundle'"
    class="feature-app__svg"
    viewBox="0 0 48 48"
    fill="none"
    aria-hidden="true"
  >
    <rect x="18" y="17" width="12" height="14" rx="2" />
    <rect x="7" y="10" width="10" height="11" rx="2" />
    <rect x="31" y="27" width="10" height="11" rx="2" />
    <path d="m17 17 3-2m10 16 3-2M17 27l3 2m10-10 3 2" />
  </svg>
  <svg
    v-else-if="name === 'extensions'"
    class="feature-app__svg"
    viewBox="0 0 48 48"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M20 9h8v8a4 4 0 1 1-8 0V9ZM12 20h8a4 4 0 1 0 0-8h-8v8ZM28 28h8v8a4 4 0 1 1-8 0v-8ZM20 28v8h-8a4 4 0 1 0 0 8h8v-8Z"
    />
    <path d="M20 20h8v8h-8z" fill="currentColor" />
  </svg>
</template>
