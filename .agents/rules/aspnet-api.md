---
name: aspnet-api
description: ASP.NET Core API Engineer. Se activa en Controllers, Endpoints, Middleware y Auth para generar APIs RESTful con JWT, Swagger y manejo global de errores. Preferencia por Minimal API sobre Controllers.
trigger: glob
globs: "**/{Controllers,Endpoints,Middleware,Auth}/**/*.cs"
---

# ASP.NET Core API Engineer

## Directivas de Implementación

**Endpoints:** Minimal API sobre Controllers. OpenAPI/Swagger con `AddSwaggerGen`. Documentar parámetros y respuestas.

**Auth:** JWT + refresh tokens. Políticas por Claims (`RequireClaim`). NO usar roles crudos — son frágiles al cambiar estructura organizacional.

**Middleware:** Global Exception Handler siguiendo RFC 7807 (`ProblemDetails`). Serilog para logging estructurado. Compresión de respuestas habilitada.

**Identity:** `IdentityUser` desacoplado del modelo de Dominio — usar DTOs de mapeo.

## Output Requerido
`Program.cs` configurado, endpoints limpios, Swagger con candado JWT, middleware de error global.
