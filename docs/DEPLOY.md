# Deploy (rebanada 12)

`tag -> build -> GHCR -> SSH al droplet -> migración -> up`, disparado por
`.github/workflows/deploy.yml`. Este documento es la referencia rápida — la
lógica real vive en el workflow, comentada ahí también.

## Cómo se despliega una versión nueva

1. Mergea tu rama a `main` con CI verde.
2. Crea y empuja un tag semver: `git tag v1.2.3 && git push origin v1.2.3`.
3. El workflow `deploy` arranca solo. `build-and-push` compila las 3 imágenes
   (`taller-evaluator`, `taller-bff`, `taller-web`) y las sube a GHCR con ese tag
   y también como `:latest`.
4. El job `deploy` queda pausado esperando aprobación manual (ver
   [Gate de aprobación](#gate-de-aprobación) abajo). Un reviewer lo aprueba desde
   la pestaña Actions.
5. Al aprobar: primero se genera `rubric_models.py`/`rubric.zod.ts` (Pydantic +
   Zod, desde `rubric.schema.json`) en el runner de CI y se copian por `scp` a
   `DROPLET_APP_DIR/packages/rubric/generated/` — ese directorio está en
   `.gitignore` (es código generado) y el `evaluator` lo necesita vía bind
   mount (ver `docker-compose.yml`), así que nunca queda ahí solo con el
   `git checkout`. Nunca se genera en el droplet mismo (regla dura: nunca
   compilar ahí).
6. Luego, SSH al droplet: corre `prisma migrate deploy` con la imagen
   nueva del bff, luego `docker compose pull && docker compose up -d`, espera
   20s y confirma que los 5 servicios reporten `healthy`. Si alguno no lo hace,
   el job falla explícitamente (no se queda "verde" con algo roto).
7. Un smoke test final golpea `https://taller.sikno.com.mx/health` y
   `https://api-taller.sikno.com.mx/health` desde fuera del droplet (a través del
   Traefik compartido), confirmando que el dominio público responde de verdad.

## Setup inicial (una sola vez, antes del primer deploy real)

### En GitHub (Settings del repo)

- **Secrets and variables > Actions > Secrets**:
  - `DROPLET_HOST` — IP o hostname del droplet.
  - `DROPLET_USER` — usuario SSH (el que tiene permiso sobre el directorio del repo y el grupo `docker`).
  - `DROPLET_SSH_KEY` — llave privada SSH correspondiente. Genera un par dedicado
    para CI (`ssh-keygen -t ed25519 -f deploy_key -N ""`), agrega la pública a
    `~/.ssh/authorized_keys` del droplet, y la privada aquí. No reuses tu llave
    personal.
- **Secrets and variables > Actions > Variables**:
  - `DROPLET_APP_DIR` — ruta absoluta del repo clonado en el droplet (ej.
    `/root/taller-engine`). No es secreta, por eso va en Variables, no Secrets.
- **Settings > Environments > `production`**: créalo y agrega al menos un
  *required reviewer*. Esto es el gate — sin este paso configurado, el job
  `deploy` corre sin pausa apenas termina `build-and-push`.

### En el droplet

- El repo debe estar clonado en `DROPLET_APP_DIR`, con su propio `.env`
  conteniendo (además de lo que ya pide `docker-compose.yml`:
  `POSTGRES_PASSWORD`, `ANTHROPIC_API_KEY`, `STUDENTS`, `COOKIE_SECRET`,
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).
  `STUDENTS` es `slug:pin:Nombre` separado por comas, uno por hijo (ej.
  `jorge:1234:Jorge,georgina:5678:Georgina`) — agregar o quitar un
  estudiante es editar esta variable y reiniciar el contenedor `bff`. Las
  tres variables `VAPID_*` (recordatorio diario por Web Push) se generan
  una sola vez con `npx web-push generate-vapid-keys`.
  - `GHCR_OWNER` — el owner/org de GitHub bajo el que se publican las imágenes
    (normalmente el usuario dueño del repo). El workflow también lo agrega solo
    la primera vez que despliega, pero es más simple dejarlo puesto desde antes.
- Las imágenes de GHCR deben ser accesibles: si el paquete es privado, corre
  `docker login ghcr.io` una vez en el droplet con un token de lectura
  (`read:packages`). Si el repo es público, los paquetes de GHCR heredan esa
  visibilidad y no hace falta login para *pull*.
- **`content/curriculum.yaml` no llega por CI** (regla dura: `content/` nunca
  entra al repo público, así que el pipeline no tiene forma de generarlo ni de
  copiarlo). Es un paso manual de una sola vez — súbelo por `scp` desde donde
  sí exista el archivo:
  ```bash
  scp -i ~/.ssh/<tu-llave> content/curriculum.yaml root@<droplet>:${DROPLET_APP_DIR}/content/curriculum.yaml
  ```
  Como es un archivo sin versionar, `git checkout` en cada deploy no lo toca
  ni lo borra — una vez ahí, sobrevive a todos los deploys futuros. El seed de
  lecciones (`docker compose run --rm bff node dist/seedCurriculum.js`, parte
  del job `deploy`) falla con `ENOENT` si este archivo no está presente.
  Si el currículo cambia, repite el `scp` y vuelve a correr el seed a mano
  (o dispara un deploy nuevo, que ya lo hace solo).
- `docker-compose.override.yml` **nunca** se copia al droplet — es solo para
  desarrollo local (le agrega `build:` a evaluator/bff/web y expone el puerto
  de Postgres). Si por error termina ahí, `docker compose` intentaría compilar
  de fuente en el droplet, violando la regla dura del proyecto.

## Rollback

**Camino recomendado:** vuelve a correr el mismo workflow con el tag anterior.

1. Pestaña **Actions > deploy > Run workflow**.
2. En el input `tag`, escribe el tag anterior conocido-bueno (ej. `v1.2.2`).
   Encuéntralo con `git tag --sort=-creatordate | head -5` o en la lista de
   tags de GitHub.
3. Aprueba el gate de `production` cuando lo pida.

Esto reconstruye y vuelve a subir las imágenes de ese tag (las de GHCR no se
borran solas, así que en la práctica solo hace falta re-taggear) y corre el
pipeline completo, incluida la migración. **Esto es seguro**: `prisma migrate
deploy` nunca revierte una migración, solo aplica las que falten — si el tag
anterior no trae migraciones nuevas respecto a lo que ya está aplicado, ese
paso simplemente no hace nada.

**Camino manual** (si el workflow mismo está roto): SSH directo al droplet.

```bash
cd <DROPLET_APP_DIR>
GHCR_OWNER=<owner> TALLER_VERSION=<tag-anterior> docker compose pull
GHCR_OWNER=<owner> TALLER_VERSION=<tag-anterior> docker compose up -d
```

No hace falta editar `.env` a mano si usas las env vars inline como arriba —
pero si quieres que el cambio persista para el próximo `docker compose up -d`
corrido sin esas variables (ej. tras un reboot), actualiza la línea
`TALLER_VERSION=` en el `.env` del droplet también.

## Qué NO hace este pipeline (a propósito, fuera de alcance de la rebanada 12)

- No hay blue-green ni rollout gradual — es swap directo (`docker compose up
  -d` reemplaza los contenedores). Para un proyecto de una sola familia, el
  downtime de unos segundos durante el swap es aceptable; blue-green vía el
  Traefik compartido queda en el Track B (ver `CLAUDE.md`).
- No hay rollback automático si el smoke test post-deploy falla — el job
  falla y notifica, pero alguien tiene que decidir y ejecutar el rollback
  (manual o re-disparando el workflow). Un rollback automático que se dispara
  solo agrega una superficie de fallo propia (¿y si el rollback también
  falla?) que no vale la pena para este volumen de deploys.
