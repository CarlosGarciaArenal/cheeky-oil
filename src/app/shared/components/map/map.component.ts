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
import { IonSelect, IonSelectOption, SelectCustomEvent } from '@ionic/angular/standalone';
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

/** Clase CSS del botón de favorito dentro del popup (ver `global.scss`), usada tanto al construir el HTML como al localizar el botón vía `querySelector` en `onPopupOpen`. */
const FAV_BUTTON_CLASS = 'gas-station-popup__fav-btn';

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

  private readonly locationService = inject(LocationService);
  private readonly mitecoService = inject(MitecoService);
  private readonly favoritesService = inject(FavoritesService);
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
  /** Temporizador del fix de `invalidateSize()` (ver `ngAfterViewInit`), para poder cancelarlo en `ngOnDestroy` si el componente se destruye antes de que dispare. */
  private invalidateSizeTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /** `GasStation` por id (IDEESS), reconstruido en cada `redraw()`. Permite que `onFavoriteButtonClick` recupere el objeto completo que exige `FavoritesService.addFavorite(station)` sin guardar una referencia por marcador. */
  private estacionesPorId = new Map<string, GasStation>();
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
    // uno), sin tocar Leaflet ni el resto de marcadores.
    effect(() => {
      const ids = this.favoriteIds();
      this.syncOpenPopupButton(ids);
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
    // tiene su tamaño final resuelto (transición de entrada de Ionic, layout
    // asentándose), Leaflet calcula mal las dimensiones y los tiles quedan en
    // blanco hasta que el usuario redimensiona la ventana. `invalidateSize()`
    // le fuerza a releer el tamaño real del contenedor y repintar. `this.map`
    // se comprueba con `?.` porque el componente pudo destruirse (`ngOnDestroy`
    // pone `this.map = null`) antes de que este timeout llegue a disparar.
    this.invalidateSizeTimeoutId = setTimeout(() => {
      this.map?.invalidateSize();
    }, 400);

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

    // Favoritos del usuario activo (RF-04): listener en vivo, acotado a un
    // máximo de 10 documentos (`MAX_GASOLINERAS_GUARDADAS`). Se limpia solo
    // vía `takeUntilDestroyed`, igual que el resto de suscripciones de este
    // componente (sección 3 de `CLAUDE.md`).
    this.favoritesService
      .getFavorites()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (favoritos) => this.favoriteIds.set(new Set(favoritos.map((favorito) => favorito.id))),
        error: (error: Error) => this.stationsError.set(error.message),
      });

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
  }

  /**
   * Destruye la instancia de Leaflet al destruirse el componente: libera sus
   * listeners internos (drag, zoom, resize) y el DOM del mapa, evitando la
   * fuga de memoria si el usuario navega repetidamente hacia/desde esta vista.
   * `stationsLayer` y sus marcadores se destruyen junto con el mapa: Leaflet
   * los trata como una capa más, igual que el control de zoom.
   */
  ngOnDestroy(): void {
    if (this.invalidateSizeTimeoutId !== null) {
      clearTimeout(this.invalidateSizeTimeoutId);
      this.invalidateSizeTimeoutId = null;
    }
    // `map.remove()` desengancha también los listeners registrados con
    // `map.on(...)` (incluidos `popupopen`/`popupclose`) — no hace falta un
    // `map.off(...)` explícito aparte.
    this.map?.remove();
    this.map = null;
    this.userMarker = null;
    this.stationsLayer = null;
    this.estacionesPorId.clear();
    this.openPopupButton = null;
    this.openPopupStationId = null;
  }

  /** Handler del `(ionChange)` del `ion-select`: solo actualiza la signal; `redraw()` se dispara solo vía el `effect` del constructor. */
  protected onFuelChange(event: SelectCustomEvent): void {
    const value = event.detail.value;
    if (value === 'gasolina95' || value === 'gasolina98' || value === 'diesel') {
      this.selectedFuel.set(value);
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
   * las estaciones filtradas, ordena de menor a mayor distancia y SOLO
   * DESPUÉS recorta a `MAX_ESTACIONES_EN_MAPA`. El orden importa: si se
   * recortara antes de filtrar (o se filtrara solo dentro de un recorte ya
   * hecho por distancia global), las 50 más cercanas "reales" que sí tienen
   * el combustible elegido podrían quedar fuera en favor de estaciones más
   * cercanas mundialmente pero sin ese combustible, o de estaciones ya
   * descartadas del recorte inicial (ver `docs/features/04-filtros-combustible.md`).
   */
  private redraw(): void {
    // `fuel` se lee SIEMPRE en la primera línea, antes de cualquier `return`
    // anticipado. Un `effect()` solo registra como dependencia los signals
    // que efectivamente se leen durante una ejecución dada: si el primer
    // disparo del efecto (justo tras construirse el componente, con
    // `origenCache` aún `null`) hubiera cortado en el guard de abajo sin
    // llegar a leer `selectedFuel()`, Angular no habría registrado ninguna
    // dependencia — y el efecto jamás se habría vuelto a ejecutar al
    // cambiar de combustible después (el bug real reportado: el mapa se
    // quedaba siempre con el combustible por defecto).
    const fuel = this.selectedFuel();
    const origen = this.origenCache;
    if (!this.map || !this.stationsLayer || !origen) {
      return;
    }

    const conCombustible = this.estacionesCache.filter((estacion) => estacion.precios[fuel] !== null);

    const masCercanas = conCombustible
      .map((estacion) => ({ estacion, distanciaKm: haversineDistanceKm(origen, estacion) }))
      .sort((a, b) => a.distanciaKm - b.distanciaKm)
      .slice(0, MAX_ESTACIONES_EN_MAPA);

    // Limpia los marcadores de una carga (o filtro) anterior antes de dibujar
    // los nuevos (evita acumular marcadores huérfanos).
    this.stationsLayer.clearLayers();
    // Reconstruido en cada redraw junto con los marcadores: solo necesita
    // contener las estaciones actualmente dibujadas (las únicas con un
    // botón de favorito en el DOM que pueda pulsarse).
    this.estacionesPorId.clear();

    for (const { estacion } of masCercanas) {
      this.estacionesPorId.set(estacion.id, estacion);

      L.marker([estacion.lat, estacion.lng], {
        icon: STATION_ICON,
        title: `Gasolinera ${estacion.marca} en ${estacion.municipio}`,
      })
        .bindPopup(this.buildPopupHtml(estacion, fuel), { className: 'gas-station-popup' })
        .addTo(this.stationsLayer);
    }
  }

  /**
   * HTML del popup de cada gasolinera: solo el precio del combustible
   * seleccionado (nunca los 3). Solo interpola `marca` (tipo cerrado
   * `GasStationBrand`, generado por `MitecoService`, nunca texto libre de la
   * API), la etiqueta fija del combustible y un precio numérico — nunca
   * campos de texto libre de la fuente externa (`direccion`/`municipio`),
   * para no introducir HTML/JS arbitrario en el mapa vía `bindPopup` (que
   * interpreta el string como HTML).
   *
   * `favoriteIds()` se lee dentro de `untracked()` (RF-04): esta función se
   * invoca desde `redraw()`, que corre dentro del `effect()` cuya ÚNICA
   * dependencia reactiva debe ser `selectedFuel` (ver comentario del
   * constructor). Sin `untracked()`, cada alta/baja de favorito volvería a
   * disparar ese efecto y redibujaría los ~50 marcadores del mapa entero.
   */
  private buildPopupHtml(estacion: GasStation, fuel: FuelKey): string {
    const precio = estacion.precios[fuel];
    // Invariante: `redraw()` ya filtró por `precios[fuel] !== null` antes de
    // llegar aquí, pero se mantiene el guard por si esta función se reutiliza
    // alguna vez con una estación sin filtrar previamente.
    const precioTexto = precio !== null ? `${precio.toFixed(3)} €` : 'No disponible';
    const esFavorito = untracked(() => this.favoriteIds()).has(estacion.id);

    return `
      <strong class="gas-station-popup__marca">${estacion.marca}</strong>
      <p class="gas-station-popup__precio">${FUEL_LABELS[fuel]}: ${precioTexto}</p>
      ${this.buildFavoriteButtonHtml(estacion.id, esFavorito)}
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
