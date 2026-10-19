import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import solarHandler from './api/solar.ts'
import weatherHandler from './api/weather.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  Object.assign(process.env, env)

  const wrapHandler = (fn: (req: any, res: any) => Promise<any>) => {
    return (req: any, res: any) => {
      res.status = (statusCode: number) => {
        res.statusCode = statusCode
        return res
      }
      res.json = (data: any) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(data))
        return res
      }

      let body = ''
      req.on('data', (chunk: any) => {
        body += chunk
      })
      req.on('end', async () => {
        try {
          req.body = body ? JSON.parse(body) : {}
        } catch {
          req.body = body
        }
        try {
          await fn(req, res)
        } catch (err) {
          console.error('API handler error:', err)
          res.status(500).json({ error: 'Internal Server Error' })
        }
      })
    }
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'vercel-api-dev-middleware',
        configureServer(server) {
          server.middlewares.use('/api/solar', wrapHandler(solarHandler))
          server.middlewares.use('/api/weather', wrapHandler(weatherHandler))
        },
      },
    ],
    css: {
      postcss: {
        plugins: [],
      },
    },
  }
})
