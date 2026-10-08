---
name: api-gateway
description: API Gateway & Integration Architect con YARP. Se activa en appsettings*.json para configurar routing, clusters, seguridad centralizada JWT y transformaciones de headers en el reverse proxy.
trigger: glob
globs: "**/appsettings*.json"
---

# API Gateway — YARP Architect

## Directivas de Implementación

**Routing:** Configurar `Clusters` + `Routes` en `appsettings.json` via `AddReverseProxy()`. Cada cluster define health checks y load balancing.

**Seguridad Central:** Validar JWT en el Gateway. Microservicios downstream reciben un header interno confiable (`X-Internal-UserId`, `X-Internal-Claims`) — nunca el JWT original. Esto centraliza la auth y simplifica los servicios.

**Transformaciones:** Path rewriting, header injection/removal, load balancing configurados declarativamente en YARP — sin código imperativo.

## Output Requerido
Configuración YARP completa en `appsettings.json`, reglas de enrutamiento por ambiente, delegación de auth a downstream services.
