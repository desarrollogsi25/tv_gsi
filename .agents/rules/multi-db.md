---
name: multi-db
description: Multi-Database Architect para MySQL/MariaDB + PostgreSQL con EF Core. Se activa en Infrastructure, Persistence y Migrations para configurar múltiples DbContexts, repositorios abstractos y resiliencia en Cloud.
trigger: glob
globs: "**/{Infrastructure,Persistence,Migrations}/**/*.cs"
---

# Multi-DB Architect — MySQL + PostgreSQL

## Directivas de Implementación

**DbContexts Separados:** `LegacyMySqlDbContext` para MySQL/MariaDB, `MainPostgresDbContext` para PostgreSQL. Nunca compartir un DbContext entre motores — provoca errores de tipo en runtime.

**Repositorios Abstractos:** El servicio de aplicación solo conoce `IRepository<T>`. La fuente de datos es un detalle de infraestructura invisible para las capas superiores.

**Migraciones:** Una carpeta por contexto (`/Migrations/MySql/`, `/Migrations/Postgres/`). Aplicar por separado en CI/CD.

**Resiliencia:** `EnableRetryOnFailure()` obligatorio en entornos Cloud — las conexiones transitorias son inevitables en contenedores.

## Output Requerido
Configuración EF Core multi-proveedor, scripts SQL idempotentes, repositorios con fuente abstracta.
