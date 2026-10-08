# Versionar Workflow

Genera commits semánticos, changelogs y planes de migración cuando cambia la lógica de un agente o la estructura del IDE. Invocar con `/versionar`.

## Pasos

### Paso 1 — Clasificar el Cambio
Determinar el tipo de cambio:
- `feat:` → Nueva capacidad o comando en la lógica del agente
- `fix:` → Corrección de comportamiento o ajuste de triggers
- `chore(ide-sync):` → Migración de rutas por update de Antigravity IDE (sin cambio de lógica)

### Paso 2 — Generar Mensaje de Commit
Formato Conventional Commits:
```
<tipo>(<scope>): <descripción imperativa en minúsculas>

[OPCIONAL] Cuerpo explicando el por qué del cambio.
[OPCIONAL] BREAKING CHANGE: descripción si aplica.
```
Ejemplo: `refactor(hexagonal-arch): tighten layer dependency rules for EF Core 9`

### Paso 3 — Generar CHANGELOG Entry
```markdown
## [vX.Y.Z] - YYYY-MM-DD
### Added
- <nuevas capacidades>
### Changed
- <comportamientos modificados>
### Fixed
- <bugs corregidos>
### Chore
- <migraciones de IDE o estructura>
```

### Paso 4 — Estrategia de Rollback
Si el cambio es `feat` o `refactor`: documentar el commit anterior como punto de rollback.
Si es `chore(ide-sync)`: la lógica del System Prompt NO cambió — rollback es solo mover archivos de vuelta.

### Paso 5 — Validación Post-Migración
Ejecutar `/eval` sobre el agente modificado. Confirmar precisión al 100% antes de mergear.
