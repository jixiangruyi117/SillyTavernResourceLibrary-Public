/// <reference lib="webworker" />
import { applyCharacterGreetingRegex } from '../utils/CharacterGreetingRegex'
import type { ChatRenderInput } from '../services/ChatReaderRendering'

self.addEventListener('message', (event: MessageEvent<ChatRenderInput[]>) => {
  self.postMessage(
    event.data.map((input) =>
      applyCharacterGreetingRegex([input.source], input.rules, input.context),
    ),
  )
})
