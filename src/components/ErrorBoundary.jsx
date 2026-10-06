import { Component } from 'react'

export class ErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="mx-auto max-w-5xl px-10 py-24" role="alert">
          <h1 className="text-2xl font-semibold">No pudimos mostrar la aplicación</h1>
          <p className="mt-3 text-stone-600">Recarga la página para volver a intentarlo.</p>
          <button
            className="mt-6 rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-stone-900"
            onClick={() => window.location.reload()}
          >
            Recargar página
          </button>
        </main>
      )
    }
    return this.props.children
  }
}
