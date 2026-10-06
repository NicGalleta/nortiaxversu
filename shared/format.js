const amountFormatter = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 })
const dateFormatter = new Intl.DateTimeFormat('es-CL', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
})

function asInteger(value) {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value)
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value)
  throw new TypeError('El monto debe ser un entero exacto.')
}

// Preserve PostgreSQL bigint values without passing through JavaScript Number.
export function formatAmount(value) {
  return amountFormatter.format(asInteger(value))
}

export function compareAmounts(left, right) {
  const first = asInteger(left)
  const second = asInteger(right)
  return first < second ? -1 : first > second ? 1 : 0
}

// Business dates remain the same calendar day in every browser time zone.
export function formatDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError('La fecha debe tener el formato AAAA-MM-DD.')
  }
  const date = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new TypeError('La fecha no es válida.')
  }
  return dateFormatter.format(date)
}
