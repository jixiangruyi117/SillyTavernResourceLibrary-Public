<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { externalAppService } from '../core/AppContainer'
import { CHAT_READER_APP_ID } from '../core/ChatReaderIdentity'
import ExternalAppHost from './ExternalAppHost.vue'
import FeatureStateView from './FeatureStateView.vue'
import manifest from '../../extensions/duleme/manifest.json'
import document from '../../extensions/duleme/index.html?raw'
import script from '../../extensions/duleme/app.js?raw'
import styles from '../../extensions/duleme/reader.css?raw'
import icon from '../../extensions/duleme/icon.svg?raw'

const emit = defineEmits<{ back: [] }>()
const ready = ref(false)
const error = ref('')
onMounted(async () => {
  try {
    // Only build-shipped bytes enter this path. Reuse the runtime and original data;
    // never promote a restored/user-supplied package merely because its ID matches.
    const files = Object.entries({
      'manifest.json': JSON.stringify(manifest),
      'index.html': document,
      'app.js': script,
      'reader.css': styles,
      'icon.svg': icon,
    }).map(([name, text]) => new File([text], name))
    const preview = await externalAppService.inspect(files)
    const previous = await externalAppService.get(CHAT_READER_APP_ID)
    if (
      !previous?.enabled ||
      previous.packageFingerprint !== preview.packageFingerprint ||
      previous.runtimeMode !== 'trustedCompatible'
    )
      await externalAppService.install(preview, 'trustedCompatible')
    if (!previous?.enabled) await externalAppService.setEnabled(CHAT_READER_APP_ID, true)
    ready.value = true
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '读了么启动失败'
  }
})
</script>

<template>
  <ExternalAppHost v-if="ready" :app-id="CHAT_READER_APP_ID" official @back="emit('back')" />
  <FeatureStateView v-else :state="error ? 'error' : 'loading'" :title="error || '正在打开读了么…'">
    <template #actions
      ><button v-if="error" class="button" @click="emit('back')">返回</button></template
    >
  </FeatureStateView>
</template>
