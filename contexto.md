## ⏱️ Antes de empezar

- **Timebox:** 24 horas
- **Puedes (debes) usar IA para programar.** Claude Code, Codex o lo que uses en tu día a día. Solo cuéntanos brevemente cómo la usaste.
- **Puedes hacer preguntas.** Lo mejor es que tomes supuestos. Sin embargo, si tienes dudas, siempre estamos disponibles.

## 🏢 La empresa

**Nortia Supply** es una distribuidora B2B de insumos industriales. Le vende a ~1.200 pymes: talleres, contratistas y pequeñas fábricas. Los clientes compran a crédito, normalmente con 30 días para pagar.

Nortia, a su vez, paga a sus proveedores a 30 días, paga sueldos a fin de mes y tiene algunos gastos fijos.

El trimestre pasado Nortia tuvo **ventas récord**. Aun así, tuvo que pedir un crédito de corto plazo para pagarle a sus proveedores, que todavía está pagando en cuotas mensuales. Facturan mucho, pero la caja no llega.

## 🗣️ Lo que dice el equipo

**Carolina — Gerente de Finanzas**
"Mi pregunta cada lunes es simple: ¿vamos a tener caja para pagar lo que viene? Hoy no lo sé hasta que es demasiado tarde. Quiero ver con anticipación cuándo nos vamos a quedar cortos, para negociar con tiempo y no a última hora."

**Marta — Cobranza (equipo de una persona)**
"Tengo más de 400 facturas vencidas. Todas las mañanas llamo a quien me acuerdo que paga mal. Me gustaría saber a quién llamar primero y tener algo que decirle, sin escribir cada correo desde cero."

**Rodrigo — Gerente Comercial**
"Algunos clientes 'atrasados' son nuestras cuentas más grandes. Si los presionamos mal, los perdemos. Y a veces pagan tarde porque nosotros les mandamos mal la factura."

**Juan — TI (part-time)**
"El ERP exporta archivos CSV una vez al día. No tiene API. Lo que construyan lo voy a tener que mantener yo, así que por favor que sea algo que entienda."

## 📦 Lo que te entregamos

Una exportación del ERP con los últimos 12 meses:

datos_nortia_candidatos.zip

- `LEEME.md`: **léelo primero.** Tiene la fecha de corte, el saldo en banco a esa fecha y la descripción de cada columna.
- `clientes.csv`: clientes, contacto y condiciones de pago
- `facturas.csv`: facturas emitidas (incluye notas de crédito)
- `pagos.csv`: pagos recibidos de clientes
- `obligaciones.csv`: pagos que Nortia debe hacer (proveedores, sueldos, arriendo, impuestos, crédito bancario), tanto los ya pagados como los pendientes

Los datos están razonablemente limpios. El desafío no es limpiar datos (aunque, si lo haces, cuéntanos qué hiciste), sino entender el negocio. Eso sí, reflejan cómo funciona un negocio real: hay pagos en cuotas, pagos que cubren varias facturas, notas de crédito y facturas en disputa.

## 🎯 Tu misión

**Construye una aplicación web que ayude a Nortia a no quedarse sin caja.**

Tú decides stack, arquitectura, frameworks, buenas prácticas, cuantos servicios (y cuales), qué funcionalidades incluir, cuáles dejar fuera y por qué. Considera que es algo que tiene que funcionar en **producción**, por lo que el entregable debe ser lo más completo posible (production grade). Hay tres requisitos básicos:

1. **Debe estar desplegada** y accesible desde una URL. Puedes usar cualquier capa gratuita (AWS, Vercel, Render, Fly.io, Railway, Supabase, etc.).
2. **Debe incluir al menos una funcionalidad con IA**, donde creas que aporta valor real. Puedes usar cualquier modelo gratuito o pequeño (por ejemplo Gemini, Groq u OpenRouter en su capa gratuita, o Hugging Face). No vamos a evaluar la calidad de las respuestas del modelo, sino cómo y dónde lo integras.
3. **Debes poder saber si está funcionando.** Si algo falla un martes a las 3 de la mañana, ¿cómo te enteras?

## 📬 Qué nos tienes que enviar

1. **La URL de la aplicación** y credenciales de prueba. Por favor mantenla arriba al menos 2 semanas.
2. **Un repositorio** (GitHub/GitLab) con tu código.
3. **Un README** que incluya como mínimo:
   - Qué problema decidiste resolver, y para quién
   - Qué decidiste **no** hacer, y por qué
   - Los supuestos que tomaste
   - Cómo correrlo localmente y cómo está desplegado
   - Cómo monitoreas la aplicación y qué pasa cuando algo falla
   - Por qué usaste la IA donde la usaste, y qué pasa si el modelo no responde
   - Qué harías con 2 semanas más
   - Cuánto tiempo te tomó y cómo usaste IA para programar
4. _(Opcional)_ Un video de 5 minutos o menos mostrando la aplicación.

## 🔍 Qué vamos a mirar

- **Criterio de producto:** ¿tus decisiones tienen sentido para una empresa de este tamaño?
- **Calidad técnica:** ¿es correcto, está probado donde importa, otra persona lo puede mantener, es escalable, sigue buenas prácticas, se considera un servicio o conjunto de servicios "production-grade"?
- **Despliegue y operación:** ¿está arriba, es seguro, es eficiente, y sabrías si deja de funcionar?
- **Comunicación:** ¿alguien que no es ingeniero entiende qué hiciste y por qué?

## ❓ Preguntas frecuentes

**¿Qué stack uso?**
El que te haga más productivo. Justifícalo pensando en Nortia (y en Juan), no solo en ti.

**¿Tengo que hacer login?**
Tú decides. Considera que son datos financieros de una empresa real.

**¿Qué fecha uso como "hoy"?**
La fecha de corte que aparece en `LEEME.md`.

**¿La app tiene que poder cargar datos nuevos?**
Recuerda que el ERP exporta un CSV nuevo cada día. Tú decides cómo resolverlo, pero podríamos probar la app cargando una versión actualizada de los archivos.

**¿Qué pasa si se me acaba la capa gratuita del modelo de IA?**
No te preocupes. Puedes dejar indicaciones de cómo / dónde generar la API key necesaria, y nosotros lo hacemos.
