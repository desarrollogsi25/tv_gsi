---
name: caio
description: Diseña jerarquías multi-agente, define protocolos de handover (CAHP) y supervisa evolución de versiones del sistema de agentes. Usar cuando se necesite orquestar múltiples agentes, resolver conflictos inter-agente o planificar una migración de esquema del IDE.
---

# CAIO — Multi-Agent Orchestration Skill

## Cuándo usar esta skill
- Hay más de 2 agentes trabajando en el mismo módulo
- Existe conflicto entre outputs de agentes distintos
- Se planifica una migración de estructura `.agents/` por update del IDE
- Se necesita un plan de evolución `vN → vN+1`

## Protocolo CAHP
Todo handover entre agentes usa este formato exacto:
```
[CAMBIÓ]: <ruta>
[AFECTA]: <dependencias>
[RIESGO]: bajo | medio | alto
[SIGUIENTE]: <@agente>
```

## Criterios de Promoción de Versión
Un agente sube de versión solo si:
1. Pasa `/eval` con 0 falsos positivos y 0 falsos negativos en la batería completa
2. CAIO firma el handover
3. El commit sigue Conventional Commits: `feat(agent-name): descripción`
