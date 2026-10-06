export function signInErrorMessage(error) {
  if (error?.code === 'email_not_confirmed') {
    return 'Tu correo aún no está confirmado. Contacta al administrador.'
  }
  if (error?.status === 429 || error?.code === 'over_request_rate_limit') {
    return 'Hay demasiados intentos. Espera unos minutos antes de volver a intentar.'
  }
  if (error?.code === 'invalid_credentials' || error?.status === 400) {
    return 'El correo o la contraseña no son correctos.'
  }
  return 'No pudimos iniciar sesión. Revisa tu conexión e intenta nuevamente.'
}
