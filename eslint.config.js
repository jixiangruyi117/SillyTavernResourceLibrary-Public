import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      // Task-local builds and browser fixtures are generated verification artifacts.
      '.codex-tmp',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
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
