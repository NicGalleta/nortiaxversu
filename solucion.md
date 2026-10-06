# Solución propuesta para Nortia Supply

El problema central es **liquidez: Nortia vende, pero cobra después de necesitar el dinero**. La app debería conectar dos decisiones: cuánto efectivo faltará y qué acciones de cobranza pueden ayudar a cubrirlo.

Este resumen se basa en [contexto.md](contexto.md) y los cuatro CSV de [datos_nortia_candidatos](datos_nortia_candidatos), siguiendo las definiciones del `LEEME.md`.

## Lo que muestran los datos

El “hoy” de la aplicación debe ser **27 de septiembre de 2026**, con **270 millones en banco**. Calculando saldos después de pagos y notas de crédito:

| Indicador | Resultado |
|---|---:|
| Clientes | 1.200 |
| Facturas con saldo pendiente | 1.144 |
| Total por cobrar | 1.404,1 millones |
| Facturas vencidas | 472 |
| Monto vencido | 509,4 millones |
| Saldo en disputa | 18,3 millones |
| Obligaciones pendientes hasta el 27 de diciembre | 1.605,6 millones |
| Obligaciones exigibles en los próximos 7 días | 296,2 millones |

Los montos están expresados en moneda local.

**Sin nuevos cobros, la caja actual no alcanza para los próximos siete días:** faltarían unos **26,2 millones**. Esto es una señal concreta de urgencia, no una predicción de que necesariamente ocurrirá.

## Qué construiría en las 24 horas

Una aplicación pequeña con tres pantallas:

- **Caja:** saldo inicial, cobros estimados, obligaciones y saldo proyectado por semana. Mostrar cuándo aparece un déficit y permitir comparar escenarios conservador y base.
- **Cobranza:** lista priorizada por cliente, agrupando sus facturas. Explicar cada prioridad: monto recuperable, atraso, comportamiento histórico y disputas. Marta necesita saber a quién contactar y por qué.
- **Importación:** cargar los CSV actualizados, validar relaciones y mostrar fecha de corte, resultado de la carga y errores comprensibles.

Para la funcionalidad de **IA**, usaría generación de borradores de cobranza: mensaje basado en las facturas reales, tono cuidadoso y contexto de disputa. Revisión humana antes de enviarlo. Si el modelo falla, una plantilla permite seguir trabajando.

## Lo difícil y dónde pondría más cuidado

- **Calcular la deuda correctamente.** Hay cuotas, 211 pagos que cubren varias facturas y 182 notas de crédito. Una factura anulada y su reemplazo no deben duplicar la deuda. En la conciliación exploratoria, los pagos que cubren varias facturas cuadraron y no quedaron saldos negativos.
- **Estimar cuándo cobrarás.** Vencimiento no significa ingreso efectivo. Usaría comportamiento histórico por cliente y un respaldo por segmento cuando falten datos. Una factura ya vencida necesita una fecha futura estimada; no puede quedar como ingreso en el pasado.
- **No tratar las disputas como simple morosidad.** Puede tocar corregir una factura o coordinar con Comercial antes de cobrar. Priorizar solo por antigüedad o monto sería insuficiente.
- **Evitar una proyección engañosa.** Los archivos incluyen obligaciones futuras, pero no ventas futuras. La primera versión debe decir que proyecta la cartera y obligaciones conocidas; además, algunos egresos son estimaciones.
- **Actualizar sin duplicar.** Definir si cada importación reemplaza una foto completa del ERP. Validar todo antes de activar la nueva versión y conservar la anterior si algo falla.
- **Operar de verdad.** Login, secretos en servidor, registro de errores, comprobación externa de disponibilidad y alertas si los datos dejan de actualizarse. Que la página cargue no garantiza que sus números estén vigentes.

## Cómo empezaría a programar

Primero haría un **motor de conciliación independiente de la interfaz**, con pruebas para cuotas, pagos múltiples, notas de crédito y reemplazos. Después, proyección de caja con supuestos explícitos; luego las pantallas y la IA.

Elegiría un monolito y una base SQL con el stack que ya domines. Dejaría fuera microservicios, envío automático de correos, integración bancaria y modelos predictivos complejos. Para este desafío, el valor está en **números confiables, prioridades explicables y una aplicación desplegada que Juan pueda mantener**.

## Infraestructura propuesta

- **Cloudflare Workers:** alojar frontend y API en un mismo proyecto; la API valida importaciones, ejecuta la lógica financiera y llama al modelo de IA con secretos del servidor. Ver [guía de aplicaciones web](https://developers.cloudflare.com/workers/framework-guides/web-apps/).
- **Supabase:** PostgreSQL para datos e historial de importaciones, Auth para login y políticas RLS para restringir acceso. Importaciones transaccionales y migraciones SQL versionadas. Ver [seguridad con RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
- **IA y operación:** proveedor de IA intercambiable con plantilla de respaldo; registro de errores y monitor externo con alertas por caída o datos desactualizados. Configurar copias de seguridad y comprobar su restauración.
- **Entrega:** despliegue automático desde Git tras las pruebas críticas. Verificar límites y condiciones de los planes elegidos para mantener la demo disponible al menos dos semanas; sin colas ni servicios adicionales al inicio.
