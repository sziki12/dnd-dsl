import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
        // In v25, we map the sub-calls back to the main package entry
        'vscode-languageclient/browser': 'vscode-languageclient/lib/browser/main.js',
        'vscode/localExtensionHost': '@codingame/monaco-vscode-api',
        'vscode': '@codingame/monaco-vscode-api'
    },
    // This helps Vite find the right entry point in the package.json of dependencies
    mainFields: ['module', 'main']
  },
  // Force Vite to leave these alone during the "pre-bundle" phase
  optimizeDeps: {
      // These are the correct property names inside optimizeDeps
      exclude: [
          //'@codingame/monaco-vscode-api',
          //'@codingame/monaco-vscode-configuration-service-override',
          //'@codingame/monaco-vscode-keybindings-service-override',
          //'@codingame/monaco-vscode-textmate-service-override',
          //'@codingame/monaco-vscode-theme-service-override',
          //'monaco-languageclient',
          //'vscode-languageclient',
          //'vscode-languageserver-protocol',
      ],
      include: [
        'vscode-languageserver-types'
      ]
    },
    // This is the key: Force the browser to treat these as ESM
  build: {
      commonjsOptions: {
          transformMixedEsModules: true
      }
  },
  server: {
    port: 5173
  },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
})
