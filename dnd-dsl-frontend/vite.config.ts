import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import babel from '@rolldown/plugin-babel'
import path from 'path';
import fs from 'fs';

export default defineConfig({
  worker: {
    format: "es",
  },
  resolve: {
    // Exact mapping for the VSCode API to prevent duplicate loads
    alias: [
      {
        // This catches ANY import containing 'vscode-languageclient/browser' 
        // (even with .js or full paths) and forces it to the ESM entry point.
        find: /vscode-languageclient\/browser(\.js)?/,
        replacement: path.resolve(__dirname, 'node_modules/vscode-languageclient/lib/browser/main.js')
      },
      {
        find: /^vscode$/,
        replacement: '@codingame/monaco-vscode-api'
      },
      {
        find: /^vscode\/localExtensionHost$/,
        replacement: '@codingame/monaco-vscode-api'
      }
    ],
    dedupe: ["vscode", "monaco-editor", 'vscode-languageclient'],
  },
  optimizeDeps: {
    entries: [], 
    exclude: [
      '@codingame/monaco-vscode-api',
      'monaco-languageclient',
      'vscode-languageclient',
      'vscode' // Add this virtual one too
    ],

    // 3. INCLUSION: Pre-bundle the small stuff that these large libraries 
    // depend on so they don't cause a "waterfall" of network requests.
    include: [
      'vscode-languageclient/browser',
      'vscode-languageclient/lib/browser/main.js',
      'vscode-jsonrpc',
      'vscode-ws-jsonrpc',
      'vscode-jsonrpc/lib/browser/main.js',
      'vscode-languageserver-types',
      'vscode-languageserver-protocol'
    ],
    holdUntilCrawlEnd: true
  },
  build: {
    target: "esnext",
    rollupOptions: {
      external: ['vscode'],
    },
    commonjsOptions: {
      include: [/vscode-languageclient/, /node_modules/],
      transformMixedEsModules: true
    }
  },
  server: {
    watch: {
      usePolling: true
    },
    fs: {
    // Allow Vite to serve files from the entire node_modules tree properly
    allow: ['..']
  }
  },
  plugins: [
    react(),
    tailwindcss(),
    babel({ presets: [reactCompilerPreset()] }),
   {
    name: 'monaco-dependency-hijacker',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';

        // 1. Target the Language Client
        if (url.includes('vscode-languageclient/lib/browser/main.js')) {
          const pkgPath = path.resolve(__dirname, 'node_modules/.vite/deps/vscode-languageclient_browser.js');
          return serveOptimizedFile(res, pkgPath);
        }

        // 2. Target JSON-RPC - We'll try the most likely Vite-generated filenames
        if (url.includes('vscode-jsonrpc/lib/browser/main.js')) {
          const possiblePaths = [
            path.resolve(__dirname, 'node_modules/.vite/deps/vscode-jsonrpc.js'),
            path.resolve(__dirname, 'node_modules/.vite/deps/vscode-languageserver-protocol.js'), // Sometimes bundled together
            path.resolve(__dirname, 'node_modules/.vite/deps/vscode-jsonrpc_lib_browser_main_js.js')
          ];
          
          for (const p of possiblePaths) {
            if (fs.existsSync(p)) return serveOptimizedFile(res, p);
          }
        }

        next();
      });

      function serveOptimizedFile(res: any, filePath: string) {
        const content = fs.readFileSync(filePath, 'utf-8');
        res.setHeader('Content-Type', 'application/javascript');
        res.setHeader('X-Vite-Hijack', 'true'); 
        res.end(content);
        return;
      }
    }
  }
  ],
});