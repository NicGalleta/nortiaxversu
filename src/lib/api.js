export class ApiError extends Error {
  constructor(status, code, message, requestId, details) {
    super(message)
    this.status = status
    this.code = code
    this.requestId = requestId
    this.details = details
  }
}

export async function getJson(path, signal) {
  return requestJson(path, { signal })
}

export async function requestJson(path, { signal, method = 'GET', body: requestBody, headers, timeout = 15000 } = {}) {
  const response = await fetch(path, {
    method, body: requestBody, headers,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)].filter(Boolean)),
  })
  let body
  try {
    body = await response.json()
  } catch {
    throw new ApiError(response.status, 'INVALID_RESPONSE', 'El servidor devolvió una respuesta inesperada.')
  }
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body.error?.code ?? 'REQUEST_FAILED',
      body.error?.message ?? 'No pudimos completar la solicitud.',
      body.error?.requestId,
      body.error?.details,
    )
  }
  return body
}
