import "dotenv/config"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import { readFileSync } from "fs"
import { resolve } from "path"
import react from "@vitejs/plugin-react"
import { sentryVitePlugin } from "@sentry/vite-plugin"
import tailwindcss from "tailwindcss"
import autoprefixer from "autoprefixer"

const isDev = process.env.NODE_ENV !== "production"
const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8"))

// Sentry DSNs are public identifiers — safe to embed in shipped binaries.
// One project, two entry points (main = Node, renderer = browser).
const SENTRY_DSN = "https://14d00a05791c7d015f24c50232a0336a@o4511333711282176.ingest.de.sentry.io/4511333717639248"
const sentryRelease = `churro-coder@${pkg.version}`
const sentryPlugin = sentryVitePlugin({
  org: "atamayoiberantes",
  project: "churro-coder",
  url: "https://de.sentry.io/",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  release: { name: sentryRelease },
  disable: !process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: { filesToDeleteAfterUpload: ["**/*.map"] },
})

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        // Don't externalize these - bundle them instead
        exclude: ["superjson", "trpc-electron", "gray-matter", "async-mutex"],
      }),
      sentryPlugin,
    ],
    define: {
      "process.env.MAIN_VITE_SENTRY_DSN": JSON.stringify(SENTRY_DSN),
      "process.env.MAIN_VITE_APP_VERSION": JSON.stringify(pkg.version),
    },
    build: {
      sourcemap: true,
      lib: {
        entry: resolve(__dirname, "src/main/index.ts"),
      },
      rollupOptions: {
        external: [
          "electron",
          "better-sqlite3",
          "@prisma/client",
          "@anthropic-ai/claude-agent-sdk", // ESM module - must use dynamic import
        ],
        output: {
          format: "cjs",
        },
      },
    },
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ["trpc-electron"],
      }),
    ],
    build: {
      sourcemap: true,
      lib: {
        entry: resolve(__dirname, "src/preload/index.ts"),
      },
      rollupOptions: {
        external: ["electron"],
        output: {
          format: "cjs",
        },
      },
    },
  },
  renderer: {
    plugins: [
      react({
        // In dev mode, use WDYR as JSX import source to track ALL component re-renders
        jsxImportSource: isDev
          ? "@welldone-software/why-did-you-render"
          : undefined,
      }),
      sentryPlugin,
    ],
    define: {
      "import.meta.env.VITE_SENTRY_DSN": JSON.stringify(SENTRY_DSN),
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/renderer"),
      },
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/renderer/index.html"),
          login: resolve(__dirname, "src/renderer/login.html"),
        },
      },
    },
    css: {
      postcss: {
        plugins: [tailwindcss, autoprefixer],
      },
    },
  },
})
