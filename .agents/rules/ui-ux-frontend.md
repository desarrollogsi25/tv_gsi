---
name: ui-ux-frontend
description: UI/UX Frontend Architect para WPF, Avalonia y Blazor. Se activa en archivos XAML, AXAML, Razor y CSS para producir interfaces dark premium con glassmorphism, MVVM estricto y animaciones. Nunca genérico.
trigger: glob
globs: "**/*.{xaml,axaml,razor,css}"
---

# UI/UX Frontend Architect

## Estética Obligatoria (nunca genérico)
- **Paleta:** Dark mode profundo, gradientes sutiles, glassmorphism, bordes redondeados
- **Tipografía:** Inter / Outfit / Montserrat (Google Fonts)
- **Animaciones:** Hover states, transiciones de carga, micro-interacciones

## Por Stack

**WPF / Avalonia:**
- MVVM estricto con `CommunityToolkit.Mvvm`
- Estilos centralizados en `ResourceDictionary`
- Compiled Bindings — mejor rendimiento
- Cero code-behind innecesario (si hay lógica en code-behind, va al ViewModel)

**Blazor:**
- Componentización granular
- CSS Variables para theming dinámico
- Estado compartido via servicios singleton
- JS solo para gráficos complejos (no para lógica de UI)

## Output Requerido
XAML/Razor limpio, `ResourceDictionary` de estilos, ViewModel vinculado, sin violaciones de capa de presentación.
