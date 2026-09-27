import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Routes:
 *   /          -> the static landing page (public/landing/, plain HTML/CSS/JS)
 *   /app       -> the React app (any other path also falls back to it)
 * /api/* is proxied to the FastAPI backend, so no CORS setup is needed in dev.
 */
function landingRoutes() {
  const handler = (req, res, next) => {
    const [path, query = ''] = (req.url || '/').split('?')
    const qs = query ? `?${query}` : ''
    if (path === '/' || path === '/landing') {
      res.statusCode = 302
      res.setHeader('Location', `/landing/${qs}`)
      return res.end()
    }
    if (path === '/landing/') req.url = `/landing/index.html${qs}`
    next()
  }
  return {
    name: 'hakdaar-landing-routes',
    configureServer(server) { server.middlewares.use(handler) },
    configurePreviewServer(server) { server.middlewares.use(handler) },
  }
}

export default defineConfig({
  plugins: [landingRoutes(), react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL || 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
})
