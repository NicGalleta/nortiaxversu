# Nortia Supply

Aplicación para anticipar faltantes de caja y preparar la cobranza. Se usan las exportaciones CSV del ERP y permite revisar obligaciones, priorizar clientes y comparar escenarios de atraso en los cobros.

https://nortiaxversu.nicoversu.workers.dev/

## Problema y usuarios

Finanzas detecta tarde la falta de efectivo y Cobranza trabaja sin una prioridad clara. Para atacar esto, la app cubre cuatro tareas:

| Pantalla | Para quién                          | Qué permite hacer                                                                                                                   |
| -------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Caja     | Carolina, Finanzas                  | Ver saldo en banco, deuda pendiente y obligaciones; revisar una proyección de 13 semanas con escenarios base y conservador.         |
| Cobranza | Marta, Cobranza; Rodrigo, Comercial | Priorizar clientes por saldo vencido sin disputa y revisar contactos, facturas, pagos, notas de crédito y disputas antes de llamar. |
| Analista | Carolina, Finanzas                  | Explicar la proyección y medir el efecto de demorar cobros de clientes, con supuestos manuales o interpretados por IA.              |

## Supuestos de los cálculos

- **Cada carga es completa:** reemplaza la versión activa de los cuatro archivos. No agrega movimientos de forma incremental. Subir y validar no cambia los datos visibles: hay que activar la carga y la carga se activa para todos los usuarios de forma transversal.
- **Saldos:** factura más notas de crédito menos pagos asignados, considerando el corte. Una referencia a una factura de reemplazo no reduce por sí sola la deuda. Se rechazan saldos negativos y asignaciones de pagos que no se puedan conciliar.
- **Señal a siete días:** resta del banco las obligaciones vencidas y las que vencen hasta corte + 7 días.
- **Prioridad de cobranza:** primero, mayor saldo vencido sin disputa; luego, mayor antigüedad. Después aparecen saldos sin disputa aún no vencidos y cuentas totalmente disputadas. El historial de atraso aporta contexto, pero no modifica el orden.

La proyección cubre 91 días desde el día siguiente al corte, agrupados en 13 períodos de siete días. Supone que cada saldo pendiente sin disputa se cobra completo en una fecha estimada:

| Supuesto                             | Base                                                                       | Conservador                                             |
| ------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------- |
| Atraso histórico                     | Mediana                                                                    | Percentil 80; al menos 14 días después de la fecha base |
| Facturas que vencen al corte o antes | Cobro no antes de corte + 7 días                                           | Cobro no antes de corte + 21 días                       |
| Sin historial suficiente             | Atraso fijo de 30 días desde el vencimiento, sujeto a los pisos anteriores | Atraso fijo de 60 días, sujeto a los pisos anteriores   |

El historial usa facturas pagadas completamente, sin disputas ni notas de crédito. Se busca primero un perfil por cliente (mínimo 5 observaciones), luego por segmento (10) y por cartera (10), antes de recurrir al atraso fijo. Tomar solo facturas ya pagadas puede subestimar los atrasos de las que siguen impagas.

## Arquitectura

Un único Cloudflare Worker sirve los archivos estáticos y `/api/*`. Supabase aporta PostgreSQL, Auth y el almacenamiento privado de los CSV.

El navegador inicia y cierra sesión con Supabase. Las lecturas usan la sesión del usuario y las políticas RLS de la base de datos. Las importaciones usan una credencial privilegiada solo en servidor, después de verificar identidad y autorización.

## Ejecución local

Requisitos: npm y Node 22.13 o superior dentro de la rama 22, o Node 24 o superior. `.nvmrc` selecciona Node 22.

```sh
nvm use
npm ci
cp -n .env.example .env.local
```

Completar `.env.local` con el mismo proyecto Supabase para navegador y servidor:

```dotenv
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
AI_ENABLED=false
```

`SUPABASE_SECRET_KEY` es necesaria para importar.

Preparar Supabase en este orden:

1. Seguir [la guía de Supabase](docs/SUPABASE.md): inspeccionar el esquema con `supabase/verify-phase2.sql`, configurar acceso por correo y contraseña, desactivar el registro público y crear una cuenta confirmada con su fila en `usuarios_autorizados`.
2. Aplicar las cuatro migraciones de `supabase/migrations/` en orden de nombre: caja (`0001`), importaciones (`0002`), proyección (`0003`) y cobranza (`0004`). Las guías de [importaciones](docs/IMPORTS.md) y [cobranza](docs/COLLECTIONS.md) detallan sus requisitos. Analista reutiliza estas consultas.
3. Ejecutar la aplicación:

   ```sh
   npm run dev
   ```

Abrir **http://127.0.0.1:5173**. Vite ejecuta la interfaz y la API del Worker; no hace falta levantar otro servidor ni iniciar sesión en Cloudflare para el flujo sin IA. Sin una importación activa, la aplicación muestra un estado vacío. Para cargar datos, seleccionar `clientes.csv`, `facturas.csv`, `pagos.csv` y `obligaciones.csv`, ingresar corte y banco, validar, revisar y activar.

## Despliegue

[wrangler.jsonc](wrangler.jsonc) configura el Worker `nortiaxversu`, los archivos de la aplicación, las rutas `/api/*`, el enlace `AI` de Workers AI y la observabilidad. El repositorio permite describir esa configuración, pero no confirmar la URL pública ni el estado del despliegue.

## Monitoreo y como saber cuando falla

La observabilidad del Worker está habilitada. El código registra:

- `api_error` para errores HTTP 5xx, con estado, código y `requestId`, sin credenciales ni contenido financiero.
- `analyst_ai` para llamadas al modelo, con operación, modelo, latencia, consumo de tokens si el proveedor lo informa y causa de fallo. No registra el texto de la consulta; la llamada al Gateway usa `collectLog: false`.

Las respuestas de la API incluyen `X-Request-Id`; los errores también lo incluyen en el cuerpo. Permite buscar una solicitud en los registros de Cloudflare. Las esperas tienen límites: 8 segundos por petición del cliente habitual de Supabase, 45 segundos en el cliente privilegiado de importación y 30 segundos para el modelo.

**No hay un monitor externo ni un canal de alertas configurado en el repositorio.** Con lo que está implementado, una caída a las 3 de la mañana no genera por sí sola una notificación al responsable. Tampoco se detecta automáticamente que el ERP dejó de entregar datos. Los errores de renderizado muestran una opción de recarga, pero no se envían a un servicio de seguimiento del navegador.

| Falla                                                   | Comportamiento y recuperación                                                                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sesión inválida o usuario sin autorización              | Se bloquea el acceso a los datos financieros.                                                                                                      |
| Supabase no responde o falta una consulta SQL           | Se muestra un error; no se sustituyen los datos por cifras de demostración. Revisar el código y el identificador de solicitud antes de reintentar. |
| CSV inválido o importación fallida                      | Se informan los errores de validación. La activación es transaccional y la versión activa anterior se conserva.                                    |
| Se agota el tiempo de una importación                   | Revisar el historial antes de repetir: el servidor puede haber terminado la operación.                                                             |
| Cambia la importación durante una consulta o simulación | Se exige actualizar los datos para evitar combinar versiones.                                                                                      |
| El modelo falla                                         | La interpretación se completa manualmente y la explicación conserva el resumen calculado.                                                          |

No hay limpieza automática de los archivos originales archivados. Los detalles de reintentos, concurrencia y recuperación están en [la guía de importaciones](docs/IMPORTS.md).

## IA: uso, límites y alternativa manual

Analista usa `@cf/openai/gpt-oss-120b` a través de Workers AI y AI Gateway para dos operaciones:

1. **Interpretar una pregunta como controles editables.** Por ejemplo, «Compara 7 y 14 días de demora para los 3 mayores clientes». El modelo devuelve una estructura validada; el usuario revisa los supuestos y pulsa **Calcular**.
2. **Seleccionar y ordenar evidencia ya calculada.** El modelo devuelve identificadores de hechos disponibles. Los importes, las fechas y los textos de esos hechos los genera el código.

El aporte funcional es facilitar la entrada de escenarios y la lectura de sus resultados. La aritmética financiera y la prioridad de cobranza son deterministas. **Motivo personal para elegir este uso de IA y este modelo:** [POR COMPLETAR].

La simulación admite demoras de 1 a 60 días para entre 1 y 5 clientes, con hasta dos alternativas sobre la misma selección. No modifica pagos reales ni guarda escenarios. La respuesta del modelo se valida en el servidor; las selecciones ambiguas requieren intervención del usuario.

Para interpretar se envía el texto escrito por el usuario. Para ordenar la explicación se envían hechos calculados, sin contactos, nombres de clientes ni CSV completos. No hay herramientas que el modelo pueda ejecutar.

Si la IA está deshabilitada, vencida, sin configuración, limitada por cuota, devuelve una estructura inválida o no responde en 30 segundos, se informa la causa y se mantiene la alternativa manual. No hay reintentos automáticos ni otro proveedor de respaldo. El límite de espera no garantiza cancelar una inferencia que ya esté ejecutándose o consumiendo cuota.

## Verificación

```sh
npm run check    # ESLint, pruebas de Node y compilación de producción
npm run preview  # Servir localmente la aplicación compilada
npm run test:sql # Regresión en un PostgreSQL temporal y aislado
```

Las pruebas de Node simulan las llamadas a Supabase y al modelo, sin credenciales reales. Cubren autorización, sesiones, errores de API, conciliación de pagos y notas de crédito, precisión monetaria, fechas, proyección, cobranza, escenarios y respuestas inválidas de IA.

La prueba SQL requiere `initdb`, `pg_ctl`, `createdb` y `psql`; se puede indicar su directorio con `NORTIA_PG_BIN`. Crea y elimina su propio clúster local, sin conectarse a Supabase. Nunca ejecutar las fixtures de `supabase/tests/` sobre la base de la aplicación. La comprobación con los CSV originales depende de que estén disponibles localmente.

Para una revisión funcional están el [guion de demo](docs/DEMO.md) y los [casos manuales del Analista](test_ai.md). Las pruebas con proveedores simulados no verifican la disponibilidad del despliegue ni la respuesta del modelo real.
