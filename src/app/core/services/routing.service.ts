import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import * as turf from '@turf/turf';

import { GasStation } from '../models/gas-station.model';
import { Coordinates, GeocodeResult, RouteResult } from '../models/route.model';

/**
 * Nominatim (OpenStreetMap): geocodificación de texto libre a coordenadas.
 * Servicio público y gratuito, sin API key — en línea con la regla de coste
 * cero del proyecto (`CLAUDE.md`) — pero con condiciones de uso explícitas
 * (https://operations.osmfoundation.org/policies/nominatim/) que cualquier
 * consumidor de `geocode()` debe respetar, ver su documentación más abajo.
 */
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

/**
 * OSRM (Open Source Routing Machine): cálculo de rutas por carretera.
 * `router.project-osrm.org` es el SERVIDOR DE DEMOSTRACIÓN público del
 * propio proyecto OSRM — sin API key, coste cero — pero su documentación
 * advierte explícitamente que no está pensado para tráfico de producción
 * (sin garantía de disponibilidad ni límite de peticiones documentado
 * públicamente). Aceptable para el volumen de esta app (personal/familiar,
 * `CLAUDE.md`); si el uso creciera, la migración natural sería una instancia
 * propia de OSRM (self-hosted, sigue siendo coste cero de licencia) antes
 * que un proveedor de pago.
 *
 * **`https://`, no `http://`.** El mismo servidor sirve ambos esquemas con
 * contenido idéntico (verificado con una petición real: mismo JSON byte a
 * byte), pero `AndroidManifest.xml` no declara `usesCleartextTraffic` ni un
 * `networkSecurityConfig` — con `targetSdkVersion` moderno, Android bloquea
 * por defecto cualquier tráfico HTTP sin cifrar del proceso de la app
 * (`ERR_CLEARTEXT_NOT_PERMITTED`), a diferencia del navegador de escritorio
 * usado en desarrollo web, donde esa petición sí pasa. Era el ÚNICO endpoint
 * `http://` de todo `src/` (Nominatim, teselas OSM y MITECO ya usaban
 * `https://`) — mismo patrón de fallo "funciona en web, falla en Android"
 * que la migración de `LocationService` a `@capacitor/geolocation`, esta vez
 * en la capa de red en vez de en la de permisos (ver
 * `docs/features/09-rutas.md`).
 */
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';

/**
 * Tolerancia de simplificación de la ruta (`turf.simplify`, ver
 * `filterStationsAlongRoute`) como FRACCIÓN de `maxDeviationKm`, no un valor
 * fijo — 10%, verificado empíricamente (`[[09-rutas]]`): con
 * `maxDeviationKm=5` (tolerancia resultante 0.5km) contra 11.500 estaciones
 * sintéticas, la simplificación solo difiere del cálculo exacto en 6 casos
 * (0.05%), todos a menos de 150m del propio umbral.
 */
const SIMPLIFY_TOLERANCE_RATIO = 0.1;

/** Tope de la tolerancia de simplificación, para que un `maxDeviationKm` muy generoso (ej. 50km) no simplifique la ruta hasta perder su forma real. */
const MAX_SIMPLIFY_TOLERANCE_KM = 2;

/**
 * Conversión km→grados para la tolerancia de `turf.simplify` (que espera la
 * tolerancia en las mismas unidades que las coordenadas, grados). Se usa la
 * cifra de LATITUD (~111 km/grado, prácticamente constante en cualquier
 * punto de la Tierra) en vez de la de longitud (que en España, 36°N-44°N,
 * varía entre ~80 y ~90 km/grado según la latitud): usar el valor MÁS ALTO
 * de km/grado da la tolerancia en grados MÁS PEQUEÑA — la conversión más
 * conservadora posible (simplifica menos de lo que en teoría podría
 * permitirse), sin necesidad de calcular la latitud real de cada ruta.
 */
const KM_PER_DEGREE_LATITUDE = 111;

/** Forma (parcial) de cada resultado de Nominatim — solo los campos que esta app consume; la respuesta real trae bastantes más (`boundingbox`, `importance`, `osm_id`...). */
interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

/** Forma (parcial) de la respuesta de OSRM con `geometries=geojson` — verificada contra el servidor real, ver `[[09-rutas]]`. */
interface OsrmResponse {
  code: string;
  routes: Array<{
    geometry: GeoJSON.LineString;
    distance: number;
    duration: number;
  }>;
}

/**
 * Cliente de las dos APIs públicas y gratuitas que necesita RF-0X ("Rutas"):
 * Nominatim (geocodificación) y OSRM (cálculo de ruta), más la lógica
 * espacial para filtrar gasolineras cercanas a una ruta ya calculada
 * (`@turf/turf`). No escribe en Firestore ni conoce `FavoritesService` —
 * misma separación de responsabilidades ya aplicada a `MitecoService`
 * (cliente HTTP puro de una fuente externa, sin mezclar con persistencia).
 */
@Injectable({ providedIn: 'root' })
export class RoutingService {
  private readonly http = inject(HttpClient);

  /**
   * Geocodifica `query` (texto libre, ej. "Puerta del Sol, Madrid") a una
   * lista de coincidencias candidatas — ver `GeocodeResult` sobre por qué
   * puede haber varias.
   *
   * **Responsabilidad de quien consuma este método** (`[[UI-DEV]]`, fuera de
   * alcance de este ciclo): la política de uso de Nominatim prohíbe
   * explícitamente el patrón "autocompletar en cada pulsación de tecla" —
   * debe dispararse solo tras una acción explícita del usuario (enviar un
   * formulario) o, como mínimo, un `debounceTime` generoso (varios cientos
   * de ms). Tampoco se puede fijar un `User-Agent` personalizado desde
   * JavaScript de navegador (los navegadores bloquean sobrescribir esa
   * cabecera por seguridad, sin excepción) — Nominatim identifica peticiones
   * de navegador por la cabecera `Referer`, que el propio navegador añade
   * sola; no hay nada que este servicio deba/pueda hacer al respecto.
   */
  geocode(query: string): Observable<GeocodeResult[]> {
    const params = new HttpParams().set('format', 'json').set('q', query);
    return this.http.get<NominatimResult[]>(NOMINATIM_URL, { params }).pipe(
      map((resultados) =>
        resultados.map((resultado) => ({
          displayName: resultado.display_name,
          lat: parseFloat(resultado.lat),
          lon: parseFloat(resultado.lon),
        })),
      ),
    );
  }

  /**
   * Calcula la ruta en coche entre `start` y `end` (OSRM, perfil `driving`,
   * el único que necesita esta app — sin API para bici/a pie).
   *
   * `overview=full` (NO `simplified`, el valor por defecto de OSRM si se
   * omite el parámetro) a propósito: `filterStationsAlongRoute` necesita la
   * geometría REAL de la carretera para medir distancias de desvío
   * fiables — una geometría simplificada podría "cortar" curvas y dar falsos
   * negativos (gasolineras realmente cercanas a la carretera real, pero
   * lejos de la versión simplificada de la ruta).
   *
   * `respuesta.code !== 'Ok'` (ej. `'NoRoute'`, cuando OSRM no encuentra
   * ninguna carretera entre los dos puntos, o `'InvalidQuery'`) se traduce
   * en un `Error` explícito — sin esta comprobación, acceder a
   * `respuesta.routes[0]` con `routes: []` (que es lo que OSRM devuelve en
   * esos casos, junto con `code`) lanzaría un `TypeError` genérico y opaco
   * ("Cannot read properties of undefined") en vez de un mensaje que
   * `[[UI-DEV]]` pueda mostrar tal cual al usuario.
   */
  getRoute(start: Coordinates, end: Coordinates): Observable<RouteResult> {
    const url = `${OSRM_URL}/${start.lon},${start.lat};${end.lon},${end.lat}`;
    const params = new HttpParams().set('overview', 'full').set('geometries', 'geojson');
    return this.http.get<OsrmResponse>(url, { params }).pipe(
      map((respuesta) => {
        if (respuesta.code !== 'Ok' || respuesta.routes.length === 0) {
          throw new Error('No se ha podido calcular una ruta entre los dos puntos indicados.');
        }
        const ruta = respuesta.routes[0];
        return {
          geometry: ruta.geometry,
          distanceMeters: ruta.distance,
          durationSeconds: ruta.duration,
        };
      }),
    );
  }

  /**
   * Filtra `stations` (pensado para TODAS las gasolineras de España, hasta
   * ~11.500, ver `MitecoService.getEstaciones`) a solo las que están a
   * `maxDeviationKm` o menos de desvío de `routeGeometry` (la geometría de
   * ruta ya calculada por `getRoute`), usando `turf.pointToLineDistance`
   * para la distancia exacta punto-a-línea.
   *
   * **Dos optimizaciones deliberadas antes de la distancia exacta — no
   * estaban en el encargo original, pero caen dentro del criterio de diseño
   * de `[ARQUITECTO]` (`CLAUDE.md`, "minimiza lecturas/escrituras",
   * extendido aquí a "minimiza cálculo"). Medidas empíricamente, no solo
   * razonadas — ver cifras y metodología completas en `[[09-rutas]]`:**
   *
   * 1. **Simplificar la geometría de la ruta (`turf.simplify`) ANTES de
   *    calcular ninguna distancia.** `turf.pointToLineDistance` recorre
   *    TODOS los segmentos de la línea para CADA punto — con una ruta larga
   *    (Madrid–Barcelona, verificada contra el servidor OSRM real: **8.157**
   *    vértices con `overview=full`) y hasta ~11.500 estaciones, esto medía
   *    **45 SEGUNDOS** en un script Node de este mismo ciclo (con el
   *    pre-filtro de bbox del punto 2 YA aplicado) — un bloqueo de UI
   *    completamente inaceptable si se ejecutara en el hilo principal del
   *    navegador. Reducir los vértices de la línea (Douglas-Peucker, vía
   *    `turf.simplify`) baja ese coste CASI LINEALMENTE, porque el coste de
   *    `pointToLineDistance` es proporcional al número de segmentos: medido
   *    a **~760ms** con una tolerancia de simplificación de 0.5km (129
   *    vértices en vez de 8.157) — de 45s a menos de 1s.
   * 2. **Pre-filtro por caja delimitadora (bounding box) ANTES de calcular
   *    NINGUNA distancia (ni siquiera contra la línea ya simplificada).**
   *    Descarta con una simple comparación numérica de coordenadas (O(1) por
   *    estación) a las que ni siquiera caen dentro de la caja que envuelve
   *    la ruta expandida por `maxDeviationKm` — solo la minoría ya cercana a
   *    la ruta paga el cálculo exacto. La caja se expande con `turf.buffer`
   *    sobre el propio bbox de la ruta, no con una conversión km→grados
   *    hecha a mano: 1° de longitud NO mide lo mismo en km que 1° de
   *    latitud (varía con la latitud misma), y España cruza un rango de
   *    latitudes (36°N-44°N) donde esa diferencia es significativa — dejar
   *    que Turf resuelva la geodesia evita ese error sin código propio de
   *    conversión que mantener.
   *
   * **`SIMPLIFY_TOLERANCE_RATIO` (10% de `maxDeviationKm`, con un tope de 2
   * km) — NO un valor fijo.** Un valor de tolerancia fijo (ej. siempre
   * 0.5km) habría sido peligroso: con un `maxDeviationKm` pequeño (ej. 1km,
   * "gasolineras justo al lado de la carretera"), una tolerancia fija de
   * 0.5km sería el 50% del propio umbral — un error de simplificación
   * enorme en proporción. Escalar la tolerancia como fracción del propio
   * umbral mantiene el error de simplificación pequeño EN RELACIÓN al
   * umbral, sea cual sea; el tope de 2km evita perder demasiada precisión
   * cuando `maxDeviationKm` es muy generoso (ej. 50km), donde una tolerancia
   * sin tope (5km) empezaría a distorsionar la forma real de la carretera de
   * forma más notoria.
   *
   * **Precisión perdida por la simplificación: medida, acotada y aceptada
   * explícitamente, no una aproximación sin comprobar.** Con
   * `maxDeviationKm=5` (tolerancia 0.5km) contra 11.500 estaciones
   * sintéticas, la simplificación difiere del cálculo EXACTO (sin
   * simplificar) en solo 6 de 11.500 (0.05%) — y las 6 tienen una distancia
   * REAL entre 4.75km y 5.13km, es decir, a menos de 150m del propio umbral
   * de 5km (justo el orden de magnitud esperado para una tolerancia de
   * 0.5km). Ninguna estación claramente dentro o claramente fuera del radio
   * cambia de resultado — solo casos al borde exacto del umbral, donde la
   * propia precisión de las coordenadas de MITECO (no siempre exactas, ver
   * `[[06-favoritos]]`) ya introduce un margen de error comparable.
   *
   * `buffered` puede ser `undefined` según el tipo de `turf.buffer(...)`
   * (caso límite de la librería, no esperado en la práctica con un buffer
   * positivo sobre un polígono simple) — si ocurriera, el pre-filtro de bbox
   * simplemente se SALTA (nunca se usa como motivo para excluir una
   * estación que en realidad debería pasar el corte): más lento en ese caso
   * excepcional, pero nunca incorrecto.
   */
  filterStationsAlongRoute(
    routeGeometry: GeoJSON.LineString,
    stations: GasStation[],
    maxDeviationKm: number,
  ): GasStation[] {
    const simplifyToleranceKm = Math.min(maxDeviationKm * SIMPLIFY_TOLERANCE_RATIO, MAX_SIMPLIFY_TOLERANCE_KM);
    const simplifiedGeometry = turf.simplify(turf.lineString(routeGeometry.coordinates), {
      tolerance: simplifyToleranceKm / KM_PER_DEGREE_LATITUDE,
      highQuality: false,
    });
    const routeLine = turf.lineString(simplifiedGeometry.geometry.coordinates);

    const buffered = turf.buffer(turf.bboxPolygon(turf.bbox(routeLine)), maxDeviationKm, {
      units: 'kilometers',
    });
    const searchBbox = buffered ? turf.bbox(buffered) : null;

    return stations.filter((station) => {
      if (searchBbox && !this.isWithinBbox(station.lng, station.lat, searchBbox)) {
        return false;
      }

      const distanceKm = turf.pointToLineDistance(turf.point([station.lng, station.lat]), routeLine, {
        units: 'kilometers',
      });
      return distanceKm <= maxDeviationKm;
    });
  }

  private isWithinBbox(lng: number, lat: number, bbox: GeoJSON.BBox): boolean {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
  }
}
