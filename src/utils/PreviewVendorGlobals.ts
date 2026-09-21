import YAML from 'yaml'
import * as z from 'zod'

Object.defineProperties(globalThis, {
  YAML: { configurable: true, value: YAML },
  z: { configurable: true, value: z },
})
