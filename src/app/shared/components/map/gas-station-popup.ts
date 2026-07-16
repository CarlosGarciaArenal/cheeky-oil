import * as L from 'leaflet';

import { FuelType, GasStation } from '../../../core/models/gas-station.model';

/**
 * Construcción del popup de gasolinera (icono, HTML, botón de favorito,
 * enlace "Cómo llegar") — extraído de `MapComponent` a un módulo compartido
 * (`[[09-rutas]]`, ciclo [UI-DEV] del Planificador de Rutas) porque
 * `RoutePlannerPage` necesita EXACTAMENTE el mismo popup sobre un `L.Map`
 * distinto. Antes de este cambio, `MapComponent` tenía su propia copia
 * privada de todo esto — con un SEGUNDO consumidor real (no solo
 * hipotético), mantener dos copias de HTML/escapado que interpola datos
 * externos (MITECO, sin validar) habría sido un riesgo real de que un futuro
 * arreglo de seguridad/diseño se aplicara en un sitio y se olvidara en el
 * otro (mismo criterio ya anotado en `[[06-favoritos]]`/`FUEL_LABELS`: "si
 * aparece un tercer consumidor, se debería extraer a un sitio compartido" —
 * aquí ya hay un segundo, y el contenido es mucho más sensible que 3
 * strings).
 *
 * Deliberadamente SOLO lo que es puro/sin estado (iconos, construcción de
 * HTML, escapado). El cableado con estado (listeners `popupopen`/
 * `popupclose` del mapa, sincronización del botón de favorito con
 * `FavoritesService`, iconos por marcador) NO se extrae aquí: cada
 * componente tiene su propia instancia de `L.Map` y su propia señal
 * `favoriteIds`, con su propio ciclo de vida — forzar eso a una clase
 * compartida habría añadido una capa de abstracción genérica (inyección de
 * dependencias por callback, manejo de instancia de mapa ajena) para un caso
 * de solo 2 consumidores, más complejidad que beneficio real. `MapComponent`
 * y `RoutePlannerPage` implementan ese cableado cada uno por su cuenta,
 * siguiendo la misma estructura ya probada y auditada en `MapComponent`.
 */

/** Naranja de marca ("Naranja Fuego" del logo) para gasolineras normales. */
const STATION_MARKER_COLOR = '#FF512F';
/** Amarillo (RF-04, gasolinera favorita), deliberadamente distinto del naranja de "gasolinera normal". */
const FAVORITE_MARKER_COLOR = '#FFC107';

/**
 * Icono de gasolinera: chincheta (forma "pin") en naranja de marca.
 * Constante de módulo (no se crea una instancia por marcador) — mismo
 * criterio de minimizar objetos en memoria ya aplicado en `MapComponent`.
 */
export const STATION_ICON = L.divIcon({
  className: 'app-map-icon app-map-icon--station',
  html: `
    <svg width="26" height="36" viewBox="0 0 26 36" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <path d="M13 0C5.82 0 0 5.82 0 13c0 9.75 13 23 13 23s13-13.25 13-23C26 5.82 20.18 0 13 0z" fill="${STATION_MARKER_COLOR}"/>
      <circle cx="13" cy="13" r="5.5" fill="#fff"/>
    </svg>
  `,
  iconSize: [26, 36],
  iconAnchor: [13, 36],
  popupAnchor: [0, -32],
});

/**
 * Icono de gasolinera FAVORITA (RF-04): misma chincheta que `STATION_ICON`
 * pero en amarillo y con una estrella en vez del círculo blanco — dos
 * señales (color Y forma del glifo interior), no solo el color, para
 * accesibilidad de daltonismo.
 */
export const FAVORITE_ICON = L.divIcon({
  className: 'app-map-icon app-map-icon--favorite',
  html: `
    <svg width="26" height="36" viewBox="0 0 26 36" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <path d="M13 0C5.82 0 0 5.82 0 13c0 9.75 13 23 13 23s13-13.25 13-23C26 5.82 20.18 0 13 0z" fill="${FAVORITE_MARKER_COLOR}"/>
      <path d="M13 7.5l1.35 3.64 3.88.16-3.04 2.41 1.04 3.74-3.23-2.15-3.23 2.15 1.04-3.74-3.04-2.41 3.88-.16z" fill="#fff"/>
    </svg>
  `,
  iconSize: [26, 36],
  iconAnchor: [13, 36],
  popupAnchor: [0, -32],
});

/** Clase CSS del botón de favorito dentro del popup (ver `global.scss`), usada tanto al construir el HTML como al localizar el botón vía `querySelector` en `onPopupOpen` de cada consumidor. */
export const FAV_BUTTON_CLASS = 'gas-station-popup__fav-btn';

/** Clase CSS del enlace "Cómo llegar" del popup (ver `global.scss`). */
export const DIRECTIONS_LINK_CLASS = 'gas-station-popup__directions-link';

/**
 * URL universal de Google Maps para trazar ruta hasta una gasolinera (sin
 * API key, sin coste) — enruta por TEXTO (rótulo + dirección + localidad),
 * no por `lat`/`lng`: las coordenadas de MITECO no siempre son precisas (ver
 * `[[06-favoritos]]`). `encodeURIComponent` neutraliza cualquier carácter
 * con significado HTML que pudiera venir en `direccion`/`localidad` (texto
 * libre de MITECO, sin validar).
 */
function buildGoogleMapsDirectionsUrl(rotulo: string, direccion: string, localidad: string): string {
  return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(`${rotulo} ${direccion}, ${localidad}`);
}

/** Escapa el valor antes de interpolarlo dentro de un atributo HTML (`data-station-id="..."`). */
function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildDirectionsLinkHtml(rotulo: string, direccion: string, localidad: string): string {
  return `
    <a
      class="${DIRECTIONS_LINK_CLASS}"
      href="${buildGoogleMapsDirectionsUrl(rotulo, direccion, localidad)}"
      target="_blank"
      rel="noopener noreferrer"
    >📍 Cómo llegar</a>
  `;
}

function buildFavoriteButtonHtml(stationId: string, esFavorito: boolean): string {
  const activeClass = esFavorito ? ` ${FAV_BUTTON_CLASS}--active` : '';
  const texto = esFavorito ? 'Quitar ⭐' : '⭐ Guardar';

  return `
    <button
      type="button"
      class="${FAV_BUTTON_CLASS}${activeClass}"
      data-station-id="${escapeHtmlAttribute(stationId)}"
      aria-pressed="${esFavorito}"
    >${texto}</button>
  `;
}

/**
 * HTML del popup de una gasolinera: solo el precio del combustible
 * seleccionado (nunca los 3). Como texto HTML visible solo interpola
 * `marca` (tipo cerrado `GasStationBrand`, generado por `MitecoService`,
 * nunca texto libre de la API) y un precio numérico — nunca
 * `direccion`/`municipio` (texto libre de la fuente externa) como HTML sin
 * más; esos dos SÍ se usan, pero solo dentro de `buildDirectionsLinkHtml`,
 * que los pasa por `encodeURIComponent` (contexto de URL, no de HTML).
 *
 * `fuelLabel` se recibe ya resuelto (ej. "Gasolina 95"), no un `FuelType`
 * más un diccionario interno: cada consumidor mantiene su propio
 * `FUEL_LABELS` local (mismo criterio ya aplicado en el resto del proyecto,
 * ver `gas-station.model.ts`), este módulo no necesita conocerlo.
 */
export function buildGasStationPopupHtml(
  estacion: GasStation,
  fuel: FuelType,
  fuelLabel: string,
  esFavorito: boolean,
): string {
  const precio = estacion.precios[fuel];
  const precioTexto = precio !== null ? `${precio.toFixed(3).replace('.', ',')} €` : 'No disponible';

  return `
    <strong class="gas-station-popup__marca">${estacion.marca}</strong>
    <p class="gas-station-popup__precio">${fuelLabel}: ${precioTexto}</p>
    ${buildDirectionsLinkHtml(estacion.marca, estacion.direccion, estacion.municipio)}
    ${buildFavoriteButtonHtml(estacion.id, esFavorito)}
  `;
}
