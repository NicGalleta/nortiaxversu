import { lazy, Suspense, useState } from 'react'
import { useSessionStatus } from './hooks/use-session-status.js'
import { getSupabaseBrowserClient } from './lib/supabase/browser.js'
import LoginForm from './features/auth/LoginForm.jsx'
import { useDashboard } from './features/cash/use-dashboard.js'

const Dashboard = lazy(() => import('./features/cash/Dashboard.jsx'))
const Collections = lazy(() => import('./features/collections/Collections.jsx'))
const Analyst = lazy(() => import('./features/analyst/Analyst.jsx'))
const Imports = lazy(() => import('./features/imports/Imports.jsx'))

const buttonClass = 'rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-stone-900 disabled:cursor-wait disabled:opacity-50'

function LoadingState({ children }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-10 text-stone-600">
      <span aria-hidden="true" className="size-4 animate-pulse rounded-full bg-stone-300" />
      {children}
    </div>
  )
}

function Feedback({ title, message, requestId, retry, configuration = false }) {
  return (
    <section role="alert" className="rounded-xl border border-stone-200 bg-white p-8">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-600">{message}</p>
      {configuration && <p className="mt-2 text-sm text-stone-600">Completa las variables de .env.local siguiendo el README y reinicia el servidor de desarrollo.</p>}
      {requestId && <p className="mt-4 text-xs text-stone-500">Referencia: {requestId}</p>}
      <button onClick={retry} className={`${buttonClass} mt-5`}>Volver a intentar</button>
    </section>
  )
}

function CashOverview({ onSessionExpired }) {
  const dashboard = useDashboard(onSessionExpired)
  if (dashboard.status === 'loading') return <LoadingState>Cargando el resumen de caja…</LoadingState>
  if (dashboard.status !== 'ready') {
    return <Feedback title={dashboard.status === 'forbidden' ? 'Acceso pendiente de autorización' : 'No pudimos cargar la caja'}
      message={dashboard.message} requestId={dashboard.requestId} retry={dashboard.retry} />
  }
  return <Suspense fallback={<LoadingState>Preparando el resumen de caja…</LoadingState>}>
    <Dashboard data={dashboard.data} onRefresh={dashboard.retry} onSessionExpired={onSessionExpired} />
  </Suspense>
}

export default function App() {
  const session = useSessionStatus()
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const [view, setView] = useState('cash')
  const [importVersion, setImportVersion] = useState(0)

  async function signOut() {
    if (signingOut) return
    setSigningOut(true)
    setSignOutError('')
    try {
      const { error } = await getSupabaseBrowserClient().auth.signOut({ scope: 'local' })
      if (error) throw error
      setView('cash')
      session.retry()
    } catch {
      setSignOutError('No pudimos cerrar la sesión. Revisa tu conexión e intenta nuevamente.')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-10">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-md bg-stone-900 text-sm font-bold text-white">N</span>
            <span className="text-lg font-semibold tracking-tight">Nortia Supply</span>
            {session.status === 'ready' && <nav aria-label="Secciones" className="ml-5 flex gap-2 border-l border-stone-200 pl-5">
              <button onClick={() => setView('cash')} aria-current={view === 'cash' ? 'page' : undefined} className={`${buttonClass} ${view === 'cash' ? 'bg-stone-100' : ''}`}>Caja</button>
              <button onClick={() => setView('collections')} aria-current={view === 'collections' ? 'page' : undefined} className={`${buttonClass} ${view === 'collections' ? 'bg-stone-100' : ''}`}>Cobranza</button>
              <button onClick={() => setView('analyst')} aria-current={view === 'analyst' ? 'page' : undefined} className={`${buttonClass} ${view === 'analyst' ? 'bg-stone-100' : ''}`}>Analista</button>
              <button onClick={() => setView('imports')} aria-current={view === 'imports' ? 'page' : undefined} className={`${buttonClass} ${view === 'imports' ? 'bg-stone-100' : ''}`}>Importaciones</button>
            </nav>}
          </div>
          {session.status === 'ready' && (
            <div className="flex items-center gap-4">
              <span className="max-w-64 truncate text-sm text-stone-600">{session.user.email}</span>
              <button className={buttonClass} onClick={signOut} disabled={signingOut}>
                {signingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-10 py-10">
        {signOutError && session.status === 'ready' && <p role="alert" className="mb-6 rounded-md bg-red-50 p-4 text-sm text-red-800">{signOutError}</p>}
        {session.status === 'loading' && <LoadingState>Verificando tu sesión…</LoadingState>}
        {session.status === 'empty' && <LoginForm onSignedIn={session.retry} />}
        {session.status === 'ready' && (view === 'cash'
          ? <CashOverview key={session.user.id} onSessionExpired={session.retry} />
          : <Suspense fallback={<LoadingState>Preparando sección…</LoadingState>}>
            {view === 'collections' ? <Collections key={session.user.id} onSessionExpired={session.retry} /> : view === 'imports' ? <Imports key={session.user.id} onSessionExpired={session.retry} onActivated={() => { setImportVersion(n => n + 1); setView('cash') }} /> : null}
          </Suspense>)}
        {session.status === 'ready' && <Suspense fallback={view === 'analyst' ? <LoadingState>Preparando Analista…</LoadingState> : null}><Analyst key={session.user.id} active={view === 'analyst'} importVersion={importVersion} onSessionExpired={session.retry} /></Suspense>}
        {(session.status === 'configuration' || session.status === 'error') && (
          <Feedback title={session.status === 'configuration' ? 'Configuración pendiente' : 'No pudimos verificar tu sesión'}
            message={session.message} requestId={session.requestId} retry={session.retry} configuration={session.status === 'configuration'} />
        )}
      </main>
    </div>
  )
}
