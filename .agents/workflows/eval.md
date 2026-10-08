# Eval Workflow

Genera y ejecuta una batería de pruebas de activación para validar la precisión de un agente o rule. Invocar con `/eval` seguido del nombre del agente a evaluar.

## Pasos

### Paso 1 — Identificar Agente
Confirmar el agente objetivo de la evaluación y leer su `description` y reglas completas.

### Paso 2 — Generar Batería Should-Trigger (10 casos)
Generar 10 queries que DEBEN activar el agente. Variar: terminología técnica, lenguaje coloquial, contexto implícito, lenguaje en inglés y español.

### Paso 3 — Generar Batería Should-Not-Trigger (10 casos)
Generar 10 queries que NO deben activar el agente. Incluir casos limítrofes y temas adyacentes que podrían confundir.

### Paso 4 — Ejecutar y Medir
Para cada caso registrar: `[✅ CORRECTO]` o `[❌ ERROR: tipo]`.
Tipos de error: `Falso Positivo` (activó cuando no debía) | `Falso Negativo` (no activó cuando debía).

### Paso 5 — Reporte
```
Agente: <nombre>
Should-Trigger:     X/10 ✅
Should-Not-Trigger: X/10 ✅
Precisión total:    X%
Acción requerida:   [Ninguna | Refinar description | Refinar triggers]
```

### Paso 6 — Corrección (si precisión < 100%)
Proponer ajuste mínimo en `description` o reglas del agente para corregir los errores detectados. No reescribir lo que ya funciona.
