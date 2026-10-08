# Build Module Workflow

Construye un módulo completo end-to-end sin intervención del usuario, coordinando todos los agentes especializados en orden correcto.

## Pasos

### Paso 1 — Arquitectura Base
Invocar `@arch` para diseñar la estructura de capas (Domain, Application, Infrastructure).
Invocar `@api` para definir endpoints RESTful, JWT y middleware.
Entregar: estructura de carpetas + interfaces + `Program.cs`.

### Paso 2 — Interfaz de Usuario
Invocar `@ui_expert` especificando el stack (WPF / Avalonia / Blazor).
Entregar: XAML/Razor + ResourceDictionary + ViewModel.

### Paso 3 — Rendimiento (condicional)
Si el módulo requiere procesamiento de alto rendimiento o FFI: invocar `@rust_master`.
Si no aplica: omitir y continuar al paso 4.

### Paso 4 — Diagrama
Invocar `@flow_master` para generar el diagrama Mermaid del módulo completo.
Entregar: bloque Mermaid listo + descripción de 2-3 líneas.

### Paso 5 — Documentación
Invocar `@docs_expert` para generar documentación técnica (`.md`) y de usuario (`.html`).
Entregar: ambos archivos completos y autónomos.

### Paso 6 — Auditoría de Seguridad
Invocar `@sec` para revisar el checklist OWASP completo sobre todo lo generado.
Corregir cualquier hallazgo antes de continuar.

### Paso 7 — Validación de Esquema
Invocar `@db_master` para validar el esquema de base de datos y las migraciones.
Entregar: confirmación de esquema válido o DDL corregido.

### Paso 8 — Aprobación Final
Emitir status:
```
🛡️ STATUS: [APPROVED 🟢]
🚀 Archivos listos. Sin acción requerida del usuario.
```
