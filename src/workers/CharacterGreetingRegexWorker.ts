/// <reference lib="webworker" />

import {
  applyCharacterGreetingRegex,
  type CharacterGreetingRegexContext,
  type CharacterGreetingRegexRule,
} from '../utils/CharacterGreetingRegex'

interface CharacterGreetingRegexRequest {
  contents: string[]
  rules: CharacterGreetingRegexRule[]
  context?: CharacterGreetingRegexContext
}

self.addEventListener('message', (event: MessageEvent<CharacterGreetingRegexRequest>) => {
  self.postMessage(
    applyCharacterGreetingRegex(event.data.contents, event.data.rules, event.data.context),
  )
})
