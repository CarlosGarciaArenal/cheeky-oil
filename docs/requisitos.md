# Requisitos y Funcionalidades — Cheeky Oil

Índice de requisitos funcionales (RF) y no funcionales (RNF) implementados, con su estado y el documento de diseño/auditoría correspondiente en `docs/features/`. Cada entrada enlaza al documento que contiene el diagrama, la justificación de diseño y la auditoría [REVIEWER] completos — este archivo es solo un índice, no repite ese contenido.

## Estado de los requisitos

| ID | Requisito | Estado | Documento |
|---|---|---|---|
| — | Modelos de datos base (`GasStation`, `AppUser`...) | ✅ Completado | [`01-modelos-base.md`](features/01-modelos-base.md) |
| RF-01 | Mapa y localización del usuario | ✅ Completado | [`02-mapa-base.md`](features/02-mapa-base.md) |
| RF-02 | Capa de gasolineras (datos en vivo de MITECO) | ✅ Completado | [`03-capa-gasolineras.md`](features/03-capa-gasolineras.md) |
| RF-03 | Filtro por tipo de combustible | ✅ Completado | [`04-filtros-combustible.md`](features/04-filtros-combustible.md) |
| RF-03 | **Filtro de radio de distancia máxima** (5/10/15/25/50/100 km / sin límite) | ✅ Completado | [`04-filtros-combustible.md`](features/04-filtros-combustible.md) |
| — | Autenticación con Firebase (email/password) | ✅ Completado | [`05-autenticacion.md`](features/05-autenticacion.md) |
| RF-10 / RNF-08 | Registro seguro con código familiar | ✅ Completado | [`05b-registro-seguro.md`](features/05b-registro-seguro.md) |
| RF-04 | Favoritos: guardar/quitar gasolineras, monitorización y comparación de precios | ✅ Completado | [`06-favoritos.md`](features/06-favoritos.md) |
| RF-04 | Monitorización histórica: registro diario de precios y gráficas (`Chart.js`) | ✅ Completado | [`07-monitorizacion-historica.md`](features/07-monitorizacion-historica.md) |

## Feature recién completada: Filtro de radio de distancia máxima

**RF-03 (extensión).** El mapa ya no se limita a mostrar siempre las `MAX_ESTACIONES_EN_MAPA` (50) gasolineras más cercanas sin importar a qué distancia estén: el usuario puede acotar la búsqueda a un radio concreto (5, 10, 15, 25, 50, 100 km, o "Sin límite" — 25 km por defecto) desde un segundo `ion-select` junto al de combustible.

- **[ARQUITECTO]:** cálculo de distancia (fórmula del haversine, ya existente) + filtro `distanciaKm <= maxDistanceKm` insertado entre el `sort` y el `slice(0, 50)` del pipeline de `redraw()` (`map.component.ts`), para no descartar por error estaciones que sí cumplen el radio en favor de otras ya recortadas. `maxDistanceKm` es una signal reactiva (`Infinity` = sin límite), leída por el mismo `effect()` que ya reaccionaba al filtro de combustible.
- **[UI-DEV]:** segundo `ion-select` (mismo estilo que el de combustible, apilados en un contenedor común `.map__filters`) + Toast (`ToastController`) cuando el combustible y radio elegidos no dejan ninguna gasolinera en el mapa.
- **[REVIEWER]:** auditado y verificado — ver detalle completo en `docs/features/04-filtros-combustible.md` (secciones "Filtro de radio máximo" y "UI del filtro de radio"), con:
  1. Verificación matemática independiente del haversine contra distancias reales conocidas (Madrid↔Barcelona, Madrid↔Toledo, 1° de longitud en el ecuador, simetría A↔B) — todas dentro de tolerancia.
  2. Verificación empírica en navegador (Playwright + cuenta de prueba real): 6 cambios de radio consecutivos, nunca más de 50 marcadores en el DOM en ningún momento — sin pines duplicados ni huérfanos.

## Fix incluido en este ciclo: eliminación física de favoritos confirmada

**RF-04.** Se revisó `FavoritesService.removeFavorite()` (`favorites.service.ts`) a petición explícita, para confirmar que el borrado de una gasolinera favorita es una eliminación física real en Firestore, no un borrado lógico, y que ninguna consulta posterior a la colección `favorites` puede devolver un documento ya eliminado.

- **Resultado de la revisión:** sin bug — el código ya usaba `deleteDoc` del SDK modular de `@angular/fire/firestore` sobre la referencia correcta antes de este ciclo. Ver el detalle completo (y el pendiente ya conocido de las subcolecciones de histórico huérfanas) en `docs/features/06-favoritos.md`, sección "Revisión solicitada de `removeFavorite`".
- **[REVIEWER]:** confirmado de nuevo en este ciclo con verificación empírica end-to-end (Playwright + cuenta de prueba real + lectura directa a la API REST de Firestore): se guardó un favorito, se confirmó 1 documento en Firestore, se quitó desde el propio popup del mapa, y se confirmó **0 documentos** en Firestore inmediatamente después — con el panel de favoritos reflejando correctamente el estado vacío. Cero errores de consola durante todo el flujo.
