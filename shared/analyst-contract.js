export const ANALYST_LIMITS = { horizonDays: 91, maxCustomers: 5, minDelay: 1, maxDelay: 60, maxText: 1000 }
export const DEFAULT_ANALYST_FORM = { task: 'compare', baseline: 'base', selection: { type: 'top', count: 3 }, delays: [7, 14] }
export const AI_MESSAGES = {
  disabled: 'La asistencia IA no está habilitada. Puedes usar los controles manuales.',
  configuration: 'La asistencia IA requiere configuración del administrador. Los cálculos manuales siguen disponibles.',
  expired: 'Terminó el período de prueba de IA. Puedes seguir calculando escenarios manualmente.',
  limited: 'La IA alcanzó un límite de uso o presupuesto. Los escenarios manuales siguen disponibles.',
  timeout: 'La IA demoró demasiado. Puedes usar el resultado calculado y los controles manuales.',
  unavailable: 'La IA no está disponible. Usa los controles y la explicación calculada.',
  invalid: 'La respuesta IA no pudo validarse. Usa los controles y la explicación calculada.',
  input_limit: 'El contexto excede el límite de IA. Los cálculos manuales siguen disponibles.',
}
export const TASK_LABELS = { explain: 'Explicar caja', simulate: 'Simular una demora', compare: 'Comparar dos demoras' }
export function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}
