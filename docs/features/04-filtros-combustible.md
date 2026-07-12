# 04 - Filtros Activos de Combustible (RF-03)

**Roles:** [ARQUITECTO] + [UI-DEV]
**Estado:** Implementado
**Archivos modificados:**
- `src/app/shared/components/map/map.component.ts`
- `src/app/shared/components/map/map.component.html`
- `src/app/shared/components/map/map.component.scss`
- `src/global.scss`

## Qué hace

Un `ion-segment` flotante sobre el mapa permite elegir entre **Gasolina 95** (por defecto), **Gasolina 98** y **Diésel**. El mapa dibuja únicamente las gasolineras que venden el combustible elegido, con su popup mostrando solo ese precio (no los 3), y solo las **50 más cercanas de entre las que sí lo venden**.

## Diagrama de Flujo (Mermaid): reactividad al cambiar de filtro

```mermaid
flowchart TD
    A["Usuario toca ion-segment-button"] --> B["(ionChange) → onFuelChange(event)"]
    B --> C["selectedFuel.set('gasolina95' | 'gasolina98' | 'diesel')"]
    C -.->|"signal cambia"| D["effect() del constructor se re-ejecuta"]
    D --> E["redraw()"]

    F["loadNearestStations (carga inicial, una vez)"] --> G["mitecoService.getEstaciones()"]
    G --> H["estacionesCache = estaciones; origenCache = origen"]
    H --> I["redraw() (llamada directa, no vía signal)"]

    E --> J["fuel = selectedFuel()"]
    I --> J
    J --> K["conCombustible = estacionesCache.filter(precios[fuel] !== null)"]
    K --> L["map: {estacion, distanciaKm} SOLO sobre conCombustible"]
    L --> M["sort ascendente por distanciaKm"]
    M --> N["slice(0, 50)"]
    N --> O["stationsLayer.clearLayers()"]
    O --> P["por cada estación: L.marker + bindPopup (1 solo precio)"]
```

## Justificación de Diseño (ARQUITECTO): reactividad sin volver a llamar a la API

1. **`estacionesCache`/`origenCache` son campos normales, no signals.** Cambiar de combustible **no** debe volver a descargar ~11.500 registros de MITECO — el filtro opera sobre los datos ya descargados una vez. Si fueran signals, no aportarían nada (no necesitan disparar reactividad por sí solos, `redraw()` los lee como entrada simple), y complicarían el modelo sin beneficio.
2. **`selectedFuel` sí es un signal**, y `redraw()` lo lee (`this.selectedFuel()`) dentro de su propio cuerpo. Un único `effect(() => this.redraw())`, creado en el constructor, se re-ejecuta automáticamente cada vez que `selectedFuel` cambia — sin necesidad de que `onFuelChange` llame a `redraw()` a mano. Angular registra como dependencia cualquier signal leído síncronamente durante la ejecución del efecto, incluida la lectura que ocurre dentro de una llamada a otro método (`redraw()`), no solo la que está literalmente en el cuerpo del `effect`.
3. **La carga inicial (tras `getCurrentPosition()`) sí llama a `redraw()` directamente**, en vez de depender del `effect`. Que lleguen los datos de la API no es un cambio de signal (`estacionesCache`/`origenCache` no lo son), así que el `effect` no se dispararía solo con la respuesta HTTP. Se documenta esta distinción a propósito: el `effect` cubre la reactividad **al filtro**; la carga inicial de datos es un evento asíncrono aparte con su propia llamada explícita.
4. **`redraw()` no necesita limpieza manual.** Los `effect()` creados en el contexto de inyección de un componente (constructor, en este caso) se destruyen solos junto con el componente — no hace falta un `DestroyRef`/`takeUntilDestroyed` adicional para esto, a diferencia de las suscripciones RxJS del propio componente.

## Corrección Crítica: orden filtrar → distancia → ordenar → recortar

**El error a evitar:** calcular las "50 más cercanas" sobre la lista completa de estaciones (o recortar a 50 antes de saber cuáles tienen el combustible elegido) puede excluir estaciones que sí son de las 50 más cercanas **reales** entre las que venden ese combustible, en favor de estaciones más cercanas en general pero sin ese combustible, o de estaciones que ya habían quedado fuera de un recorte anterior.

**El orden implementado en `redraw()` es:**

```ts
const conCombustible = this.estacionesCache.filter((estacion) => estacion.precios[fuel] !== null);

const masCercanas = conCombustible
  .map((estacion) => ({ estacion, distanciaKm: haversineDistanceKm(origen, estacion) }))
  .sort((a, b) => a.distanciaKm - b.distanciaKm)
  .slice(0, MAX_ESTACIONES_EN_MAPA);
```

1. **`filter` primero**, sobre las ~11.500 estaciones cacheadas: solo quedan las que venden el combustible elegido.
2. **`map` de distancia después, sobre el resultado ya filtrado** (no sobre las ~11.500 originales): cada estación candidata obtiene su `distanciaKm` real al origen.
3. **`sort` ascendente por esa distancia.**
4. **`slice(0, 50)` al final**, sobre la lista ya filtrada y ordenada.

### Verificación empírica (no solo lectura de código)

Se ejecutó esta misma lógica en Node contra una descarga real de la API (11.517 estaciones, origen = Madrid) para los 3 combustibles:

| Combustible | Estaciones con ese combustible | Dibujadas | Distancia de la 50ª |
|---|---|---|---|
| Gasolina 95 | 10.935 | 50 | 4.51 km |
| Gasolina 98 | 5.524 | 50 | 6.65 km |
| Diésel | 11.303 | 50 | 4.51 km |

Esto confirma que el orden importa en la práctica, no solo en teoría: la Gasolina 98 la vende menos de la mitad de las estaciones (5.524 de 11.517), así que sus "50 más cercanas reales" abarcan un radio mayor (6.65 km) que Gasolina 95/Diésel (4.51 km, prácticamente disponibles en casi todas las estaciones). Si se hubiera recortado a 50 **antes** de filtrar por combustible, el filtro de Gasolina 98 habría podido devolver muy pocas o ninguna estación (la mayoría de las 50 más cercanas "en general" no la venden), en vez de las 50 más cercanas que sí la venden.

## Diagrama de Flujo (Mermaid): estructura del `ion-segment` [UI-DEV]

```mermaid
flowchart LR
    A["ion-segment (flotante, top del mapa)"] --> B["ion-segment-button value=gasolina95"]
    A --> C["ion-segment-button value=gasolina98"]
    A --> D["ion-segment-button value=diesel"]
    B --> E["ion-label: Gasolina 95 (seleccionado por defecto)"]
    C --> F["ion-label: Gasolina 98"]
    D --> G["ion-label: Diésel"]
```

## Justificación de Diseño (UI-DEV)

1. **`ion-segment` en vez de botones flotantes independientes.** Es el componente estándar de Ionic para "elegir 1 de N opciones mutuamente excluyentes", ya theme-aware (claro/oscuro) sin CSS adicional, y con soporte de teclado/lector de pantalla incorporado (a diferencia de reinventar 3 `ion-fab-button` con estado activo gestionado a mano).
2. **`[value]="selectedFuel()"` (one-way) + `(ionChange)` en vez de `[(ngModel)]`.** El estado real vive en el signal `selectedFuel`, no en un `FormControl`; usar `ngModel` habría requerido importar `FormsModule` sin necesidad, solo para un binding que el propio patrón signal ya cubre de forma más directa.
3. **Posición: flotante en la parte superior del mapa (`position: absolute; top: 12px`)**, no en la cabecera de marca (`AppComponent`, fuera del alcance de este componente) ni abajo (donde ya están los controles de zoom, `bottomleft`, y los mensajes de error, `.map__errors`). Evita solapar controles existentes.
4. **Etiquetas de texto (`fuelLabels`), no solo iconos.** Con 3 opciones y nombres cortos ("Gasolina 95", "Gasolina 98", "Diésel"), el texto es más claro que un icono ambiguo — y siguen siendo anunciadas correctamente por lectores de pantalla vía `ion-label`.
5. **`aria-label` explícito en el `ion-segment`** ("Filtrar gasolineras por tipo de combustible"), ya que el propósito del control no es evidente por su contenido visual solo (3 palabras sueltas) sin ese contexto para tecnología de asistencia.
6. **Popup reducido a un solo precio (el del combustible activo), no los 3.** Mostrar los 3 precios cuando el usuario ya ha elegido uno sería ruido; el popup ahora refleja directamente la elección hecha en el segmento, coherente con el propósito del filtro.

## Seguridad y Costes (resumen)

- Sin llamadas nuevas a Firestore/Cloud Functions ni a la API de MITECO: cambiar de filtro reutiliza `estacionesCache` ya descargado, coste de red = 0 peticiones adicionales.
- `fuelLabels`/`FUEL_LABELS` son constantes fijas del código (no texto de la API) interpoladas en el popup — mismo razonamiento de seguridad ya aplicado a `marca`.

---

## Auditoría [REVIEWER]

**Rol:** [REVIEWER]
**Archivos auditados:**
- `src/app/shared/components/map/map.component.ts`
- `src/app/shared/components/map/map.component.html`
- `src/app/shared/components/map/map.component.scss`
- `src/global.scss`

### 1. ¿Se limpian los marcadores anteriores antes de dibujar los nuevos al cambiar de combustible?

- [x] **Sí, confirmado leyendo `redraw()` (`map.component.ts:271-306`).** `this.stationsLayer.clearLayers()` (línea 296) se ejecuta **antes** del bucle `for` que crea los nuevos `L.marker(...)` (líneas 298-305) — nunca después, nunca condicionalmente.
- [x] **`redraw()` es la única función que dibuja marcadores de gasolinera, y se invoca en ambos casos relevantes**: la carga inicial (`loadNearestStations`, línea 255) y cada cambio de combustible (vía el `effect(() => this.redraw())` del constructor, línea 173, que se re-ejecuta automáticamente al cambiar `selectedFuel`). No existe ninguna otra ruta de código que añada marcadores de estación al mapa sin pasar por este `clearLayers()` previo.
- [x] **Se usa `stationsLayer.clearLayers()` (sobre el `L.LayerGroup`) en vez de `map.removeLayer()` marcador a marcador.** Funcionalmente equivalente para este caso (ambos retiran los marcadores del mapa y liberan sus referencias/DOM), pero más simple y con menor superficie de error: una sola llamada limpia los hasta 50 marcadores de la carga anterior, sin necesidad de mantener un array de referencias a cada `L.Marker` para iterar y remover uno a uno. Ya se auditó en el ciclo anterior que `L.LayerGroup#clearLayers()` desregistra correctamente los listeners y popups de cada marcador que contiene.
- [x] **Sin pines duplicados posible**: al ser siempre "limpiar todo → dibujar de cero" (no "añadir los que falten"), no hay forma de que un marcador de una selección de combustible anterior sobreviva a la siguiente.

**Veredicto punto 1: correcto. No hay fuga visual de marcadores duplicados al cambiar de filtro.**

### 2. ¿La ordenación por distancia es matemáticamente correcta antes de aplicar el límite de 50?

- [x] **Orden de operaciones confirmado en `redraw()` (líneas 279-284): `filter` → `map` (distancia) → `sort` → `slice`, en ese orden textual y de ejecución.** `conCombustible` (el resultado del `filter`) es el array sobre el que se calcula la distancia (`.map`) y se ordena (`.sort`); `slice(0, MAX_ESTACIONES_EN_MAPA)` es la última operación de la cadena.
- [x] **`haversineDistanceKm` reutilizada sin cambios respecto al ciclo anterior**, ya auditado y verificado matemáticamente correcto contra datos reales (ver auditoría en `docs/features/03-capa-gasolineras.md`).
- [x] **Verificación empírica repetida para este ciclo** (tabla en la sección "Corrección Crítica" de este mismo documento): contra 11.517 estaciones reales, Gasolina 98 (solo 5.524 estaciones la venden) da un radio de "50 más cercanas" de 6.65 km, frente a 4.51 km de Gasolina 95/Diésel — el resultado esperado si el filtro por combustible ocurre **antes** de calcular/ordenar/recortar por distancia. Si el orden estuviera invertido (recorte antes de filtrar), este experimento habría dado un número de estaciones "dibujadas" muy inferior a 50 para Gasolina 98 en zonas con pocas estaciones que la vendan — no es el caso.
- [x] **Sin mutación del array original**: `.filter()`, `.map()` y `.sort()` sobre el resultado de `.map()` no mutan `this.estacionesCache` — cada cambio de combustible parte siempre de los datos completos cacheados, no de un subconjunto ya recortado por una selección anterior.

**Veredicto punto 2: correcto. La ordenación por distancia se aplica sobre el conjunto ya filtrado por combustible, y el límite de 50 es la última operación de la cadena.**

### 3. Otras comprobaciones

- [x] **`tsc --noEmit` y `npm run lint`** ejecutados de nuevo sobre el estado final: sin errores.
- [x] **CSS sin clases huérfanas**: se confirmó que `.gas-station-popup__precios`/`li` (la lista de 3 precios del ciclo anterior) se retiraron de `global.scss` por completo, coherente con que el popup ahora usa `.gas-station-popup__precio` (un único párrafo).
- [x] **Sin llamadas nuevas a Firestore/Cloud Functions**; `estacionesCache` evita además peticiones repetidas a la API de MITECO al cambiar de filtro — impacto en costes = 0.
- [x] **Reactividad sin fugas**: el `effect()` del constructor no requiere limpieza manual (Angular lo destruye junto con el componente al estar creado en su contexto de inyección); no introduce ninguna suscripción RxJS adicional que gestionar.
- [ ] ⚠️ **Nota (no bloqueante, heredada del ciclo anterior):** el `console.log` de diagnóstico en `redraw()` sigue marcado como temporal (`TODO`). Se mantiene un ciclo más porque sigue siendo útil para depurar el reporte original de "faltan gasolineras cercanas" con el nuevo filtro de combustible activo.

### Veredicto final

**Aprobado para commit.** Los marcadores se limpian correctamente antes de cada redibujado (sin duplicados al cambiar de combustible), y la ordenación por distancia se aplica sobre el conjunto ya filtrado por combustible, con el recorte a 50 como última operación — verificado tanto por lectura de código como empíricamente contra datos reales.

## Próximos pasos (fuera de alcance de este documento)

- [UI-DEV] (futuro): recordar el filtro elegido entre sesiones (ej. `localStorage`) para no resetear siempre a Gasolina 95.
- [ARQUITECTO] (futuro): si se añade un histórico de precios, este mismo patrón de `effect()` sobre `selectedFuel` serviría también para filtrar ese histórico sin duplicar lógica.
- [REVIEWER] (futuro): retirar el `console.log` de diagnóstico de `redraw()` una vez confirmado con el usuario que el filtro de cercanía no es la causa de "faltan gasolineras".
