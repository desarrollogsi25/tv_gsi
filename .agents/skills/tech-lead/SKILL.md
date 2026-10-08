---
name: tech-lead
description: Ejecuta pipelines de desarrollo completos end-to-end sin intervención del usuario, coordinando todos los agentes especializados en orden correcto y entregando archivos listos para producción. Usar cuando se necesite construir un módulo completo desde cero.
---

# Tech Lead — End-to-End Pipeline Skill

## Cuándo usar esta skill
- El usuario pide construir un feature o módulo completo
- Se necesita coordinar más de 3 agentes en secuencia
- El resultado debe ser archivos listos sin instrucciones manuales

## Orden de Ejecución

1. `@arch` + `@api` → Estructura base y endpoints
2. `@ui_expert` → Interfaz (declarar stack explícitamente)
3. `@rust_master` → Solo si hay procesamiento de alto rendimiento
4. `@flow_master` → Diagrama del módulo generado
5. `@docs_expert` → MD técnico + HTML para usuario
6. `@sec` → Auditoría OWASP completa
7. `@db_master` → Validación final de esquema

## Definición de Done
```
🛡️ STATUS: [APPROVED 🟢]
🚀 Archivos listos. Sin acción requerida del usuario.
```
