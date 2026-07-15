import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IonSelect, IonSelectOption, SelectCustomEvent, ToastController } from '@ionic/angular/standalone';
import * as L from 'leaflet';

import { FuelPrices, GasStation } from '../../../core/models/gas-station.model';
import { Coordinates, LocationService } from '../../../core/services/location.service';
import { FavoritesService } from '../../../core/services/favorites.service';
import { MitecoService } from '../../../core/services/miteco.service';

/** Centro por defecto (Madrid) mientras se resuelve o si falla la geolocalización. */
const DEFAULT_CENTER: L.LatLngTuple = [40.4168, -3.7038];
const DEFAULT_ZOOM = 13;
const USER_ZOOM = 15;

/**
 * Número máximo de gasolineras dibujadas simultáneamente en el mapa.
 * La API de MITECO devuelve ~11.500 estaciones en una sola respuesta; crear
 * un `L.Marker` (con su nodo DOM) por cada una saturaría la memoria de un
 * móvil. Se limita a las más cercanas al usuario, que son las únicas
 * relevantes para el caso de uso ("gasolineras cerca de mí").
 */
const MAX_ESTACIONES_EN_MAPA = 50;

const EARTH_RADIUS_KM = 6371;

function toRadians(grados: number): number {
  return (grados * Math.PI) / 180;
}

/** Distancia entre dos coordenadas (fórmula del haversine), en kilómetros. */
function haversineDistanceKm(origen: Coordinates, destino: Coordinates): number {
  const dLat = toRadians(destino.lat - origen.lat);
  const dLng = toRadians(destino.lng - origen.lng);
  const lat1 = toRadians(origen.lat);
  const lat2 = toRadians(destino.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Tipo de combustible por el que se puede filtrar el mapa (RF-03). Derivado de `FuelPrices` para no duplicar los 3 nombres de campo a mano. */
type FuelKey = keyof FuelPrices;

const FUEL_LABELS: Record<FuelKey, string> = {
  gasolina95: 'Gasolina 95',
  gasolina98: 'Gasolina 98',
  diesel: 'Diésel',
};

/** Una opción del selector de radio máximo (`ion-select-option`, ver la plantilla). */
interface DistanceOption {
  value: number;
  label: string;
}

/**
 * Radios predefinidos del selector de distancia. `Infinity` ("Sin límite") es
 * un valor real, no un sentinela numérico (`-1`, `0`...): `maxDistanceKm`
 * (signal leída por `redraw()`) ya trata `Infinity` como "sin filtro" de
 * forma explícita, así que esta opción no necesita ninguna traducción especial
 * entre lo que el usuario elige y lo que `redraw()` interpreta.
 */
const DISTANCE_OPTIONS: DistanceOption[] = [
  { value: 5, label: '5 km' },
  { value: 10, label: '10 km' },
  { value: 15, label: '15 km' },
  { value: 25, label: '25 km' },
  { value: 50, label: '50 km' },
  { value: 100, label: '100 km' },
  { value: Infinity, label: 'Sin límite' },
];

/** Radio por defecto al cargar el mapa: suficientemente amplio para casi cualquier zona sin llegar a "sin límite". */
const DEFAULT_MAX_DISTANCE_KM = 25;

/** Clase CSS del botón de favorito dentro del popup (ver `global.scss`), usada tanto al construir el HTML como al localizar el botón vía `querySelector` en `onPopupOpen`. */
const FAV_BUTTON_CLASS = 'gas-station-popup__fav-btn';

/** Clase CSS del enlace "Cómo llegar" del popup (ver `global.scss`). Es un `<a>` plano: a diferencia del botón de favorito, no necesita `onPopupOpen`/`addEventListener` porque no hay ningún estado de Angular que sincronizar — el navegador gestiona la navegación él solo. */
const DIRECTIONS_LINK_CLASS = 'gas-station-popup__directions-link';

/**
 * URL universal de Google Maps para trazar ruta hasta una gasolinera (sin
 * API key, sin coste): en móvil, el propio sistema operativo despierta la
 * app nativa de mapas que el usuario tenga instalada; en escritorio abre
 * Google Maps en el navegador.
 *
 * CORRECCIÓN CRÍTICA [ARQUITECTO] (RF-04): enruta por TEXTO (rótulo +
 * dirección + localidad), no por `lat`/`lng`. Las coordenadas que expone la
 * API de MITECO no siempre son precisas (geocodificación de origen variable
 * según la estación) — enviar a Google Maps una `lat,lng` ligeramente
 * desplazada lleva al usuario a un punto que puede no ser la gasolinera real,
 * sin ningún indicio de que la ruta está mal. Con una consulta de texto,
 * Google Maps usa SU PROPIO geocodificador/índice de negocios para localizar
 * la gasolinera por nombre y dirección, con más probabilidad de acertar el
 * punto real que confiar en la coordenada bruta de MITECO.
 *
 * `encodeURIComponent` neutraliza cualquier carácter con significado HTML
 * (`<`, `>`, `"`, `&`, etc.) que pudiera venir en `direccion`/`localidad`
 * (texto libre de MITECO, sin validar — ver `buildPopupHtml`): el resultado
 * es siempre seguro para interpolarse dentro de un atributo `href`.
 */
function buildGoogleMapsDirectionsUrl(rotulo: string, direccion: string, localidad: string): string {
  return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(`${rotulo} ${direccion}, ${localidad}`);
}

/**
 * Escapa el valor antes de interpolarlo dentro de un atributo HTML
 * (`data-station-id="..."`). `GasStation.id` (IDEESS) viene de la API
 * pública del Ministerio sin validar (ver `miteco.service.ts`): en la
 * práctica es siempre un código numérico, pero se escapa igualmente para no
 * asumir el formato de una fuente externa, mismo criterio defensivo que ya
 * aplica `buildPopupHtml` al no interpolar nunca texto libre sin control.
 */
function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Fallback defensivo por si algún marcador se crease sin icono explícito
 * (no ocurre en este componente: tanto el marcador de usuario como los de
 * gasolinera usan los `L.DivIcon` de abajo). Se mantiene para que
 * `L.Icon.Default` siga resolviendo correctamente si se usara en el futuro.
 *
 * `Icon.Default._getIconUrl()` calcula la URL final como
 * `(this.options.imagePath || Icon.Default.imagePath) + <nombre de archivo>`
 * (ver `node_modules/leaflet/dist/leaflet-src.js`). Si no fijamos
 * `imagePath`, Leaflet ejecuta `_detectIconPath()`, que busca la regla CSS
 * `.leaflet-default-icon-path` (definida en `leaflet.css`) y usa la URL de
 * imagen ahí declarada como prefijo — en esta app esa regla se resuelve a
 * una ruta que no coincide con dónde servimos los assets (`assets/leaflet/`),
 * dando una URL con doble prefijo que 404. Fijar `imagePath` explícitamente
 * anula esa autodetección basada en CSS y usa siempre esta ruta.
 */
L.Icon.Default.imagePath = 'assets/leaflet/';

/**
 * Naranja de marca ("Naranja Fuego" del logo, ver `src/assets/logo.svg`)
 * para diferenciar visualmente las gasolineras de "tu ubicación".
 */
const STATION_MARKER_COLOR = '#FF512F';
/** Azul, deliberadamente distinto del naranja de marca: solo hay un marcador de este tipo en el mapa. */
const USER_MARKER_COLOR = '#2563EB';
/** Amarillo (RF-04, marcador de gasolinera favorita), deliberadamente distinto tanto del naranja de "gasolinera normal" como del azul de "tu ubicación". */
const FAVORITE_MARKER_COLOR = '#FFC107';

/**
 * Icono de gasolinera: chincheta (forma "pin") en naranja de marca.
 * Se crea una única vez (constante de módulo) y se reutiliza en los hasta
 * 50 marcadores de `redraw`, en vez de instanciar un `L.DivIcon` por
 * estación — mismo criterio de minimizar objetos en memoria ya aplicado
 * al límite de marcadores (ver `docs/features/03-capa-gasolineras.md`).
 */
const STATION_ICON = L.divIcon({
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
 * Icono de "tu ubicación": punto azul (forma de círculo, no de chincheta),
 * para que la diferencia con las gasolineras no dependa solo del color
 * (mejor accesibilidad para usuarios con dificultad para distinguir colores).
 */
const USER_ICON = L.divIcon({
  className: 'app-map-icon app-map-icon--user',
  html: `<span class="app-map-icon__dot" style="background:${USER_MARKER_COLOR}"></span>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  popupAnchor: [0, -12],
});

/**
 * Icono de gasolinera FAVORITA (RF-04): misma chincheta que `STATION_ICON`
 * (sigue siendo una gasolinera, mismo significado de forma) pero en amarillo
 * y con una estrella en vez del círculo blanco — dos señales (color Y forma
 * del glifo interior), no solo el color, mismo criterio de accesibilidad ya
 * aplicado en `USER_ICON` para diferenciar el marcador de "tu ubicación".
 */
const FAVORITE_ICON = L.divIcon({
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

/**
 * Mapa base (Leaflet + OpenStreetMap) centrado en la ubicación del usuario.
 * Ver justificación de coste cero en `docs/features/02-mapa-base.md`.
 */
@Component({
  selector: 'app-map',
  templateUrl: './map.component.html',
  styleUrl: './map.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonSelect, IonSelectOption],
})
export class MapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: true })
  private readonly mapContainerRef!: ElementRef<HTMLDivElement>;

  /** Mensaje de error de geolocalización, mostrado de forma accesible bajo el mapa. */
  protected readonly locationError = signal<string | null>(null);
  /** Mensaje de error de carga de gasolineras, mostrado de forma accesible bajo el mapa. */
  protected readonly stationsError = signal<string | null>(null);
  /** Combustible seleccionado en el `ion-select` (RF-03). Por defecto, Gasolina 95. */
  protected readonly selectedFuel = signal<FuelKey>('gasolina95');
  protected readonly fuelLabels = FUEL_LABELS;
  /**
   * Radio máximo (en km) desde el usuario para considerar una gasolinera,
   * elegido en el `ion-select` de radio (ver plantilla). `DEFAULT_MAX_DISTANCE_KM`
   * (25 km) por defecto, no `Infinity`: un radio amplio mantiene el
   * comportamiento útil de "gasolineras cerca de mí" desde la primera carga,
   * sin mostrar de entrada estaciones a cientos de km si el usuario está en
   * una zona con pocas gasolineras dentro de las `MAX_ESTACIONES_EN_MAPA` más
   * cercanas. Mutarla (`.set(...)`) re-dispara `redraw()` solo por ser leída
   * dentro del mismo `effect()` que ya depende de `selectedFuel` — ver
   * comentario de `redraw()`.
   */
  protected readonly maxDistanceKm = signal<number>(DEFAULT_MAX_DISTANCE_KM);
  protected readonly distanceOptions = DISTANCE_OPTIONS;

  private readonly locationService = inject(LocationService);
  private readonly mitecoService = inject(MitecoService);
  private readonly favoritesService = inject(FavoritesService);
  private readonly toastController = inject(ToastController);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * IDs (IDEESS) de las gasolineras favoritas del usuario activo, en vivo
   * (`FavoritesService.getFavorites()`, RF-04). Un `Set`, no un array, para
   * que `buildPopupHtml`/`syncOpenPopupButton` comprueben pertenencia en
   * O(1) por cada marcador dibujado.
   */
  protected readonly favoriteIds = signal<Set<string>>(new Set());

  private map: L.Map | null = null;
  private userMarker: L.Marker | null = null;
  /**
   * Todas las gasolineras se añaden a este `L.LayerGroup` (en vez de
   * directamente al mapa) para poder limpiarlas con una sola llamada
   * (`clearLayers()`) cada vez que cambia el filtro de combustible o se
   * recargan (ej. el usuario se mueve). Se destruye junto con el resto del
   * mapa en `ngOnDestroy` (`map.remove()`).
   */
  private stationsLayer: L.LayerGroup | null = null;

  /**
   * Última respuesta de MITECO y origen usado, cacheados en memoria (no en
   * un signal: no necesitan disparar el `effect` de `redraw` por sí solos,
   * solo servir de entrada la próxima vez que se invoque). Cambiar de
   * combustible no debe volver a pedir ~11.500 registros a la API: se
   * reutilizan estos datos y solo se recalculan distancia/orden/recorte.
   */
  private estacionesCache: GasStation[] = [];
  private origenCache: Coordinates | null = null;
  /**
   * Observador del tamaño real del contenedor del mapa (ver `ngAfterViewInit`),
   * desconectado en `ngOnDestroy`. Sustituye a un `setTimeout` de duración
   * fija que se usaba antes: un retardo fijo (probado solo contra la carga
   * INICIAL de esta vista) resultaba insuficiente al volver navegando desde
   * `/favoritos` — la transición de entrada de Ionic en el camino de vuelta
   * no dura necesariamente lo mismo que la de la primera carga, así que un
   * número fijo de ms es una apuesta, no una garantía. `ResizeObserver`
   * dispara su callback tanto al empezar a observar (con el tamaño que tenga
   * el contenedor en ESE momento) como cada vez que ese tamaño cambia
   * después — cubre la carga inicial Y cualquier transición de vuelta, sin
   * depender de cuánto tarde la animación.
   */
  private resizeObserver: ResizeObserver | null = null;

  /** `GasStation` por id (IDEESS), reconstruido en cada `redraw()`. Permite que `onFavoriteButtonClick` recupere el objeto completo que exige `FavoritesService.addFavorite(station)` sin guardar una referencia por marcador. */
  private estacionesPorId = new Map<string, GasStation>();
  /**
   * `L.Marker` por id (IDEESS), reconstruido en cada `redraw()` igual que
   * `estacionesPorId`. Permite que `syncMarkerIcons` actualice el icono
   * (naranja/amarillo) del marcador EXACTO cuyo estado de favorito cambió
   * con `marker.setIcon(...)` — una operación barata, sin recrear el resto
   * de marcadores ni sus popups — en vez de disparar un `redraw()` completo
   * cada vez que el usuario guarda/quita un favorito (mismo criterio ya
   * aplicado a `syncOpenPopupButton`, ver constructor).
   */
  private markersPorId = new Map<string, L.Marker>();
  /** Botón de favorito del ÚNICO popup abierto en cada momento (Leaflet cierra el anterior al abrir uno nuevo, `autoClose` por defecto), y el id que lleva asociado. `null` cuando no hay ningún popup abierto. Se usan para reflejar en el DOM del popup abierto los cambios de `favoriteIds` sin tener que redibujar todos los marcadores (ver justificación en `docs/features/06-favoritos.md`). */
  private openPopupButton: HTMLButtonElement | null = null;
  private openPopupStationId: string | null = null;

  constructor() {
    // Reactividad del filtro: `redraw()` lee la signal `selectedFuel` en su
    // propio cuerpo, así que Angular la registra como dependencia del efecto
    // y lo vuelve a ejecutar automáticamente cada vez que el usuario cambia
    // de segmento — sin necesidad de un handler que llame a `redraw()` a mano.
    effect(() => this.redraw());

    // Efecto SEPARADO del de arriba, a propósito: si `buildPopupHtml` (que
    // `redraw()` invoca) leyera `favoriteIds()` sin envolverla en
    // `untracked()`, este mismo efecto quedaría también suscrito a
    // `favoriteIds` y CADA alta/baja de favorito volvería a dibujar los ~50
    // marcadores del mapa (coste innecesario) y, peor, cerraría de golpe el
    // popup que el usuario acaba de usar para pulsar el propio botón. Este
    // segundo efecto sí depende de `favoriteIds()` en su cuerpo, pero solo
    // actualiza el botón del popup que esté abierto en ese momento (si hay
    // uno) y el icono de los marcadores YA dibujados, sin recrear ninguno ni
    // tocar el resto de Leaflet (capa, popups, orden).
    effect(() => {
      const ids = this.favoriteIds();
      this.syncOpenPopupButton(ids);
      this.syncMarkerIcons(ids);
    });
  }

  ngAfterViewInit(): void {
    this.map = L.map(this.mapContainerRef.nativeElement, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(this.map);

    // Bug clásico de Leaflet: si al crear el mapa el contenedor todavía no
    // tiene su tamaño final resuelto (transición de entrada/vuelta de Ionic,
    // layout asentándose), Leaflet calcula mal las dimensiones y los tiles
    // quedan en blanco/rotos hasta que algo fuerza un recálculo.
    // `ResizeObserver` dispara su callback con el tamaño real del contenedor
    // nada más empezar a observar (cubre la carga inicial) y de nuevo cada
    // vez que ese tamaño cambia después (cubre volver de `/favoritos`, cuya
    // transición de entrada no dura necesariamente lo mismo que la primera
    // carga) — sin apostar por un número de ms fijo. `this.map` se comprueba
    // con `?.` porque el componente pudo destruirse (`ngOnDestroy` pone
    // `this.map = null` y desconecta este observer) antes de que dispare.
    this.resizeObserver = new ResizeObserver(() => {
      this.map?.invalidateSize();
    });
    this.resizeObserver.observe(this.mapContainerRef.nativeElement);

    // Controles de zoom reubicados abajo a la izquierda para no tapar
    // la cabecera de marca (arriba) ni futuros controles/FAB en la esquina
    // inferior derecha (ej. botón "centrar en mi ubicación").
    L.control.zoom({ position: 'bottomleft' }).addTo(this.map);

    this.stationsLayer = L.layerGroup().addTo(this.map);

    // `popupopen`/`popupclose` son eventos del propio `L.Map`, no de un
    // marcador concreto: se registran UNA vez aquí y sirven para todos los
    // popups (usuario y gasolineras) que se abran durante la vida del mapa.
    // Ver justificación completa (por qué este es el único punto de entrada
    // posible entre el HTML plano de Leaflet y el mundo reactivo de Angular)
    // en `docs/features/06-favoritos.md`.
    this.map.on('popupopen', (event: L.PopupEvent) => this.onPopupOpen(event));
    this.map.on('popupclose', (event: L.PopupEvent) => this.onPopupClose(event));

    // La carga del mapa/marcadores (la funcionalidad PRINCIPAL de este
    // componente) se dispara ANTES que la suscripción a favoritos, y en una
    // sentencia propia sin nada detrás que dependa de ella. Orden deliberado
    // (hallazgo de una auditoría [REVIEWER], ver `docs/features/06-favoritos.md`):
    // si `subscribeFavorites()` (una funcionalidad SECUNDARIA, el resaltado
    // de favoritos en el popup) fallara de forma síncrona por cualquier
    // motivo, esta línea ya se ha ejecutado y los marcadores ya están en
    // camino de dibujarse — no dependen de que favoritos funcione.
    this.locationService
      .getCurrentPosition()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (coords) => {
          this.centerOnUser(coords);
          this.loadNearestStations(coords);
        },
        error: (error: Error) => {
          this.locationError.set(error.message);
          // Sin ubicación del usuario, se muestran las más cercanas al centro por defecto.
          this.loadNearestStations({ lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] });
        },
      });

    this.subscribeFavorites();
  }

  /**
   * Favoritos del usuario activo (RF-04): listener en vivo, acotado a un
   * máximo de 10 documentos (`MAX_GASOLINERAS_GUARDADAS`). Se limpia solo
   * vía `takeUntilDestroyed`, igual que el resto de suscripciones de este
   * componente (sección 3 de `CLAUDE.md`).
   *
   * Envuelto en `try/catch` a propósito (hallazgo de una auditoría
   * [REVIEWER], ver `docs/features/06-favoritos.md`): `FavoritesService.getFavorites()`
   * NO es una función `async` — un `throw` síncrono ahí (por la razón que
   * sea, incluida cualquier futura de una librería de terceros como
   * `@angular/fire`, fuera de nuestro control) rompería `ngAfterViewInit()`
   * en el punto exacto en que se llama, y todo lo que viniera DESPUÉS en ese
   * método dejaría de ejecutarse. Ya se movió esta llamada al FINAL de
   * `ngAfterViewInit()` (ver comentario de arriba) para que ese escenario no
   * pueda impedir que el mapa cargue sus marcadores — este `try/catch` es la
   * segunda capa: aunque en el futuro se añadiera código nuevo DESPUÉS de
   * esta llamada, seguiría estando protegido. El resaltado de favoritos es
   * una mejora sobre el mapa, nunca debe poder romperlo.
   */
  private subscribeFavorites(): void {
    try {
      this.favoritesService
        .getFavorites()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (favoritos) => this.favoriteIds.set(new Set(favoritos.map((favorito) => favorito.id))),
          error: (error: Error) => this.stationsError.set(error.message),
        });
    } catch (error: unknown) {
      this.stationsError.set(error instanceof Error ? error.message : 'No se pudieron cargar los favoritos.');
    }
  }

  /**
   * Destruye la instancia de Leaflet al destruirse el componente: libera sus
   * listeners internos (drag, zoom, resize) y el DOM del mapa, evitando la
   * fuga de memoria si el usuario navega repetidamente hacia/desde esta vista.
   * `stationsLayer` y sus marcadores se destruyen junto con el mapa: Leaflet
   * los trata como una capa más, igual que el control de zoom. Sin este
   * `ngOnDestroy`, cada vuelta a `/home` crearía una NUEVA instancia de
   * `L.Map` sin haber liberado la anterior — no reutilizando el mismo
   * contenedor (Angular crea un `<div>` nuevo por instancia de componente),
   * pero sí acumulando listeners/observers huérfanos (`ResizeObserver`,
   * geolocalización, Firestore) que ya no tienen forma de limpiarse.
   */
  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    // `map.remove()` desengancha también los listeners registrados con
    // `map.on(...)` (incluidos `popupopen`/`popupclose`) — no hace falta un
    // `map.off(...)` explícito aparte.
    this.map?.remove();
    this.map = null;
    this.userMarker = null;
    this.stationsLayer = null;
    this.estacionesPorId.clear();
    this.markersPorId.clear();
    this.openPopupButton = null;
    this.openPopupStationId = null;
  }

  /** Handler del `(ionChange)` del `ion-select` de combustible: solo actualiza la signal; `redraw()` se dispara solo vía el `effect` del constructor. */
  protected onFuelChange(event: SelectCustomEvent): void {
    const value = event.detail.value;
    if (value === 'gasolina95' || value === 'gasolina98' || value === 'diesel') {
      this.selectedFuel.set(value);
    }
  }

  /**
   * Handler del `(ionChange)` del `ion-select` de radio: mismo patrón que
   * `onFuelChange` — solo actualiza `maxDistanceKm`, nunca llama a `redraw()`
   * a mano. `event.detail.value` conserva el valor real bindado en
   * `[value]="option.value"` (incluido `Infinity`, un número de verdad, no
   * una cadena `"Infinity"` que hubiera que parsear), así que un simple
   * `typeof value === 'number'` basta para aceptar cualquier opción de
   * `DISTANCE_OPTIONS` sin necesitar una lista de valores válidos aparte.
   */
  protected onDistanceChange(event: SelectCustomEvent): void {
    const value = event.detail.value;
    if (typeof value === 'number') {
      this.maxDistanceKm.set(value);
    }
  }

  private centerOnUser(coords: Coordinates): void {
    if (!this.map) {
      return;
    }

    const latLng: L.LatLngTuple = [coords.lat, coords.lng];
    this.map.setView(latLng, USER_ZOOM);

    this.userMarker = L.marker(latLng, { icon: USER_ICON, title: 'Tu ubicación actual' })
      .addTo(this.map)
      .bindPopup('Estás aquí');
  }

  /** Descarga todas las estaciones de MITECO, las cachea y dispara el primer `redraw()`. */
  private loadNearestStations(origen: Coordinates): void {
    this.mitecoService
      .getEstaciones()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (estaciones) => {
          this.estacionesCache = estaciones;
          this.origenCache = origen;
          this.redraw();
        },
        error: (error: Error) => this.stationsError.set(error.message),
      });
  }

  /**
   * Filtra por el combustible seleccionado, calcula la distancia de TODAS
   * las estaciones filtradas, ordena de menor a mayor distancia, filtra por
   * `maxDistanceKm` y SOLO DESPUÉS recorta a `MAX_ESTACIONES_EN_MAPA`. El
   * orden importa: si se recortara antes de filtrar (por combustible o por
   * distancia), las estaciones "reales" que sí cumplen ambos criterios
   * podrían quedar fuera en favor de estaciones más cercanas mundialmente
   * pero sin ese combustible, o ya descartadas por un recorte previo (ver
   * `docs/features/04-filtros-combustible.md`, mismo razonamiento ya
   * aplicado ahí al filtro de combustible).
   */
  private redraw(): void {
    // `fuel`/`maxDistanceKm` se leen SIEMPRE en las primeras líneas, antes de
    // cualquier `return` anticipado. Un `effect()` solo registra como
    // dependencia los signals que efectivamente se leen durante una
    // ejecución dada: si el primer disparo del efecto (justo tras
    // construirse el componente, con `origenCache` aún `null`) hubiera
    // cortado en el guard de abajo sin llegar a leerlas, Angular no habría
    // registrado ninguna dependencia — y el efecto jamás se habría vuelto a
    // ejecutar al cambiar de combustible o de radio después (el bug real ya
    // reportado para `selectedFuel`: el mapa se quedaba siempre con el
    // combustible por defecto).
    const fuel = this.selectedFuel();
    const maxDistanceKm = this.maxDistanceKm();
    const origen = this.origenCache;
    if (!this.map || !this.stationsLayer || !origen) {
      return;
    }

    const conCombustible = this.estacionesCache.filter((estacion) => estacion.precios[fuel] !== null);

    const masCercanas = conCombustible
      .map((estacion) => ({ estacion, distanciaKm: haversineDistanceKm(origen, estacion) }))
      .sort((a, b) => a.distanciaKm - b.distanciaKm)
      // `maxDistanceKm === Infinity` omite el filtro explícitamente (en vez
      // de confiar solo en que `distanciaKm <= Infinity` sea siempre cierto):
      // dos gasolineras a la MISMA distancia justo en el límite quedan
      // incluidas por igual (`<=`, no `<`), y el caso "sin límite" queda
      // documentado en el propio código, no solo como efecto colateral de
      // comparar contra `Infinity`.
      .filter((item) => maxDistanceKm === Infinity || item.distanciaKm <= maxDistanceKm)
      .slice(0, MAX_ESTACIONES_EN_MAPA);

    // Aviso no bloqueante si el combustible + radio elegidos no dejan NINGUNA
    // gasolinera que dibujar. `this.estacionesCache.length > 0` descarta el
    // caso "MITECO todavía no ha respondido" (el usuario cambió de radio
    // antes de que `loadNearestStations` resolviera, con `estacionesCache`
    // aún en su `[]` inicial) — sin este guard se mostraría un "no hay
    // gasolineras" falso mientras la carga real sigue en curso.
    if (masCercanas.length === 0 && this.estacionesCache.length > 0) {
      void this.presentEmptyResultsToast();
    }

    // Limpia los marcadores de una carga (o filtro) anterior antes de dibujar
    // los nuevos (evita acumular marcadores huérfanos).
    this.stationsLayer.clearLayers();
    // Reconstruidos en cada redraw junto con los marcadores: solo necesitan
    // contener las estaciones actualmente dibujadas (las únicas con un botón
    // de favorito en el DOM que pueda pulsarse / un marcador cuyo icono
    // `syncMarkerIcons` pueda actualizar).
    this.estacionesPorId.clear();
    this.markersPorId.clear();

    // Leída UNA vez aquí, envuelta en `untracked()` (RF-04): igual que ya
    // hacía `buildPopupHtml` antes de este cambio, evita que este efecto
    // quede también suscrito a `favoriteIds` (ver comentario del
    // constructor). Se pasa el mismo `Set` ya resuelto tanto al HTML del
    // popup como a la selección de icono, en vez de leer la signal dos veces.
    const favoriteIds = untracked(() => this.favoriteIds());

    for (const { estacion } of masCercanas) {
      this.estacionesPorId.set(estacion.id, estacion);

      const marker = L.marker([estacion.lat, estacion.lng], {
        icon: favoriteIds.has(estacion.id) ? FAVORITE_ICON : STATION_ICON,
        title: `Gasolinera ${estacion.marca} en ${estacion.municipio}`,
      })
        .bindPopup(this.buildPopupHtml(estacion, fuel, favoriteIds), { className: 'gas-station-popup' })
        .addTo(this.stationsLayer);

      this.markersPorId.set(estacion.id, marker);
    }
  }

  /**
   * Aviso amigable (no bloqueante) cuando el combustible + radio elegidos no
   * dejan ninguna gasolinera en el mapa. `ToastController` (imperativo, igual
   * que `ModalController` ya usado en `favorites-panel.page.ts`), no un
   * `<ion-toast>` declarativo en la plantilla: este aviso es un efecto
   * secundario de `redraw()` (que corre dentro de un `effect()`, sin acceso
   * cómodo a un `isOpen` reactivo enlazado a plantilla), no un estado que
   * la UI deba reflejar de forma persistente.
   */
  private async presentEmptyResultsToast(): Promise<void> {
    const toast = await this.toastController.create({
      message: 'No se ha encontrado ninguna gasolinera con ese combustible dentro de ese radio.',
      duration: 3000,
      position: 'bottom',
      color: 'medium',
      buttons: [{ text: 'OK', role: 'cancel' }],
    });
    await toast.present();
  }

  /**
   * Actualiza el icono (naranja/amarillo) de los marcadores YA dibujados
   * cuyo estado de favorito cambió, sin disparar un `redraw()` completo —
   * que recalcularía distancias/orden y recrearía los ~50 popups solo para
   * cambiar un color. `marker.setIcon(...)` es una operación barata: Leaflet
   * sustituye el nodo DOM del icono de ESE marcador, no repinta el mapa
   * entero. Mismo criterio ya aplicado a `syncOpenPopupButton` (ver
   * constructor y `docs/features/06-favoritos.md`).
   */
  private syncMarkerIcons(favoriteIds: Set<string>): void {
    for (const [stationId, marker] of this.markersPorId) {
      marker.setIcon(favoriteIds.has(stationId) ? FAVORITE_ICON : STATION_ICON);
    }
  }

  /**
   * HTML del popup de cada gasolinera: solo el precio del combustible
   * seleccionado (nunca los 3). Como texto HTML visible solo interpola
   * `marca` (tipo cerrado `GasStationBrand`, generado por `MitecoService`,
   * nunca texto libre de la API), la etiqueta fija del combustible y un
   * precio numérico — nunca `direccion`/`municipio` (texto libre de la
   * fuente externa) como HTML sin más, para no introducir HTML/JS arbitrario
   * en el mapa vía `bindPopup` (que interpreta el string como HTML). Esos dos
   * campos SÍ se usan, pero solo dentro de `buildDirectionsLinkHtml`, que los
   * pasa por `encodeURIComponent` antes de interpolarlos (contexto distinto:
   * un valor de URL, no HTML — ver justificación completa en
   * `buildGoogleMapsDirectionsUrl`).
   *
   * `favoriteIds` se recibe ya resuelto (RF-04), no se lee aquí como signal:
   * esta función se invoca desde `redraw()`, que corre dentro del `effect()`
   * cuya ÚNICA dependencia reactiva debe ser `selectedFuel` (ver comentario
   * del constructor) — es `redraw()` quien envuelve la lectura de
   * `favoriteIds()` en `untracked()` una única vez y se la pasa a esta
   * función y a la selección de icono del marcador, en vez de que cada una
   * vuelva a leer la signal por su cuenta.
   */
  private buildPopupHtml(estacion: GasStation, fuel: FuelKey, favoriteIds: Set<string>): string {
    const precio = estacion.precios[fuel];
    // Invariante: `redraw()` ya filtró por `precios[fuel] !== null` antes de
    // llegar aquí, pero se mantiene el guard por si esta función se reutiliza
    // alguna vez con una estación sin filtrar previamente.
    const precioTexto = precio !== null ? `${precio.toFixed(3)} €` : 'No disponible';
    const esFavorito = favoriteIds.has(estacion.id);

    return `
      <strong class="gas-station-popup__marca">${estacion.marca}</strong>
      <p class="gas-station-popup__precio">${FUEL_LABELS[fuel]}: ${precioTexto}</p>
      ${this.buildDirectionsLinkHtml(estacion.marca, estacion.direccion, estacion.municipio)}
      ${this.buildFavoriteButtonHtml(estacion.id, esFavorito)}
    `;
  }

  /**
   * Enlace "📍 Cómo llegar" embebido en el popup: `target="_blank"` +
   * `rel="noopener noreferrer"` (nunca dejar que la pestaña nueva pueda
   * acceder a `window.opener` de esta app, buena práctica estándar para
   * cualquier enlace externo). Mismo criterio que `buildFavoriteButtonHtml`:
   * HTML puro, nunca pasa por el compilador de plantillas de Angular.
   */
  private buildDirectionsLinkHtml(rotulo: string, direccion: string, localidad: string): string {
    return `
      <a
        class="${DIRECTIONS_LINK_CLASS}"
        href="${buildGoogleMapsDirectionsUrl(rotulo, direccion, localidad)}"
        target="_blank"
        rel="noopener noreferrer"
      >📍 Cómo llegar</a>
    `;
  }

  /**
   * Botón "⭐ Guardar" / "Quitar ⭐" embebido en el popup. Es HTML puro (el
   * mismo string se inyecta luego en el DOM real vía `bindPopup`/`innerHTML`
   * de Leaflet): no lleva `(click)` de Angular porque este nodo nunca pasa
   * por el compilador de plantillas de Angular. `data-station-id` es lo
   * único que permite, más tarde, que `onPopupOpen` sepa a qué estación
   * corresponde el botón que acaba de aparecer en el DOM.
   */
  private buildFavoriteButtonHtml(stationId: string, esFavorito: boolean): string {
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
   * Único punto de entrada real entre el HTML plano de un popup de Leaflet y
   * el mundo reactivo de Angular (ver justificación completa en
   * `docs/features/06-favoritos.md`). `popupopen` se dispara para CUALQUIER
   * popup del mapa (incluido "Estás aquí"), así que primero se comprueba si
   * el popup recién abierto contiene un botón de favorito.
   */
  private onPopupOpen(event: L.PopupEvent): void {
    const boton = event.popup.getElement()?.querySelector<HTMLButtonElement>(`.${FAV_BUTTON_CLASS}`);
    const stationId = boton?.dataset['stationId'];
    if (!boton || !stationId) {
      return;
    }

    this.openPopupButton = boton;
    this.openPopupStationId = stationId;
    // Por si el marcador se redibujó (ver `redraw()`) y el estado de
    // favorito cambió entre medias sin que este popup concreto se hubiera
    // vuelto a abrir todavía.
    this.setFavoriteButtonState(boton, this.favoriteIds().has(stationId));

    // `dataset['favBound']` evita añadir un SEGUNDO listener si el usuario
    // cierra y reabre el MISMO popup sin que su contenido cambie entre medias
    // (Leaflet reutiliza el mismo nodo del botón en ese caso) — sin este
    // guard, cada `addEventListener` extra dispararía `onFavoriteButtonClick`
    // una vez más por click, duplicando la llamada a Firestore.
    if (boton.dataset['favBound'] === 'true') {
      return;
    }
    boton.dataset['favBound'] = 'true';
    boton.addEventListener('click', () => this.onFavoriteButtonClick(stationId, boton));
  }

  /** Limpia la referencia al popup abierto para que `syncOpenPopupButton` deje de intentar tocar un botón que ya no está en el DOM visible. */
  private onPopupClose(event: L.PopupEvent): void {
    const boton = event.popup.getElement()?.querySelector<HTMLButtonElement>(`.${FAV_BUTTON_CLASS}`);
    if (boton && boton === this.openPopupButton) {
      this.openPopupButton = null;
      this.openPopupStationId = null;
    }
  }

  /**
   * Handler real del click (RF-04). No actualiza el botón de forma optimista
   * a mano: `addFavorite`/`removeFavorite` escriben en Firestore, cuyo
   * listener de `getFavorites()` (con compensación de latencia del SDK, ver
   * `docs/features/06-favoritos.md`) actualiza `favoriteIds` casi al
   * instante, y es el `effect()` del constructor quien entonces repinta este
   * mismo botón vía `syncOpenPopupButton`. Única fuente de verdad = la
   * signal, nunca el DOM del botón mutado a mano en dos sitios distintos.
   */
  private onFavoriteButtonClick(stationId: string, boton: HTMLButtonElement): void {
    const estacion = this.estacionesPorId.get(stationId);
    if (!estacion) {
      return;
    }

    const eraFavorito = this.favoriteIds().has(stationId);
    boton.disabled = true;

    const operacion = eraFavorito
      ? this.favoritesService.removeFavorite(stationId)
      : this.favoritesService.addFavorite(estacion);

    operacion
      .catch((error: unknown) => {
        this.stationsError.set(error instanceof Error ? error.message : 'No se pudo actualizar el favorito.');
      })
      .finally(() => {
        boton.disabled = false;
      });
  }

  /** Repinta el botón del popup actualmente abierto (si hay uno) cada vez que cambia `favoriteIds`. No toca Leaflet ni el resto de marcadores. */
  private syncOpenPopupButton(ids: Set<string>): void {
    if (!this.openPopupButton || !this.openPopupStationId) {
      return;
    }
    this.setFavoriteButtonState(this.openPopupButton, ids.has(this.openPopupStationId));
  }

  private setFavoriteButtonState(boton: HTMLButtonElement, esFavorito: boolean): void {
    boton.textContent = esFavorito ? 'Quitar ⭐' : '⭐ Guardar';
    boton.setAttribute('aria-pressed', String(esFavorito));
    boton.classList.toggle(`${FAV_BUTTON_CLASS}--active`, esFavorito);
  }
}
