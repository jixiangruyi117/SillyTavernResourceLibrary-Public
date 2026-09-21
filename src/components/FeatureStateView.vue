<script setup lang="ts">
withDefaults(
  defineProps<{
    state: 'loading' | 'error' | 'offline' | 'permission' | 'empty'
    title: string
    description?: string
  }>(),
  { description: undefined },
)
</script>

<template>
  <section class="feature-state-view" :data-state="state" role="status">
    <span aria-hidden="true"></span>
    <h2>{{ title }}</h2>
    <p v-if="description">{{ description }}</p>
    <div v-if="$slots.actions" class="feature-state-view__actions"><slot name="actions" /></div>
  </section>
</template>

<style scoped>
.feature-state-view {
  display: grid;
  width: min(100%, 34rem);
  min-height: 12rem;
  margin: 2rem auto;
  padding: 1.25rem;
  place-items: center;
  align-content: center;
  border: 1px dashed var(--color-line-strong);
  border-radius: var(--glass-radius-panel);
  color: var(--color-ink-soft);
  text-align: center;
}

.feature-state-view > span {
  width: 2rem;
  height: 2rem;
  border: 2px solid var(--color-line-strong);
  border-top-color: var(--color-accent);
  border-radius: 50%;
}

.feature-state-view:not([data-state='loading']) > span {
  border-radius: 0.45rem;
  transform: rotate(45deg);
}

.feature-state-view h2,
.feature-state-view p {
  margin: 0.55rem 0 0;
}

.feature-state-view__actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.8rem;
}
</style>
