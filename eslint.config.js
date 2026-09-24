import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'server',
      'android',
      '.wrangler',
      // Task-local builds and browser fixtures are generated verification artifacts.
      '.codex-tmp',
      // S0 runtime probes are pasted into real TavernHelper iframes/scripts and intentionally
      // reference host-provided globals that do not exist in the SRL build environment.
      'docs/frontend-workshop/runtime/probes/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['cloudflare/BridgeParcels.js', 'src/services/BridgeParcelCodec.mjs'],
    languageOptions: {
      globals: {
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        Uint8Array: 'readonly',
        DataView: 'readonly',
        crypto: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        fetch: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        AbortController: 'readonly',
        DOMException: 'readonly',
      },
    },
  },
  {
    files: ['cloudflare/Worker.js', 'cloudflare/Worker[A-Z]*.js', 'cloudflare/BridgeSession.js'],
    languageOptions: {
      globals: {
        TextEncoder: 'readonly',
        Uint8Array: 'readonly',
        btoa: 'readonly',
        atob: 'readonly',
        crypto: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        URL: 'readonly',
        Headers: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
      },
    },
  },
  {
    files: ['cloudflare/*.test.js'],
    languageOptions: {
      globals: {
        Uint8Array: 'readonly',
        Request: 'readonly',
        structuredClone: 'readonly',
        crypto: 'readonly',
        TextEncoder: 'readonly',
      },
    },
  },
  {
    // Service Worker 环境：importScripts 引入的分享接收器
    files: ['public/sw-share-target.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        console: 'readonly',
      },
    },
  },
  {
    files: ['cloudflare/BootstrapAdmin.mjs', 'cloudflare/ExportVpsAuthToD1.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        URL: 'readonly',
        console: 'readonly',
      },
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    rules: {
      'no-undef': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      // 模板排版统一由 Prettier 负责，避免两套格式化规则互相冲突。
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
    },
  },
  {
    // 测试文件里定义多个内联桩组件是常态，不适用单文件单组件约束。
    files: ['**/*.test.ts'],
    rules: {
      'vue/one-component-per-file': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,vue}'],
    rules: {
      // 确认交互统一走 confirmAction()；原生 confirm 在移动端 PWA 不可样式化。
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'confirm',
          message: '请使用 composables/UseConfirmDialog 的 confirmAction()。',
        },
      ],
      'no-restricted-globals': ['error', { name: 'confirm', message: '请使用 confirmAction()。' }],
    },
  },
  {
    rules: {
      // 以下划线开头的变量表示「解构时刻意剔除」，不视为未使用。
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
)
