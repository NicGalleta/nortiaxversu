import { forecastInput, invoice, profile } from './forecast-data.js'
export function collectionsSource() {
  return { ...forecastInput({ invoices: [invoice({ due: '2026-09-01' })], profiles: [profile()] }), customers: [{ id: 'C1', name: 'Cliente de prueba', taxId: '123-4', segment: 'taller' }] }
}
export function customerDetail() {
  return {
    snapshot: collectionsSource().dashboard.snapshot,
    customer: { id_cliente: 'C1', razon_social: 'Cliente de prueba', id_tributario: '123-4', segmento: 'taller', ciudad: 'Santiago', contacto_nombre: null, contacto_email: null, contacto_telefono: null, ejecutivo_comercial: null, dias_credito: 30, limite_credito: '9007199254740993' },
    invoices: [
      { id: 'F1', issued: '2026-08-01', due: '2026-09-01', total: '1000', credits: '-100', paid: '900', remaining: '0', disputed: false, reference: null, observation: null },
      { id: 'F2', issued: '2026-08-02', due: '2026-09-02', total: '2000', credits: '0', paid: '2000', remaining: '0', disputed: false, reference: 'F1', observation: null },
      { id: 'F3', issued: '2026-08-03', due: '2026-09-03', total: '300', credits: '0', paid: '100', remaining: '200', disputed: false, reference: null, observation: 'Saldo parcial' },
    ],
    credits: [{ id: 'NC1', invoice: 'F1', date: '2026-08-05', amount: '-100', observation: null }],
    payments: [
      { id: 'P1', date: '2026-09-01', amount: '2900', method: 'transferencia', allocations: [{ invoice: 'F1', amount: '900' }, { invoice: 'F2', amount: '2000' }] },
      { id: 'P2', date: '2026-09-02', amount: '100', method: 'transferencia', allocations: [{ invoice: 'F3', amount: '100' }] },
    ],
  }
}
