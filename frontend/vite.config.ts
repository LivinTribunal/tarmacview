/// <reference types="vitest" />
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import fs from 'fs'
import {
  TILE_HOST_PATTERN,
  TILE_CACHE_NAME,
  TILE_CACHE_MAX_ENTRIES,
  TILE_CACHE_MAX_AGE_SECONDS,
} from './src/sw/tileCacheConfig'

export default defineConfig({
  plugins: [
    react(),
    cesium(),
    // tile-cache service worker - SW sits at the network layer, off in dev.
    // map components are untouched; external tile GETs are cached on disk.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // we call registerSW() manually in main.tsx
      manifest: false, // tile cache only - no installability, no icons
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // keep precache off the multi-MB cesium asset dir and the .glb models;
        // the app shell (index bundle ~3.3 MB) is precached so 2D works offline
        globIgnores: ['**/cesium/**', '**/models/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: TILE_HOST_PATTERN,
            handler: 'CacheFirst',
            options: {
              cacheName: TILE_CACHE_NAME,
              cacheableResponse: { statuses: [200] }, // exclude 0 (opaque) -> guards quota inflation
              expiration: {
                maxEntries: TILE_CACHE_MAX_ENTRIES,
                maxAgeSeconds: TILE_CACHE_MAX_AGE_SECONDS,
                purgeOnQuotaError: true,
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    include: ['resium', 'cesium'],
    esbuildOptions: {
      plugins: [
        {
          // resium v1.18+ bundles a React 19 jsx-dev-runtime inside its
          // ESM output (built with rolldown). this bundled runtime calls
          // require("react") (which vite can't resolve) and accesses
          // React 19 internals (__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_
          // USERS_THEY_CANNOT_UPGRADE) which don't exist in React 18.
          //
          // fix: replace the bundled jsx runtime (var Z) with a proper
          // import from the app's react/jsx-dev-runtime, and neutralize
          // the require("react") call that fed the bundled runtime.
          //
          // WARNING: this patch matches resium's internal minified variable
          // names (Z, V, ke, Ae, be). these are an implementation detail -
          // any resium update can silently rename them. before updating
          // resium from 1.20.0, re-run the build and verify these
          // replacements still apply. resium is pinned to exact version
          // in package.json to prevent accidental breakage.
          name: 'fix-resium-jsx-runtime',
          setup(build) {
            build.onLoad({ filter: /resium[\\/]dist[\\/]resium\.js$/ }, async (args) => {
              let code = await fs.promises.readFile(args.path, 'utf8')

              // inject proper jsx runtime import at the top
              code = `import * as __resium_jsx__ from "react/jsx-runtime";\n` + code

              // replace the bundled jsx runtime (Z) with the imported one.
              // Z is defined as: `Z = (/* @__PURE__ */ V(((e, t) => {`
              //   `process.env.NODE_ENV === "production" ? t.exports = ke() : t.exports = Ae();`
              // `})))()`
              // replace that whole expression with the proper import
              code = code.replace(
                /Z = \(\/\* @__PURE__ \*\/ V\(\(\(e, t\) => \{\s*process\.env\.NODE_ENV === "production" \? t\.exports = ke\(\) : t\.exports = Ae\(\);\s*\}\)\)\)\(\)/,
                'Z = __resium_jsx__',
              )

              // neutralize be("react") so the dead bundled runtime
              // doesn't crash if somehow evaluated
              code = code.replace(/be\("react"\)/g, '{}')

              return { contents: code, loader: 'js' }
            })
          },
        },
      ],
    },
  },
  build: {
    target: ['es2020', 'chrome90', 'firefox90', 'safari14', 'edge90'],
  },
  server: {
    proxy: {
      '/api': process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8000',
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    // playwright specs live in e2e/ and run via `npm run test:e2e`, not vitest
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
