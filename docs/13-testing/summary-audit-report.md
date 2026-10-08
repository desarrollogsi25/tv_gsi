# Nexus TV Enterprise — Informe Ejecutivo de Auditoría de Calidad y Pruebas

> **Código de Documento:** QA-REP-001  
> **Versión:** v1.0  
> **Fecha:** 2026-10-08  
> **Auditor / Responsable:** QA Lead & Senior Software Architect  
> **Estado:** Auditoría Completada  
> **Estándares Aplicados:** ISO/IEC 25010 (Calidad del Producto Software) & ISO/IEC 27001:2022 (Control de Acceso A.9)  

---

## 1. Resumen Ejecutivo

Durante el ciclo de auditoría técnica y funcional sobre la plataforma **Nexus TV Enterprise (v2.0.0 Dual-Hub)**, se ejecutaron exhaustivamente **15 casos de prueba** sobre infraestructura contenerizada, motores de sincronización WebSocket, persistencia relacional en PostgreSQL y la interfaz web React.

* **Total de Casos de Prueba Ejecutados:** **15**
* **Distribución de Resultados:**
  * **Aprobados (PASS):** **10** (66.7%)
  * **Aprobados con Observaciones (PASS c/obs):** **1** (6.7%)
  * **Fallidos (FAIL):** **4** (26.6%)
* **Bugs Formales Confirmados:** **5** (`BUG-001` a `BUG-005`)
* **Riesgos Técnicos y Operativos Registrados:** **8** principales consolidados en [risk-register.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/risk-register.md)

---

## 2. Evaluación de Calidad según ISO/IEC 25010

| Característica de Calidad | Calificación | Diagnóstico de Auditoría |
| :--- | :---: | :--- |
| **Eficiencia de Rendimiento (Performance Efficiency)** | **Excelente** | El hub de control bidireccional Socket.IO (`/control`) exhibe latencias de transporte extremo a extremo $\le 5\text{ ms}$ en comandos de control remoto, transiciones de broadcast y despacho de payloads, con tiempos de respuesta en API Node.js de 2 a 3 ms en entorno local. |
| **Seguridad (Security)** | **Deficiente** | Violación crítica del control ISO/IEC 27001 A.9. La totalidad de los 14 endpoints administrativos carecen de barrera de autenticación y exponen políticas de CORS universales (`*`), permitiendo a cualquier estación en red local emitir mutaciones y controlar pantallas. |
| **Adecuación Funcional (Functional Suitability)** | **Comprometida** | La segmentación por turnos horarios (`start_time`/`end_time`) es completamente descartada en el query SQL y en el reproductor web (`BUG-001`), proyectando los 45 contenidos del día de manera indiferenciada las 24 horas. |
| **Confiabilidad (Reliability)** | **Riesgo Alto** | Inconsistencia física del 100% en medios locales (28 de 28 archivos faltantes en disco). La ausencia de backoff en el evento `onError` de imágenes (`BUG-002`) provoca un bucle acelerado de re-renderizados que satura el hilo principal del navegador. |
| **Mantenibilidad (Maintainability)** | **Aceptable** | Separación modular clara en arquitectura dual-hub (`/tv` y `/control`), persistencia estructurada y servicios en segundo plano (`cron.js`), con oportunidad de modularización de middlewares de autenticación. |
| **Usabilidad (Usability)** | **Mejorable** | Interfaz de administración no responsiva (cero reglas `@media`), con colapso de tablas en viewports $\le 1024\text{px}$ (`BUG-003`) e invocación de diálogos nativos bloqueantes (`alert`/`confirm`) que suspenden el event loop (`RSK-017`). |

---

## 3. Matriz de Priorización de Correcciones

La siguiente tabla consolida los defectos descubiertos, ordenados estrictamente por nivel de severidad y criticidad operativa para el negocio:

| Prioridad | ID Defecto | Título del Hallazgo | Archivo Destino Sugerido | Estimación de Impacto |
| :---: | :---: | :--- | :--- | :--- |
| **P0** | [BUG-005](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-005-unauthenticated-admin-api.md) | Ausencia total de autenticación en API administrativa y CORS irrestricto | [nx_tv.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/nx_tv.js)<br>[src/routes/admin.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/admin.js) | **Crítico:** Exposición pública de control total sobre las pantallas y biblioteca de medios sin verificación de identidad. |
| **P1** | [BUG-001](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-001-schedule-ignored.md) | Omisión de franjas horarias (`start_time`/`end_time`) en playlists | [src/routes/tv.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/tv.js)<br>[frontend/src/components/TVPlayer.jsx](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/frontend/src/components/TVPlayer.jsx) | **Alto:** Incumplimiento de la programación corporativa de turnos (mañana/tarde/noche). |
| **P1** | [BUG-002](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-002-missing-media-404.md) | Inconsistencia de 28 archivos 404 en disco y bucle acelerado sin backoff en `<img>` | [frontend/src/components/TVPlayer.jsx](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/frontend/src/components/TVPlayer.jsx)<br>[src/services/cron.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/services/cron.js) | **Alto:** Parpadeo continuo en pantalla negra, saturación del CPU (100%) y riesgo de bloqueo del navegador Kiosk. |
| **P2** | [BUG-003](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-003-static-admin-layout.md) | Layout estático no responsivo (0 reglas `@media`) y truncamiento en tablet | [frontend/src/components/Admin.css](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/frontend/src/components/Admin.css) | **Medio:** Inaccesibilidad de controles administrativos y tablas en resoluciones $\le 1024\text{px}$. |
| **P2** | [BUG-004](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/11-incidents/bugs/BUG-004-unnormalized-days-accent.md) | Falta de normalización de días con tildes (`miercoles` vs `miércoles`) en PostgreSQL | [src/routes/admin.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/admin.js)<br>[src/routes/tv.js](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/src/routes/tv.js) | **Medio:** Fallos silenciosos donde contenidos programados nunca se reproducen los días miércoles o sábados. |

---

## 4. Trazabilidad de Evidencias

* **Reportes de Prueba de Detalle:**
  * Infraestructura y Playlists: [TC-001.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-001.md), [TC-002.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-002.md), [TC-003.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-003.md)
  * Responsividad y UX: [TC-004.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-004.md), [TC-005.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-005.md), [TC-006.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-006.md)
  * Pairing y Broadcast en Vivo: [TC-008.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-008.md), [TC-009.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-009.md), [TC-010.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-010.md)
  * Control Remoto y Resiliencia Offline: [TC-011.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-011.md), [TC-012.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-012.md), [TC-013.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-013.md)
  * Seguridad y Servicios Cron: [TC-014.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-014.md), [TC-015.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/results/TC-015.md)
* **Matriz de Casos de Prueba Central:** [test-cases.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/test-cases.md)
* **Registro de Riesgos Consolidado:** [risk-register.md](file:///c:/Users/DEVELOPMENT/Downloads/tv_gsi/docs/13-testing/risk-register.md)
