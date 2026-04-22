import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import babel from '@rolldown/plugin-babel';
import path from 'path';

export default defineConfig({
  worker: {
    format: 'es',
  },

  resolve: {
    alias: [
      // Must come before the bare `vscode` alias — more specific match first
      {
        find: /^vscode$/,
        replacement: '@codingame/monaco-vscode-extension-api',
      },
      {
        find: /^vscode\/localExtensionHost$/,
        replacement: '@codingame/monaco-vscode-extension-api',
      },
      // Force vscode-languageclient/browser to the specific CJS impl file
      // so the alias target and the include entry resolve identically
      {
        find: /^vscode-languageclient\/browser(\.js)?$/,
        replacement: path.resolve(__dirname, 'node_modules/vscode-languageclient/lib/browser/main.js'),
      },
      { 
        find: /^vscode-languageserver-protocol\/browser(\.js)?$/, 
        replacement: path.resolve(__dirname, 'node_modules/vscode-languageserver-protocol/lib/browser/main.js') 
      },
    ],
    // Only dedupe monaco-editor to prevent duplicate instances from nested deps.
    // Do NOT dedupe vscode-languageclient — it conflicts with pre-bundling.
    dedupe: ['monaco-editor', 'vscode-jsonrpc', '@codingame/monaco-vscode-api', '@codingame/monaco-vscode-extension-api', '@codingame/monaco-vscode-extensions-service-override'],
  },

  optimizeDeps: {
    exclude: [
      'monaco-editor',
      '@codingame/monaco-vscode-api',
      '@codingame/monaco-vscode-configuration-service-override',
      '@codingame/monaco-vscode-keybindings-service-override',
      '@codingame/monaco-vscode-textmate-service-override',
      '@codingame/monaco-vscode-theme-service-override',
      'monaco-languageclient',
      '@codingame/monaco-vscode-api/localExtensionHost',
      '@codingame/monaco-vscode-extension-api',
      '@codingame/monaco-vscode-extensions-service-override',
    ],
    include: [
      'vscode-languageclient/browser.js',
      'vscode-languageserver-protocol/browser.js',
      'vscode-jsonrpc/browser',
      'vscode-ws-jsonrpc',
      'vscode-languageserver-types',
      'vscode-languageserver-protocol',
    ],
    esbuildOptions: {
      // Tell esbuild to leave Node-only imports as empty stubs
      // so vscode-ws-jsonrpc can be pre-bundled for the browser
      plugins: [
        {
          name: 'stub-node-builtins',
          setup(build: any) {
            build.onResolve({ filter: /^(net|tls|ws)$/ }, (args: { path: any; }) => ({
              path: args.path,
              namespace: 'node-stub',
            }));
            build.onLoad({ filter: /.*/, namespace: 'node-stub' }, () => ({
              contents: 'export default {}; export const WebSocket = undefined;',
              loader: 'js',
            }));
          },
        },
      ],
    },
    // holdUntilCrawlEnd removed — it waits for a crawl that never ends
    //  because the excluded @codingame packages have unresolvable dynamic imports
  },

  build: {
    target: 'esnext',
    // No `rollupOptions.external: ['vscode']` here — vscode is aliased to
    // @codingame/monaco-vscode-api and must be bundled, not left external.
    commonjsOptions: {
      // Ensure any remaining CJS in the LSP chain gets transformed for the build.
      include: [/vscode-languageclient/, /vscode-jsonrpc/, /node_modules/],
      transformMixedEsModules: true,
    },
  },

  server: {
    watch: {
      usePolling: true,
    },
    fs: {
      allow: ['..'],
    },
    // The redirect middleware is removed entirely — it was compensating for
    // the exclude/include conflict, which is now fixed at the source.
  },

  plugins: [
    react(),
    tailwindcss(),
    babel({ presets: [reactCompilerPreset()] }),
    // Stub vscode/localExtensionHost — this subpath no longer exists in
    // @codingame/monaco-vscode-api 25.x but monaco-languageclient still imports it
    {
      name: 'stub-vscode-local-extension-host',
      resolveId(id) {
        if (id === 'vscode/localExtensionHost') return '\0vscode-local-extension-host-stub';
      },
      load(id) {
        if (id === '\0vscode-local-extension-host-stub') return 'export default {};';
      },
    },
    {
      name: 'dedupe-codingame',
      config() {
        return {
          resolve: {
            dedupe: ([] as string[]).concat(
              // Collect all @codingame package names automatically
              Object.keys(
                JSON.parse(
                  require('fs').readFileSync('./node_modules/@codingame/../.package-lock.json', 'utf-8')
                ).packages ?? {}
              )
              .filter((k: string) => k.startsWith('node_modules/@codingame/'))
              .map((k: string) => k.replace('node_modules/', ''))
            ),
          },
        };
      },
    },
  ],
});