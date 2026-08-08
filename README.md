# Taller de Ilustración

Plataforma de curso de ilustración autogestionado para niños, con evaluación de
dibujos por visión de IA contra una rúbrica calibrada. Construido originalmente
para Jorge, 10 años.

## Qué hace

- Jorge sube una foto de su dibujo desde el celular (cámara nativa, PWA instalable).
- Antes de poder pedir feedback, tiene que autoevaluarse — el botón "Evaluar" no
  se habilita hasta que registra su propia calificación.
- Un mentor de IA (Claude, visión) evalúa el dibujo contra una rúbrica calibrada
  por técnica y semana del curso, y devuelve feedback acotado a tres puntos: un
  acierto, una corrección y un micro-ejercicio.
- Su papá tiene un panel aparte con banderas de seguimiento (cuando algo requiere
  corrección física — ej. cómo sostiene el lápiz) y un semáforo de materiales
  pendientes de comprar.
- Al terminar el curso, se genera un PDF para imprimir y engargolar: una hoja de
  acompañamiento por sesión más un capítulo final, "Tu huella", con los rasgos de
  estilo que se repitieron a lo largo del taller.

## Arquitectura

Monorepo políglota:

```
apps/web              PWA — React 19 + TypeScript + Vite
apps/bff              Backend — Node 22, Express, Apollo (GraphQL), Prisma, BullMQ
services/evaluator     Servicio de inferencia — FastAPI (Python), sin estado, sin acceso a la DB
packages/rubric        rubric.schema.json — fuente única de verdad de la rúbrica,
                        con codegen a Zod (TS) y Pydantic (Python)
packages/shared         Tipos generados desde el SDL de GraphQL
content/                Montado en runtime desde un repo privado — nunca se versiona aquí
```

```
PWA --REST multipart--> /upload (imagen)
PWA --GraphQL-------->  bff --Prisma--> Postgres
                         |--BullMQ--> Redis --worker--> evaluator --> Anthropic (visión)
```

Traefik (compartido, fuera de este repo) enruta por dominio a `web` — que además
proxyea `/graphql`, `/upload`, `/auth` y `/print-package` hacia el `bff` bajo el
mismo origen, así la cookie de sesión no necesita configuración especial de CORS
entre subdominios.

Por qué políglota: el bff es agregación para un cliente móvil; el evaluator es el
servicio de inferencia (Pillow para EXIF/resize, Pydantic para forzar el contrato
de la rúbrica). El seam es real — si mañana la inferencia se mueve a otro
runtime, el bff no cambia.

## Algunas decisiones de diseño

- **Autoevaluación bloqueante**: requisito de producto, no detalle de UI — el
  niño no puede pedir feedback sin antes calificarse a sí mismo.
- **Acceso por PIN familiar, no por cuenta**: nadie captura nombre, correo ni
  contraseña de un menor. Un PIN compartido abre una sesión de cookie httpOnly.
- **Idempotency key** en la subida de imágenes: un doble tap en móvil no crea un
  registro duplicado — verificado con Postgres real (Testcontainers), no mocks.
- **Máquina de estados con recuperación real**: `uploaded → queued → evaluating
  → evaluated|failed`. Si el worker muere a medio proceso, BullMQ detecta el job
  y otro worker lo retoma — probado matando un worker de verdad en medio de un
  job, no simulado.
- **Presupuesto de memoria real**: el droplet de producción comparte 2 GB de RAM
  con otros proyectos. Cada servicio tiene `mem_limit`/`mem_reservation`
  explícitos, calibrados contra uso medido, no valores arbitrarios.
- **Deploy sin build en el droplet**: CI construye y publica a GHCR; el droplet
  solo hace `pull` + `up`. Rollback documentado en [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Desarrollo local

Requiere Docker, Node 22, pnpm, y `uv` para el servicio de evaluación.

```bash
cp .env.example .env   # completa POSTGRES_PASSWORD, ANTHROPIC_API_KEY, FAMILY_PIN, COOKIE_SECRET
pnpm install
docker compose up -d   # levanta los 5 servicios; build local vía docker-compose.override.yml
```

### Comandos frecuentes

```bash
pnpm -w typecheck && pnpm -w lint && pnpm -w test   # antes de dar por terminado cualquier cambio
pnpm gen:rubric                                     # rubric.schema.json -> Zod + Pydantic
pnpm gen:graphql                                    # SDL -> tipos TS
pnpm evals                                          # harness de evaluación del prompt contra el golden set
uv run --directory services/evaluator pytest
```

## Privacidad

Este repositorio es público; el contenido no. Las fotos de los dibujos, el
golden set de evaluación y cualquier dato del menor viven en un repositorio
privado aparte, montado como volumen en runtime — nunca se versionan aquí. El
acceso a la app es por PIN familiar compartido, sin captura de identidad de
ningún menor.

## Estado del proyecto

Construido en rebanadas verticales, cada una con un criterio de aceptación
verificable: infraestructura → rúbrica calibrada → servicio de evaluación →
cola asíncrona → API GraphQL → PWA → panel de padre → deploy → paquete de
impresión. Ver [`CLAUDE.md`](CLAUDE.md) para el detalle rebanada por rebanada y
las reglas de arquitectura del proyecto.
