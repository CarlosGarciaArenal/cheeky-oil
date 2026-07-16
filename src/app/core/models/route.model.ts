/**
 * Coordenada en el orden "humano" (lat, lon) — a propósito INVERTIDO respecto
 * al orden GeoJSON (`[lon, lat]`, ver `RouteResult.geometry`/`GasStation.lng`
 * primero en las llamadas a Turf): esta es la forma en la que `[[UI-DEV]]`
 * maneja coordenadas en el resto de la app (`GasStation.lat`/`lng` como
 * campos separados, nunca un array posicional) — `RoutingService` traduce
 * internamente al orden GeoJSON justo antes de llamar a OSRM/Turf, para que
 * ningún consumidor de este servicio tenga que recordar cuál API espera qué
 * orden.
 */
export interface Coordinates {
  lat: number;
  lon: number;
}

/**
 * Resultado de `RoutingService.geocode(query)` (Nominatim): una coincidencia
 * candidata para el texto de búsqueda. Nominatim puede devolver varias
 * coincidencias para una búsqueda ambigua ("Madrid" existe en España y en
 * varios países de Latinoamérica) — por eso `geocode` devuelve
 * `GeocodeResult[]`, no un único resultado; decidir cuál usar (la primera,
 * o dejar elegir al usuario entre varias) es una decisión de UI, fuera de
 * este servicio.
 */
export interface GeocodeResult {
  /** Nombre completo y legible del lugar, tal como lo devuelve Nominatim (ej. "Puerta del Sol, Madrid, España") — pensado para mostrarse directamente al usuario. */
  displayName: string;
  lat: number;
  lon: number;
}

/**
 * Resultado de `RoutingService.getRoute(start, end)` (OSRM): la geometría
 * completa de la ruta más la distancia/duración totales. `geometry` es
 * exactamente el `LineString` GeoJSON que devuelve OSRM con
 * `geometries=geojson` — se reexpone tal cual (no se traduce a un formato
 * propio) porque `RoutingService.filterStationsAlongRoute` y cualquier
 * capa de mapa (`Leaflet`, ya en uso en `MapComponent`) consumen GeoJSON
 * de forma nativa.
 */
export interface RouteResult {
  geometry: GeoJSON.LineString;
  /** Distancia total de la ruta, en metros — mismo campo y unidad que devuelve OSRM (`routes[0].distance`), sin convertir. */
  distanceMeters: number;
  /** Duración total estimada, en segundos — mismo campo y unidad que devuelve OSRM (`routes[0].duration`), sin convertir. */
  durationSeconds: number;
}
