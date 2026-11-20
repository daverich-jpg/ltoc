import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Mounts the AI proxy on dev + preview servers. Static hosting has no server, so the client falls back to demo mode. */
function aiApi(): Plugin {
  const mount = async (use: (path: string, fn: (req: any, res: any) => void) => void) => {
    const { handleAI } = await import('./server/ai')
    use('/api/ai/message', (req, res) => void handleAI(req, res, 'message'))
    use('/api/ai/read', (req, res) => void handleAI(req, res, 'read'))
  }
  return {
    name: 'ltoc-ai-api',
    configureServer: server => mount((p, fn) => server.middlewares.use(p, fn)),
    configurePreviewServer: server => mount((p, fn) => server.middlewares.use(p, fn)),
  }
}

export default defineConfig(({ mode }) => {
  // Server-only secret from .env.local; never exposed to the client bundle.
  const env = loadEnv(mode, process.cwd(), '')
  if (env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY
  return { plugins: [react(), aiApi()], base: './', server: { port: 5400, strictPort: true } }
})
