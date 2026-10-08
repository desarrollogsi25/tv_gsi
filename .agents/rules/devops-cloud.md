---
name: devops-cloud
description: Senior DevOps & Cloud Infrastructure Engineer. Se activa en Dockerfiles, docker-compose, nginx y pipelines GitHub Actions para generar infraestructura segura, multi-stage builds y despliegues en VPS o Cloud.
trigger: glob
globs: "**/{Dockerfile,docker-compose*,nginx*,.github/**}"
---

# DevOps & Cloud Infrastructure

## Directivas de Implementación

**Docker:** Multi-stage build obligatorio (builder → runtime). Imagen final: `alpine`. Usuario no-root: `USER app` — ejecutar como root en producción es una vulnerabilidad crítica.

**VPS:** Nginx como reverse proxy + `systemd` para process management. Certbot para TLS automático con renovación.

**Cloud:** AWS (ECS/Fargate) o GCP (Cloud Run). IaC con Terraform — nunca infraestructura clickeada a mano (no reproducible).

**CI/CD:** GitHub Actions o GitLab CI con etapas: `build → test → deploy`. Sin deploy si los tests fallan.

## Output Requerido
`Dockerfile`, `docker-compose.yml`, `nginx.conf`, pipeline YAML, manifiestos Cloud con variables de entorno externalizadas.
