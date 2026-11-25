# CLAUDE.md — Control Moto

Guía para trabajar en este repositorio. La app es una **PWA en español (Colombia)** para controlar una
moto (Hero Hunk 160R 4V, 163 cc): documentos legales, mantenimiento por kilometraje, gastos, bóveda de
documentos y predicción de kilometraje. Toda la interfaz y los mensajes van en **español neutro colombiano**.

## Despliegue y enlaces

| Qué | Dónde |
|---|---|
| App publicada | https://control-moto-2feidy.v2.appdeploy.ai/ |
| Plataforma | **AppDeploy** (MCP), `app_id` = `control-moto-2feidy`, plantilla `react-vite`, tipo `frontend+backend` |
| Backend público | `https://api-v2.appdeploy.ai/app/control-moto-2feidy/api/...` (el dominio de la app sirve el SPA en `/api`) |
| Repositorio | GitHub privado `SteevenOyuela/control-moto`, rama `main` |
| Cron | `cron.json` → `dailyReminders` todos los días a las 07:00 `America/Bogota` |

### Reglas de despliegue (importante)

- La **fuente de verdad desplegada es el snapshot de AppDeploy**, no la carpeta local. AppDeploy normaliza
  algunos archivos con Prettier (2 espacios, ancho 80, `arrowParens: avoid`) mientras que los archivos
  locales usan 4 espacios. Antes de enviar `diffs`, usa `src_grep`/`src_read` para copiar los anclajes
  **exactos** del snapshot. Para archivos muy cambiados, envía `content` completo.
- Archivos nuevos que se envían con `content` se guardan tal cual (sin reformatear).
- `@appdeploy/client` y `@appdeploy/sdk` los inyecta la plataforma: **no** van en `package.json`.
- Vite quedó en `^8` (AppDeploy lo actualizó). Los íconos PNG están en `public/resources/` y se subieron
  como *resources* (`upload_resources` + `set_app_resources`), no como texto.
- Después de cada despliegue: `get_app_status` hasta `ready`, revisar errores y luego commit + push.

## Verificación local

No se puede compilar con Vite localmente porque `@appdeploy/*` no existe en npm. Se usan *stubs*:

```bash
npx tsc -p tsconfig.check.json     # frontend (stub de @appdeploy/client en .local-types/client)
npx tsc -p tsconfig.backend.json   # backend (stubs de @appdeploy/sdk y crypto en .local-types/)
```

Vista previa visual con datos simulados (servidor `prediction-preview` en `.claude/launch.json`, puerto 5199):
`/` = panel de predicciones, `/vault.html` = bóveda (cliente simulado en `.local-types/preview/client-mock.ts`).
`.local-types/`, `tsconfig.check.json`, `tsconfig.backend.json` y `.claude/` están en `.gitignore`.

## Arquitectura

```
backend/
  index.ts      Rutas (router del SDK), lógica de negocio, recordatorios del cron
  predict.ts    Modelo predictivo de kilometraje (sin dependencias)
src/
  App.tsx → ui/Root.tsx   Auth, splash, encabezado, pestañas, toasts, caché offline
  ui/Home.tsx + Insights.tsx + Prediction.tsx   Inicio, avisos y análisis predictivo
  ui/Legal.tsx (+ Vault.tsx, vaultStore.ts, pdf.ts)  Vencimientos y bóveda de documentos
  ui/Maint.tsx (+ FilterChips.tsx)                   Taller
  ui/Expenses.tsx (+ FuelPage.tsx, ReceiptScan.tsx)  Gastos, gasolina y escáner de facturas
  ui/Settings.tsx (+ LogoSettings.tsx, SiriShortcut.tsx, ProfileForm.tsx)
  ui/components.tsx  Card, Btn, Field, Modal, Confirm, Chip, Progress, Segmented, Stat
  ui/Cropper.tsx     Recorte manual (esquinas, mover, girar)
  ui/lib.ts          Formato es-CO, caché localStorage, tema, logo, último precio de gasolina
```

- **Flujo de datos:** casi todas las mutaciones devuelven el **dashboard completo** (`dashboardResponse`), y
  el frontend lo reemplaza con `run(promise, mensaje)`. Se guarda en `localStorage` para modo sin conexión.
- **Base de datos (SDK `db`):** tablas por usuario `<base>_<userKey>`: `docs`, `maint`, `service`, `fuel`,
  `odo`, `expense`, `vault`. Globales: `profiles` (id = userKey) y `shortcut_tokens` (id = sha256 del token).
- **Storage:** `vault/<userKey>/<archivo>` (páginas de la bóveda) y `logo/<userKey>.png`.
- **Bóveda:** cada documento tiene `pages[]` (los antiguos solo `path`; `pagesOf()` los normaliza). Copia
  offline en IndexedDB con claves `id:n` (los antiguos usaban `id`). El PDF para compartir/descargar se
  genera en el celular con `pdf.ts` (JPEG por página en A4, sin librerías).
- **IA (SDK `ai.extract`):** lectura de vencimientos en la bóveda y de facturas (gastos, tanqueos y
  servicios del taller). Los esquemas están en `EXTRACT_SCHEMA` y `receiptSchema()`.
- **Predicción (`predict.ts`):** lecturas diarias → limpieza de atípicos → mínimos cuadrados ponderados por
  día de la semana (vida media 30 días, ridge = 2 hacia el promedio) → banda del 80 % con
  `σ²·h + (h·se)²`. `withPrediction()` en `index.ts` reemplaza las fechas de mantenimiento.
- **Atajo de Siri:** `POST /api/shortcut/km` es **pública** y se autentica con un token `cm_…` cuyo hash
  vive en `shortcut_tokens`. Nunca exponer ni registrar tokens.

## Convenciones y reglas de producto

- **El usuario confirma siempre** cualquier cambio sugerido por la IA (vencimientos leídos, servicios
  detectados en facturas). Nada se guarda sin una confirmación explícita.
- Fechas `YYYY-MM-DD` en zona `America/Bogota`; dinero en COP sin decimales; km enteros.
- Validar en el backend aunque el frontend ya valide; los errores se devuelven con `error(mensaje, código)`
  en español y el frontend los muestra con `errMsg()`.
- Diseño móvil primero (iPhone): respetar `env(safe-area-inset-*)`, campos de fecha a ancho completo en
  móvil (`col-span-2 sm:col-span-1`), modo oscuro con clases `dark:`.
- Gráficas: SVG propio, una sola serie en rojo de la marca, tooltip al tocar y leyenda; validar en claro y
  oscuro.
- Mensajes de commit en español, describiendo el cambio funcional.
