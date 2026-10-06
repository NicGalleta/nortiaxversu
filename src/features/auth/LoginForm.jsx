import { useState } from 'react'
import { getSupabaseBrowserClient } from '../../lib/supabase/browser.js'
import { signInErrorMessage } from './auth-errors.js'

export default function LoginForm({ onSignedIn }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    if (pending) return
    const form = event.currentTarget
    const values = new FormData(form)
    setPending(true)
    setError('')
    try {
      const { error: authError } = await getSupabaseBrowserClient().auth.signInWithPassword({
        email: String(values.get('email')).trim(),
        password: String(values.get('password')),
      })
      if (authError) {
        setError(signInErrorMessage(authError))
        return
      }
      form.reset()
      onSignedIn()
    } catch {
      setError(signInErrorMessage())
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="mx-auto mt-10 max-w-md rounded-xl border border-stone-200 bg-white p-8" aria-labelledby="login-title">
      <p className="text-xs font-semibold uppercase tracking-widest text-stone-500">Acceso al equipo</p>
      <h1 id="login-title" className="mt-3 text-2xl font-semibold tracking-tight">Bienvenido a Nortia</h1>
      <p className="mt-3 text-sm leading-6 text-stone-600">Ingresa con tu cuenta para revisar la caja y los próximos pagos.</p>
      <form onSubmit={handleSubmit} className="mt-7 space-y-5" aria-busy={pending}>
        <div>
          <label htmlFor="email" className="block text-sm font-medium">Correo electrónico</label>
          <input id="email" name="email" type="email" autoComplete="username" required disabled={pending}
            className="mt-2 w-full rounded-md border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-stone-600 focus:ring-2 focus:ring-stone-200 disabled:bg-stone-100" />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium">Contraseña</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required disabled={pending}
            className="mt-2 w-full rounded-md border border-stone-300 px-3 py-2.5 text-sm outline-none focus:border-stone-600 focus:ring-2 focus:ring-stone-200 disabled:bg-stone-100" />
        </div>
        {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <button type="submit" disabled={pending}
          className="w-full rounded-md bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-stone-900 disabled:cursor-wait disabled:opacity-60">
          {pending ? 'Ingresando…' : 'Iniciar sesión'}
        </button>
      </form>
      <p className="mt-6 text-xs leading-5 text-stone-500">Si necesitas una cuenta o recuperar tu acceso, contacta al administrador.</p>
    </section>
  )
}
