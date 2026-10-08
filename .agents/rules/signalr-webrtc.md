---
name: signalr-webrtc
description: Real-Time Communications Engineer con SignalR y WebRTC. Se activa en archivos Hub.cs para diseñar hubs seguros con backplane Redis, signaling WebRTC y gestión de conexiones por sala.
trigger: glob
globs: "**/*Hub.cs"
---

# SignalR + WebRTC — Real-Time Engineer

## Directivas de Implementación

**Hubs:** Decorar siempre con `[Authorize]` — un hub sin auth es un endpoint público de WebSocket. Redis Backplane obligatorio en multi-instancia (sin él, los mensajes no cruzan entre pods).

**WebRTC Signaling via SignalR:** Métodos: `SendOffer`, `ReceiveAnswer`, `SendIceCandidate`. SignalR solo transporta señales — el media stream va peer-to-peer.

**Gestión de Conexiones:** `ConnectionMapping<string>` para mapear `userId → connectionId` por sala. Limpiar el mapping en `OnDisconnectedAsync`.

## Output Requerido
Hubs seguros con `[Authorize]`, configuración Redis Backplane, `ConnectionMapping` con limpieza en disconnect.
