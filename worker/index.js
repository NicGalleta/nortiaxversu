import { withAuthenticatedUser } from './lib/supabase/action.js'
import { getCollections, getCustomer } from './routes/collections.js'
import { getAnalystContext, interpretAnalyst, runAnalyst, explainAnalyst } from './routes/analyst.js'
import { getForecast } from './routes/forecast.js'
import { getDashboard } from './routes/dashboard.js'
import { activateImport, getImports, uploadImport } from './routes/imports.js'

const getSession = withAuthenticatedUser(async ({ user }) => Response.json({
  user: { id: user.id, email: user.email ?? null },
}))

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    const routes = pathname === '/api/session' ? { GET: getSession }
      : pathname === '/api/analyst/context' ? { GET: getAnalystContext }
      : pathname === '/api/analyst/interpret' ? { POST: interpretAnalyst }
      : pathname === '/api/analyst/run' ? { POST: runAnalyst }
      : pathname === '/api/analyst/explain' ? { POST: explainAnalyst }
      : pathname === '/api/dashboard' ? { GET: getDashboard }
        : pathname === '/api/collections' ? { GET: getCollections }
        : pathname === '/api/collections/customer' ? { GET: getCustomer }
        : pathname === '/api/forecast' ? { GET: getForecast }
        : pathname === '/api/importaciones' ? { GET: getImports, POST: uploadImport }
          : /^\/api\/importaciones\/[^/]+\/activar$/.test(pathname) ? { POST: activateImport } : null
    if (routes) {
      const handler = routes[request.method]
      if (!handler) {
        return Response.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Método no permitido.' } }, {
          status: 405,
          headers: { Allow: Object.keys(routes).join(', '), 'Cache-Control': 'private, no-store' },
        })
      }
      return handler(request, env)
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada.' } }, {
        status: 404,
        headers: { 'Cache-Control': 'private, no-store' },
      })
    }
    return env.ASSETS.fetch(request)
  },
}
