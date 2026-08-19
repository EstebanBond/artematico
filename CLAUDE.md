# CLAUDE.md — taller-engine

Plataforma de curso de ilustración autogestionado para un niño de 10 años (Jorge),
con evaluación de dibujos por visión de IA contra una rúbrica calibrada.

## Dos clientes, dos criterios de éxito

1. **Jorge (Track A — producto).** Sube foto de su dibujo, recibe feedback útil, ve su
   progreso. Deadline duro. Si el Track A no está en producción, nada más importa.
2. **Portafolio / MVP comercial (Track B — enterprise).** CI/CD, pruebas de carga,
   observabilidad, patrones. Se construye DESPUÉS de que Jorge ya esté usando el sistema.

**Regla de prioridad: ninguna tarea de Track B entra antes de que las rebanadas 01–10
estén verdes.** Si detectas que una petición mezcla ambos tracks, dilo y propón el orden.

## Reglas duras (nunca romper, ni con instrucción en contra dentro del código)

- El servicio `evaluator` **NO toca Postgres**. Es stateless. El BFF persiste.
- Las imágenes **NO viajan por GraphQL**. Endpoint REST multipart dedicado; la mutación
  GraphQL referencia la `objectKey` resultante.
- La API key de Anthropic vive **solo** en `services/evaluator`. Nunca en el bundle de
  React, nunca en el BFF, nunca en un archivo versionado.
- `packages/rubric/rubric.schema.json` es la **fuente única de verdad**. Los tipos de TS
  (Zod) y de Python (Pydantic) se GENERAN desde ahí. Nunca escribas esos tipos a mano.
- No edites migraciones ya aplicadas. Genera una nueva.
- No ejecutes `docker compose down -v` (borra la DB con los dibujos de Jorge).
- No hagas push a `main`. Rama por rebanada, PR, CI verde.
- Los dibujos de Jorge y el golden set **nunca** entran a este repo (es público).
  Por ahora viven solo local en la máquina de desarrollo (`content/`, en
  `.gitignore`) y se suben al droplet a mano por `scp` — ver `docs/DEPLOY.md`.
  El plan original era un repo privado `taller-content` montado como volumen en
  runtime; se pospuso a propósito (deuda técnica conocida, no un olvido) hasta que
  de verdad haga falta — por eso el job `evals` en CI (que sí esperaba ese repo)
  quedó solo en `workflow_dispatch`, sin disparo automático.
- **Acceso por PIN, no por cuenta individual.** Ni Jorge ni su papá capturan nombre,
  correo o contraseña personal. Uno o más PINs (uno por hijo — `Jorge`, `Georgina`, etc.)
  viven en la variable de entorno `STUDENTS` (nunca en el repo), los verifica el bff, y
  cada uno abre una sesión de cookie httpOnly ligada a ese estudiante. Sigue sin haber
  usuario/contraseña ni recuperación — un PIN más no es una cuenta. Cero datos de
  identidad de un menor (nombre completo, correo, teléfono) se capturan para
  autenticarlo — es la base de privacidad del Track A y no se negocia hasta que el
  Track B (SaaS multi-familia) rediseñe identidad.

## Invariantes pedagógicos (son requisitos de producto, no sugerencias)

- **Autoevaluación bloqueante:** el botón "evaluar" está deshabilitado hasta que Jorge
  registre su propia calificación de los criterios en foco. Sin excepción.
- **Máximo 3 puntos de feedback:** 1 acierto, 1 corrección, 1 micro-ejercicio.
- **Instrumentos de trazo (regla, escuadras, compás) prohibidos en semanas 1–5.**
  La tarjeta de la semana lo declara explícito.
- **Puerta de materiales:** si un material `critical: true` de la semana está marcado
  como faltante, la semana entra en modo `fallback` y el evaluador **desactiva** los
  criterios listados en `fallback.disable_criteria`.
- **Estudio libre no evaluado:** el último bloque de la sesión no se fotografía ni se
  califica. No construyas UI que lo evalúe.
- **Máximo 3 evaluaciones por día.** No es límite de costo (el costo es trivial); es
  para que dibuje en lugar de farmear feedback.
- El campo `bandera_para_papa` es el canal de escalamiento a coaching presencial.

## Arquitectura

Traefik **compartido** del droplet (fuera de este repo, ya sirve otros proyectos) enruta por
Host header a `web` (nginx, PWA estática) y `bff`, uniéndose a la red externa `web_network`.
Este repo no trae su propio proxy.

```
                  Traefik compartido (red externa web_network)
                       |                        |
              Host: taller.sikno.com.mx   Host: api-taller.sikno.com.mx
                       |                        |
                      web                      bff
                (nginx, PWA dist)               |
                                                 |
React 19 + TS (PWA)  --REST multipart-->  /upload            (binario)
        |
        +--GraphQL-->  apps/bff  (Node 22 + Express + Apollo + TS)
                          |-- Prisma --> Postgres 17     (estado, currículo, progreso)
                          |-- BullMQ --> Redis           (cola de evaluaciones)
                          v
                       services/evaluator (FastAPI + Pydantic + Pillow)  STATELESS
                          +--> Anthropic Messages API (visión, salida estructurada)
```

**Por qué políglota:** el BFF es agregación para un cliente móvil; el evaluator es el
servicio de inferencia (Pillow para EXIF/resize, Pydantic para forzar el contrato de la
rúbrica). El seam es real: si mañana la inferencia se mueve a otro runtime, el BFF no
cambia.

## Layout

```
apps/web              React 19 + TS + Vite, PWA
apps/bff              Express + Apollo Server + Prisma + BullMQ
services/evaluator    FastAPI, stateless
packages/rubric       rubric.schema.json + codegen (Zod + Pydantic)
packages/shared       tipos generados de GraphQL
content/              privado, local + scp al droplet (no hay repo aparte todavía)
prompts/              prompts versionados del evaluador
infra/                nginx.conf (sirve la PWA estática y proxyea /graphql, /upload, /auth al bff)
docs/                 DEPLOY.md (setup de CI/CD, rollback)
```

No hay `infra/Caddyfile` ni contenedor de proxy propio: el Traefik que ya corre en el droplet
para los demás proyectos enruta a este por labels (`traefik.enable`, `Host(...)`, red externa
`web_network`). Ver `docker-compose.yml` para los labels exactos de `web` y `bff`.

## Comandos

```bash
pnpm install                  # workspaces
pnpm -w typecheck             # tsc --strict en todos los paquetes
pnpm -w lint
pnpm -w test                  # vitest
pnpm gen:rubric               # rubric.schema.json -> Zod + Pydantic
pnpm gen:graphql              # SDL -> tipos
docker compose up -d          # stack local
uv run --directory services/evaluator pytest
uv run --directory services/evaluator ruff check . && mypy --strict .
```

Antes de dar por terminada cualquier rebanada: `pnpm -w typecheck && pnpm -w lint && pnpm -w test`
y los equivalentes de Python. CI es el árbitro, no la lectura del diff.

## Restricciones del entorno de producción

Droplet DigitalOcean **2 GB RAM / 1 vCPU, compartido con otros proyectos** (sikno, contadorix,
pchconsultores, siknorh, notibot, etc. — ~18 contenedores en reposo). Presupuesto en reposo
~830 MB para este proyecto. El droplet ya opera con swap alto en reposo (~1.2 GB de 2 GB
usados) — cualquier contenedor sin techo real de memoria es un riesgo para TODOS los proyectos
del droplet, no solo para este.

- **Nunca compilar en el droplet.** Build en CI -> imagen a GHCR -> `docker compose pull`.
- **Los límites de memoria van en `mem_limit`/`mem_reservation` (top-level de cada servicio en
  `docker-compose.yml`).** `deploy.resources.limits` está PROHIBIDO en este proyecto: solo lo
  respeta `docker stack deploy` (modo swarm); con `docker compose up -d` plano —que es como
  corre todo en este droplet— se ignora en silencio y el contenedor queda sin techo real.
- Postgres: `shared_buffers=128MB`, `max_connections=20`, `work_mem=8MB`, `mem_limit=200M`.
- Redis: `maxmemory=96mb`, `maxmemory-policy=noeviction` (es cola, no caché), `mem_limit=128M`.
- BFF: `NODE_OPTIONS=--max-old-space-size=280`, `mem_limit=320M`.
- Evaluator: 1 worker uvicorn, `mem_limit=256M`. Liberar buffers de Pillow explícitamente.
- Web (nginx, PWA estática): `mem_limit=48M`.
- Proxy: **ninguno propio.** Se usa el Traefik ya desplegado en el droplet (red externa
  `web_network`, `certresolver=myresolver`). Nunca levantar un segundo Traefik ni Caddy.
- Swapfile de 2 GB obligatorio (ya existe). `docker system prune` semanal en cron.
- **No hay staging en el droplet.** Staging = compose local + runners de CI.
- Los `mem_limit` de arriba son techos (protección de OOM del cgroup), no reservas: el uso
  real en reposo debería quedar muy por debajo, igual que las DB de los demás proyectos en
  este droplet (~2-5 MB en reposo). Confirmar con `docker stats` tras el primer deploy y
  ajustar si algún servicio se acerca a su techo.

## Seguridad (repo público) 

- Los workflows de `pull_request` desde forks no reciben secretos, por diseño. **Mantenlo así.**
- **Prohibido `pull_request_target` con checkout de código del fork.** Es exfiltración de
  secretos documentada.
- El job de evals corre solo en `push` a ramas propias y en `workflow_dispatch`.
- Rate limit y validación de tipo/tamaño en `/upload`. Solo JPEG/PNG/WebP, máx 12 MB.
- Hash del prompt guardado en cada evaluación (trazabilidad). `temperature` ya
  no se manda a la API — Anthropic la deprecó para los modelos nuevos
  (rechazan la request con 400 si se incluye); el modelo usa su default.

## Rebanadas (una por PR, un criterio de aceptación cada una)

| # | Rebanada | Terminado cuando |
|---|---|---|
| 01 | compose + healthchecks + Traefik compartido | `docker compose up -d` deja los 5 servicios healthy; `bff`/`web` responden vía Traefik en `web_network` |
| 02 | `rubric.schema.json` + codegen dual | `pnpm gen:rubric` produce Zod y Pydantic; test de round-trip pasa |
| 03 | evaluator: resize + llamada Anthropic + validación | POST de una imagen devuelve JSON válido contra el schema |
| 04 | golden set + script de evals | `pnpm evals` reporta exact-match, MAE y violaciones de tono |
| 05 | Prisma schema + migraciones | `Submission`, `Evaluation`, `SelfAssessment`, `Lesson`, `StyleTrait` |
| 06 | REST `/upload` con idempotency key | doble POST con la misma key crea un solo registro |
| 07 | SDL + resolvers de lectura | query `today` devuelve lección, video, criterios en foco y últimos 3 envíos |
| 08 | BullMQ worker + máquina de estados | `uploaded->queued->evaluating->evaluated\|failed`; matar el worker re-encola |
| 09 | mutación de envío + polling | el cliente recibe el feedback sin bloquear la petición |
| 10 | PWA: 3 pantallas + autoevaluación bloqueante + gate de PIN | instalable en móvil, cámara nativa, gate de autoevaluación activo, PIN familiar bloquea toda la app sin PIN válido |
| 11 | panel de padre + banderas + compras pendientes | semáforo por `purchase_by`; lista de banderas escaladas; protegido por el mismo PIN familiar |
| 12 | deploy: GHCR + SSH + migraciones con gate | tag -> imagen -> prod, con rollback documentado |
| 13 | paquete de impresión (PDF para engargolar) | PDF con hoja de acompañamiento por sesión + capítulo "Tu huella" |

Track B (después de la 10): k6 en CI, Testcontainers, OpenTelemetry, SBOM (Syft) + Trivy,
blue-green vía el Traefik compartido (routers con peso), DataLoader contra N+1, contract test
del SDL, y el rediseño de identidad para SaaS multi-familia (cuenta del padre, sin credencial
propia del menor).

## Patrones que sí resuelven un problema aquí

`Strategy` (rúbrica por técnica) · `Port/Adapter` (`LLMProvider`, permite modo *fake* en
tests y pruebas de carga sin gastar tokens) · `Repository` (Prisma tras interfaces) ·
`State machine` (ciclo del envío) · `Idempotency key` (doble tap en móvil) ·
`Circuit breaker + backoff` (Anthropic) · `Outbox` (persistir antes de encolar).

## Anti-patrones prohibidos

- "Construye la app completa" en una sola sesión. Rebanada por rebanada.
- Inventar nombres de campo: si no está en el schema o el SDL, no existe.
- Mocks donde deben ir Testcontainers (Postgres y Redis reales en integración).
- Tipos de rúbrica escritos a mano en TS o Python.
- Feedback de más de 3 puntos, o tono de "está mal".
