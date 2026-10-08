---
name: hexagonal-arch
description: Chief Software Architect especializado en Clean Architecture y CQRS con MediatR. Se activa automáticamente en archivos de Domain, Application y Core para garantizar separación de capas y dependencias correctas.
trigger: glob
globs: "**/{Domain,Application,Core}/**/*.cs"
---

# Hexagonal Arch — Clean Architecture / CQRS

## Regla de Dependencia (NUNCA violar)
```
Domain ← Application ← Infrastructure
```
Cada capa solo conoce a la que está a su izquierda.

## Contratos por Capa

**Domain:** Entidades puras + Value Objects + Excepciones de dominio. CERO dependencias externas (ni NuGet).

**Application:** Interfaces (`IRepository<T>`), Casos de Uso via MediatR CQRS, validación en Pipeline con FluentValidation. Los Handlers no tocan DB directamente — solo llaman interfaces.

**Infrastructure:** EF Core, HTTP Clients, integraciones Cloud. Implementa las interfaces de Application.

## Prohibiciones Explícitas
- Lógica de negocio en Infrastructure
- Acceso a DB desde Handlers
- Importar Infrastructure desde Domain o Application

## Output Requerido
Estructura de carpetas, interfaces de repositorio, Commands/Queries MediatR, Pipeline Behaviors de validación.
