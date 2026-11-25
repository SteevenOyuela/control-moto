<div align="center">

# 🏍️ CONTROL MOTO

### Tu moto bajo control: papeles al día, taller a tiempo, gastos claros y una IA que predice tu kilometraje

<img src="public/resources/icon-512.png" alt="Ícono de Control Moto" width="160"/>

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-3-06B6D4?logo=tailwindcss&logoColor=white)
![PWA](https://img.shields.io/badge/PWA-iPhone%20%2F%20Android-5A0FC8?logo=pwa&logoColor=white)
![AppDeploy](https://img.shields.io/badge/Backend-AppDeploy-red)
![IA](https://img.shields.io/badge/IA-Predicci%C3%B3n%20%2B%20OCR-8A2BE2)

</div>

---

## 📘 Descripción General

**Control Moto** es una **aplicación web progresiva (PWA)** pensada para motociclistas en **Colombia**, construida
alrededor de una **Hero Hunk 160R 4V (163 cc)**. Junta en un solo lugar todo lo que un motero suele llevar en la
cabeza (o en un papelito): el **SOAT**, la **revisión técnico-mecánica**, el **impuesto**, la **licencia**, los
**mantenimientos** por kilometraje, la **gasolina** y los **gastos** del día a día.

Se instala en la pantalla de inicio del celular, funciona **sin conexión** para mostrar tus documentos en un
retén y usa **inteligencia artificial** para leer facturas y documentos y para **predecir cuándo te toca cada
mantenimiento**, a partir de tu forma real de rodar.

> 🔗 App publicada: **https://control-moto-2feidy.v2.appdeploy.ai/**

---

## 🎯 Objetivos del Proyecto

- Evitar **multas, grúas y partes** por documentos vencidos, con alertas antes de que pase.
- Llevar el **mantenimiento por kilometraje** sin depender de la memoria ni del taller.
- Saber **cuánto cuesta de verdad la moto**: consumo en km/galón, costo por kilómetro y gastos por mes.
- Aplicar **IA de forma útil**: un modelo predictivo propio y lectura automática (OCR) de facturas y documentos.
- Ofrecer una experiencia **móvil primero** (iPhone), con modo oscuro y uso sin conexión.

---

## 🧭 Módulos

| Módulo | Qué hace |
|---|---|
| 🏠 **Inicio** | Kilometraje actual, km estimado hoy, próximo cambio de aceite con rango de fechas, avisos inteligentes y gastos del mes. |
| 🛡️ **Legal** | SOAT, RTM, licencia e impuesto con semáforo de vencimiento. Calcula si pagas **impuesto vehicular** (> 125 cc, 1,5 % del avalúo) o solo **semaforización**, y qué licencia necesitas (**A1/A2**). |
| 🗄️ **Bóveda** | Documentos escaneados con la cámara, **varias páginas por documento** (frente y reverso), recorte manual, copia **sin conexión**, **compartir/descargar como PDF** y lectura de vencimientos con IA. |
| 🔧 **Taller** | 14 mantenimientos de la Hunk 160R 4V (aceite, kit de arrastre, pastillas, válvulas…), con progreso, filtros rápidos e historial de servicios. |
| 💸 **Gastos** | Tanqueos en **galones o pesos** con vista previa en vivo, km/gal y km/L, otros gastos (parqueadero, lavada, peajes, accesorios…) e historial por mes. |
| ⚙️ **Ajustes** | Tema claro/oscuro, notificaciones, **Atajo de Siri**, logo propio y datos de la moto. |

---

## 🤖 Inteligencia artificial

### 📈 Modelo predictivo de kilometraje

El corazón de la app. Con cada lectura del odómetro (manual, tanqueo, taller o Siri), el modelo:

1. **Limpia los datos:** una lectura por día y detección de **lecturas raras** (km que bajan, saltos
   imposibles o atípicos frente a tu ritmo, con mediana y desviación robusta). Tú decides si confirmarlas o
   eliminarlas.
2. **Aprende tu patrón por día de la semana:** mínimos cuadrados ponderados (lo reciente pesa más, vida media
   de 30 días) con **regularización ridge** hacia el promedio para no inventar patrones con pocos datos.
3. **Calcula la incertidumbre:** proyecta los próximos días con una **banda del 80 %** y un nivel de
   **confianza** (baja · media · alta).

| Resultado | Ejemplo |
|---|---|
| 🗓️ Fecha esperada | “Cambio de aceite: **1 dic**” |
| 📏 Rango probable | “entre el **29 nov** y el **3 dic**” |
| 📊 Ritmo semanal | Lun 34 · … · **Sáb 110** · Dom 27 km |
| 🔔 Aviso proactivo | “En ~5 días llegas al cambio de aceite; el sábado 22 nov es buen momento.” |

> 🧪 Validado con datos simulados: promedio estimado **45,6 km/día** frente a **45,7** reales y detección del
> error de digitación sembrado a propósito.

### 🧾 Lectura de documentos y facturas (OCR)

| Escaneas… | La IA devuelve… | Tú… |
|---|---|---|
| 📄 SOAT / RTM / licencia | Tipo, fecha de vencimiento, número, entidad y placa | Confirmas antes de actualizar el vencimiento |
| 🧾 Factura de gastos | Valor, fecha, establecimiento y categoría | Deslizas para corregir la categoría y guardas |
| ⛽ Factura de gasolina | Galones y precio por galón | Agregas el km y queda como tanqueo |
| 🔧 Factura del taller | **Qué mantenimientos de tu plan** aparecen y sus costos | **Confirmas** cuáles sí se hicieron |

> ✅ Regla de oro: **ninguna sugerencia de la IA se guarda sin tu confirmación.**

---

## 🔔 Alertas

Todos los días a las **7:00 a. m.** (hora Colombia) se revisa todo y llega una notificación push si:

- 📄 Un documento vence en **15, 5 o 1 día** (o ya venció).
- 🔧 Un mantenimiento se acerca según la **predicción** (con rango y sugerencia de fin de semana).
- ⏱️ Llevas **4 días** sin registrar el kilometraje.
- ⛽ Tu último tanque rindió **15 % menos** que tu promedio (cadena, llantas o filtro de aire).

---

## 🎙️ Atajo de Siri

Como una PWA no puede registrar esquemas tipo `controlmoto://`, la app genera un **token personal** y una ruta
pública. Con la app **Atajos** de iOS:

```
“Oye Siri, registrar kilometraje”  →  ¿Cuántos km marca el tablero?  →  ✅ Listo: 12.345 km (+48 km)
```

Y con una **automatización de Bluetooth** se dispara sola al apagar el intercomunicador del casco. El token se
puede regenerar o revocar desde Ajustes en cualquier momento.

---

## 🗄️ Bóveda sin conexión

- 📸 **Escaneo con la cámara** y **recorte manual** (arrastrar esquinas, mover, girar).
- 📑 **Varias páginas por documento**: frente, reverso y las que necesites (hasta 10), reordenables.
- 📴 Copia en el celular (**IndexedDB**) para mostrarla en un retén **sin datos**.
- 📤 **Compartir o descargar** como **un solo PDF** generado en el propio celular (sin librerías externas):
  WhatsApp, correo o “Guardar en Archivos”.

---

## 🏗️ Arquitectura

```
┌──────────────────────────── PWA (React + Vite + Tailwind) ────────────────────────────┐
│  Inicio · Legal/Bóveda · Taller · Gastos · Ajustes                                     │
│  Caché offline (localStorage + IndexedDB) · Recorte · PDF en el celular · Gráficas SVG │
└───────────────────────────────────────┬────────────────────────────────────────────────┘
                                        │ api.* (autenticado)
┌───────────────────────────────────────▼────────────────────────────────────────────────┐
│  Backend AppDeploy (TypeScript, serverless)                                             │
│  router · auth · db (tablas por usuario) · storage · ai.extract · notificaciones push  │
│  predict.ts (modelo) · cron diario 07:00 America/Bogota                                 │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

| Carpeta | Contenido |
|---|---|
| `backend/index.ts` | Rutas, reglas de negocio, recordatorios del cron |
| `backend/predict.ts` | Modelo predictivo de kilometraje |
| `src/ui/` | Pantallas y componentes de la PWA |
| `public/resources/` | Íconos de la app |
| `cron.json` | Recordatorio diario |

---

## 🛠️ Tecnologías

| Capa | Herramientas |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, lucide-react |
| Backend | AppDeploy SDK (router, auth, db, storage, ai, notifications, cron) |
| IA | Modelo estadístico propio (regresión ponderada + ridge) y `ai.extract` para OCR estructurado |
| Offline | `localStorage` (tablero) e `IndexedDB` (bóveda) |
| iOS | PWA con íconos PNG, zona segura del notch y Atajos de Siri |

---

## 🗺️ Hoja de ruta

- [x] **Fase 1 — MVP:** legal, taller, gasolina y alertas.
- [x] **Fase 2:** bóveda de documentos y gastos.
- [x] **Mejoras:** recorte, escaneo de facturas, logo, filtros, Atajo de Siri.
- [x] **Fase 3:** modelo predictivo, avisos inteligentes y pantalla de predicciones.
- [x] **Bóveda multipágina** con compartir y descargar en PDF.

---

<div align="center">

Hecho con ❤️ y gasolina por **[@SteevenOyuela](https://github.com/SteevenOyuela)** · Estudiante de Ingeniería en Inteligencia Artificial 🇨🇴

</div>
