import { withAuthorizedUser, databaseError } from '../lib/supabase/authorization.js'
import { HttpError } from '../lib/supabase/action.js'
import { readBoundedBody } from '../imports/request.js'
import { analystContext, calculateAnalysis } from '../analyst/calculate.js'
import { aiAvailability, callModel, resolveInterpretation, validateExplanation } from '../analyst/ai.js'
import { ANALYST_LIMITS, exactKeys } from '../../shared/analyst-contract.js'

async function sourceFor(supabase) {
  const { data, error } = await supabase.rpc('nortia_cobranza_v1')
  if (error) throw databaseError(error)
  try { analystContext(data) } catch { throw new HttpError(502, 'INVALID_DATA', 'Los datos de la importación no cuadran. Contacta al administrador.') }
  return data
}
async function bodyFor(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') ?? '')) throw new HttpError(415, 'INVALID_CONTENT_TYPE', 'Envía los supuestos como JSON.')
  try { return JSON.parse(await (await readBoundedBody(request, 8192)).text()) }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'INVALID_REQUEST', 'No pudimos leer los supuestos.') }
}
export const getAnalystContext = withAuthorizedUser(async ({ supabase, env }) => Response.json({ ...analystContext(await sourceFor(supabase)), limits: ANALYST_LIMITS, ai: aiAvailability(env) }))
export const interpretAnalyst = withAuthorizedUser(async ({ supabase, env, request, requestId }) => {
  const body = await bodyFor(request)
  if (!exactKeys(body, ['snapshotId','text']) || typeof body.text !== 'string' || !body.text.trim() || body.text.length > ANALYST_LIMITS.maxText) throw new HttpError(400, 'INVALID_REQUEST', 'Escribe una solicitud de hasta 1.000 caracteres.')
  const context = analystContext(await sourceFor(supabase))
  if (!context.snapshot || body.snapshotId !== context.snapshot.id) throw new HttpError(409, 'SNAPSHOT_CHANGED', 'Cambió la importación activa. Actualiza Analista y revisa los clientes.')
  const result = await callModel(env, 'interpret', { request: body.text }, requestId, output => resolveInterpretation(output, context, body.snapshotId, body.text))
  return Response.json({ ...(result.value ?? { status: 'needs_input', message: result.ai.message }), ai: result.ai })
})
export const runAnalyst = withAuthorizedUser(async ({ supabase, request }) => {
  const spec = await bodyFor(request)
  return Response.json(calculateAnalysis(await sourceFor(supabase), spec))
})
export const explainAnalyst = withAuthorizedUser(async ({ supabase, env, request, requestId }) => {
  const spec = await bodyFor(request)
  const result = calculateAnalysis(await sourceFor(supabase), spec)
  // No contacts, customer names, raw ERP text, CSVs or client-provided totals.
  const response = await callModel(env, 'explain', { facts: result.facts.map(({id,kind,text}) => ({id,kind,text})) }, requestId, output => validateExplanation(output, result))
  return Response.json({ ...result, explanation: response.value ?? { ...result.explanation, message: response.ai.message }, ai: response.ai })
})
