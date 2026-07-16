import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  InputCustomEvent,
  IonButton,
  IonContent,
  IonIcon,
  IonInput,
  IonItem,
  IonList,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonText,
  SelectCustomEvent,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { flagOutline, locateOutline, mapOutline, navigateOutline } from 'ionicons/icons';
import { firstValueFrom } from 'rxjs';
import * as L from 'leaflet';

import { FuelType, GasStation } from '../../core/models/gas-station.model';
import { Coordinates as RouteCoordinates } from '../../core/models/route.model';
import { FavoritesService } from '../../core/services/favorites.service';
import { LocationService } from '../../core/services/location.service';
import { MitecoService } from '../../core/services/miteco.service';
import { RoutingService } from '../../core/services/routing.service';
import { FAV_BUTTON_CLASS, FAVORITE_ICON, STATION_ICON, buildGasStationPopupHtml } from '../../shared/components/map/gas-station-popup';

/**
 * Etiquetas de combustible para el selector de esta página. Deliberadamente
 * un `Record` local pequeño (3 entradas), TERCERA copia en el proyecto
 * (`MapComponent`, `FavoritesPanelPage`, y esta) — mismo criterio ya
 * documentado en `gas-station.model.ts`: 3 strings no justifican una
 * abstracción compartida solo porque hay un tercer consumidor, a diferencia
 * del popup de gasolinera (`gas-station-popup.ts`, `[[09-rutas]]`), donde SÍ
 * mereció la pena extraer por su complejidad y sensibilidad de seguridad.
 */
const FUEL_LABELS: Record<FuelType, string> = {
  gasolina95: 'Gasolina 95',
  gasolina98: 'Gasolina 98',
  diesel: 'Diésel',
};

const DEFAULT_FUEL: FuelType = 'gasolina95';

/** Opción del selector de desvío máximo (ver plantilla). Valores fijados por el encargo: 1/3/5 km. */
interface DeviationOption {
  value: number;
  label: string;
}

const DEVIATION_OPTIONS: DeviationOption[] = [
  { value: 1, label: '1 km' },
  { value: 3, label: '3 km' },
  { value: 5, label: '5 km' },
];

const DEFAULT_MAX_DEVIATION_KM = 3;

/**
 * Texto que se muestra en el campo "Origen" tras pulsar "Usar mi ubicación".
 * Se compara literalmente en `onOriginInput` para detectar si el usuario
 * edita el campo DESPUÉS de haber usado la geolocalización — en ese caso se
 * abandona el modo "mi ubicación" y el campo vuelve a tratarse como texto
 * libre a geocodificar (ver `onOriginInput`).
 */
const MY_LOCATION_LABEL = 'Mi ubicación actual';

/** Mismos colores/iconos de origen y destino en todo el mapa: verde para "salida", rojo para "llegada" — codificación de color estándar en cualquier planificador de rutas. */
const ORIGIN_MARKER_COLOR = '#16A34A';
const DESTINATION_MARKER_COLOR = '#DC2626';

const ORIGIN_ICON = L.divIcon({
  className: 'app-map-icon app-map-icon--origin',
  html: `<span class="app-map-icon__dot" style="background:${ORIGIN_MARKER_COLOR}"></span>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  popupAnchor: [0, -12],
});

const DESTINATION_ICON = L.divIcon({
  className: 'app-map-icon app-map-icon--destination',
  html: `<span class="app-map-icon__dot" style="background:${DESTINATION_MARKER_COLOR}"></span>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  popupAnchor: [0, -12],
});

/** Grosor de la línea de ruta ("azul, gruesa", pedido explícitamente en el encargo). */
const ROUTE_LINE_COLOR = '#2563EB';
const ROUTE_LINE_WEIGHT = 6;

/**
 * Planificador de Rutas (RF faltante, `[[09-rutas]]`): busca origen/destino
 * por texto (o geolocalización para el origen), calcula la ruta en coche
 * (OSRM, vía `RoutingService`) y dibuja tanto la línea de la ruta como las
 * gasolineras favoritas-compatibles que quedan a `maxDeviationKm` o menos de
 * desvío (Turf.js, mismo `RoutingService`).
 *
 * Mapa Leaflet PROPIO de esta página (no reutiliza `MapComponent`, que está
 * pensado para "gasolineras cerca de mí" con sus propios filtros de
 * combustible/radio, un mapa a pantalla completa y sin línea de ruta) —
 * pero SÍ reutiliza el popup exacto de gasolinera (`gas-station-popup.ts`,
 * ver su documentación) y replica la misma estructura de cableado con
 * estado (favoritos, `popupopen`/`popupclose`) ya probada y auditada en
 * `MapComponent`, adaptada a que aquí los marcadores se dibujan bajo
 * demanda (al pulsar "Calcular Ruta"), no de forma continuamente reactiva a
 * un filtro.
 */
@Component({
  selector: 'app-route-planner',
  templateUrl: './route-planner.page.html',
  styleUrl: './route-planner.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    IonButton,
    IonContent,
    IonIcon,
    IonInput,
    IonItem,
    IonList,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonText,
  ],
})
export class RoutePlannerPage implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: true })
  private readonly mapContainerRef!: ElementRef<HTMLDivElement>;

  private readonly routingService = inject(RoutingService);
  private readonly mitecoService = inject(MitecoService);
  private readonly locationService = inject(LocationService);
  private readonly favoritesService = inject(FavoritesService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly originText = signal('');
  protected readonly destinationText = signal('');
  /** `true` mientras el campo Origen refleja la ubicación resuelta por geolocalización (ver `MY_LOCATION_LABEL`) — evita volver a geocodificar un texto que ya tiene coordenadas exactas. */
  protected readonly originIsMyLocation = signal(false);
  protected readonly resolvingLocation = signal(false);

  protected readonly fuelLabels = FUEL_LABELS;
  protected readonly selectedFuel = signal<FuelType>(DEFAULT_FUEL);
  protected readonly deviationOptions = DEVIATION_OPTIONS;
  protected readonly maxDeviationKm = signal<number>(DEFAULT_MAX_DEVIATION_KM);

  protected readonly calculating = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  /** `null` = todavía no se ha calculado ninguna ruta; un número (incluido `0`) = resultado de la última ruta calculada. */
  protected readonly matchedStationsCount = signal<number | null>(null);

  /** Coordenadas resueltas por geolocalización para el origen (`{lat, lon}`, formato de `RoutingService`) — `null` si el origen actual es texto libre sin resolver todavía. */
  private originCoords: RouteCoordinates | null = null;

  private map: L.Map | null = null;
  private routeLayer: L.GeoJSON | null = null;
  private originMarker: L.Marker | null = null;
  private destinationMarker: L.Marker | null = null;
  /** Mismo patrón que `MapComponent.stationsLayer`: todas las gasolineras en un `L.LayerGroup` propio para poder limpiarlas con una sola llamada antes de dibujar el resultado de una nueva ruta. */
  private stationsLayer: L.LayerGroup | null = null;
  private resizeObserver: ResizeObserver | null = null;

  /** `GasStation` por id, reconstruido en cada cálculo de ruta — mismo propósito que en `MapComponent`: que `onFavoriteButtonClick` recupere el objeto completo sin guardar una referencia por marcador. */
  private estacionesPorId = new Map<string, GasStation>();
  private markersPorId = new Map<string, L.Marker>();
  private openPopupButton: HTMLButtonElement | null = null;
  private openPopupStationId: string | null = null;
  private favoriteIds = new Set<string>();

  constructor() {
    addIcons({ flagOutline, locateOutline, mapOutline, navigateOutline });
  }

  ngAfterViewInit(): void {
    this.map = L.map(this.mapContainerRef.nativeElement, {
      center: [40.4168, -3.7038],
      zoom: 6,
      zoomControl: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(this.map);

    // Mismo motivo que en `MapComponent`: si el contenedor todavía no tiene
    // su tamaño final resuelto cuando se crea el mapa (la propia transición
    // de entrada de Ionic hacia esta página), Leaflet calcula mal las
    // dimensiones y los tiles quedan rotos hasta que algo fuerza un
    // recálculo — `ResizeObserver` cubre tanto la carga inicial como
    // cualquier cambio de tamaño posterior sin apostar por un `setTimeout`.
    this.resizeObserver = new ResizeObserver(() => this.map?.invalidateSize());
    this.resizeObserver.observe(this.mapContainerRef.nativeElement);

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    this.stationsLayer = L.layerGroup().addTo(this.map);

    this.map.on('popupopen', (event: L.PopupEvent) => this.onPopupOpen(event));
    this.map.on('popupclose', (event: L.PopupEvent) => this.onPopupClose(event));

    this.subscribeFavorites();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    // `map.remove()` desengancha también los listeners registrados con `map.on(...)`.
    this.map?.remove();
    this.map = null;
    this.routeLayer = null;
    this.originMarker = null;
    this.destinationMarker = null;
    this.stationsLayer = null;
    this.estacionesPorId.clear();
    this.markersPorId.clear();
    this.openPopupButton = null;
    this.openPopupStationId = null;
  }

  /**
   * Favoritos del usuario activo, en vivo (RF-04) — mismo listener que
   * `MapComponent`, pero un único `subscribe` (no dos `effect()` separados):
   * aquí los marcadores NO se redibujan de forma continuamente reactiva a
   * ningún filtro (solo al pulsar "Calcular Ruta"), así que no existe el
   * riesgo que sí justificaba separar los dos efectos en `MapComponent`
   * (una redibujada completa del mapa en cada alta/baja de favorito) — un
   * único callback que sincroniza icono + botón del popup abierto es
   * suficiente y más simple.
   */
  private subscribeFavorites(): void {
    try {
      this.favoritesService
        .getFavorites()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (favoritos) => {
            this.favoriteIds = new Set(favoritos.map((favorito) => favorito.id));
            this.syncOpenPopupButton();
            this.syncMarkerIcons();
          },
          error: (error: Error) => this.errorMessage.set(error.message),
        });
    } catch (error: unknown) {
      this.errorMessage.set(error instanceof Error ? error.message : 'No se pudieron cargar los favoritos.');
    }
  }

  protected onOriginInput(event: InputCustomEvent): void {
    const value = event.detail.value;
    const text = typeof value === 'string' ? value : '';
    this.originText.set(text);
    // El usuario ha editado el campo tras usar "Usar mi ubicación": ya no
    // representa esa ubicación exacta, vuelve a tratarse como texto libre a
    // geocodificar en el próximo cálculo de ruta.
    if (this.originIsMyLocation() && text !== MY_LOCATION_LABEL) {
      this.originIsMyLocation.set(false);
      this.originCoords = null;
    }
  }

  protected onDestinationInput(event: InputCustomEvent): void {
    const value = event.detail.value;
    this.destinationText.set(typeof value === 'string' ? value : '');
  }

  protected onFuelChange(event: SelectCustomEvent): void {
    const value = event.detail.value;
    if (value === 'gasolina95' || value === 'gasolina98' || value === 'diesel') {
      this.selectedFuel.set(value);
    }
  }

  protected onDeviationChange(event: SelectCustomEvent): void {
    const value = event.detail.value;
    if (typeof value === 'number') {
      this.maxDeviationKm.set(value);
    }
  }

  /** Resuelve el origen por geolocalización (`LocationService`, ya en uso en `MapComponent`), sin pasar por Nominatim: ya tenemos coordenadas exactas, geocodificar un texto sería un paso innecesario y una petición de más a un servicio de terceros con cuota limitada. */
  protected async useMyLocation(): Promise<void> {
    if (this.resolvingLocation()) {
      return;
    }

    this.resolvingLocation.set(true);
    this.errorMessage.set(null);
    try {
      const coords = await firstValueFrom(this.locationService.getCurrentPosition());
      this.originCoords = { lat: coords.lat, lon: coords.lng };
      this.originText.set(MY_LOCATION_LABEL);
      this.originIsMyLocation.set(true);
    } catch (error: unknown) {
      this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo obtener tu ubicación.');
    } finally {
      this.resolvingLocation.set(false);
    }
  }

  /**
   * Orquesta el flujo completo: geocodifica origen/destino (o reutiliza las
   * coordenadas ya resueltas por geolocalización), calcula la ruta (OSRM),
   * descarga TODAS las gasolineras de España (MITECO) y las filtra por
   * combustible + desvío máximo (Turf.js, `RoutingService.filterStationsAlongRoute`),
   * y dibuja el resultado. Cualquier fallo en cualquier paso (geocodificación
   * sin resultados, OSRM sin ruta, red caída) se captura en un único
   * `catch` y se muestra como `errorMessage` — el usuario nunca ve un error
   * técnico sin traducir.
   */
  protected async calculateRoute(): Promise<void> {
    if (this.calculating()) {
      return;
    }
    if (!this.originText().trim() || !this.destinationText().trim()) {
      this.errorMessage.set('Indica un origen y un destino para calcular la ruta.');
      return;
    }

    this.calculating.set(true);
    this.errorMessage.set(null);
    this.matchedStationsCount.set(null);
    this.clearRouteLayers();

    try {
      const [origen, destino] = await Promise.all([this.resolveOrigin(), this.resolveDestination()]);

      const ruta = await firstValueFrom(this.routingService.getRoute(origen, destino));

      const estaciones = await firstValueFrom(this.mitecoService.getEstaciones());
      const conCombustible = estaciones.filter((estacion) => estacion.precios[this.selectedFuel()] !== null);
      const cercanas = this.routingService.filterStationsAlongRoute(
        ruta.geometry,
        conCombustible,
        this.maxDeviationKm(),
      );

      this.drawRoute(ruta.geometry, origen, destino);
      this.drawStations(cercanas);
      this.matchedStationsCount.set(cercanas.length);
    } catch (error: unknown) {
      this.errorMessage.set(error instanceof Error ? error.message : 'No se ha podido calcular la ruta.');
    } finally {
      this.calculating.set(false);
    }
  }

  /** Si el origen viene de "Usar mi ubicación", reutiliza esas coordenadas exactas; si no, geocodifica el texto libre con Nominatim (`RoutingService.geocode`) y toma la primera coincidencia. */
  private async resolveOrigin(): Promise<RouteCoordinates> {
    if (this.originIsMyLocation() && this.originCoords) {
      return this.originCoords;
    }
    return this.geocodeFirstMatch(this.originText(), 'origen');
  }

  private async resolveDestination(): Promise<RouteCoordinates> {
    return this.geocodeFirstMatch(this.destinationText(), 'destino');
  }

  private async geocodeFirstMatch(query: string, campo: 'origen' | 'destino'): Promise<RouteCoordinates> {
    const resultados = await firstValueFrom(this.routingService.geocode(query));
    if (resultados.length === 0) {
      throw new Error(`No se ha encontrado "${query}" como ${campo}. Prueba con una dirección más específica.`);
    }
    const [primero] = resultados;
    return { lat: primero.lat, lon: primero.lon };
  }

  /** Limpia la línea de ruta y los marcadores de origen/destino/gasolineras de un cálculo anterior, antes de dibujar uno nuevo. */
  private clearRouteLayers(): void {
    this.routeLayer?.remove();
    this.routeLayer = null;
    this.originMarker?.remove();
    this.originMarker = null;
    this.destinationMarker?.remove();
    this.destinationMarker = null;
    this.stationsLayer?.clearLayers();
    this.estacionesPorId.clear();
    this.markersPorId.clear();
  }

  /**
   * Dibuja la línea GeoJSON de la ruta (azul, gruesa, pedido explícitamente
   * en el encargo) y los marcadores de origen/destino, y centra el mapa con
   * `fitBounds` para que se vea la ruta ENTERA — pedido explícitamente en el
   * encargo, en vez de solo centrar en un punto con un zoom fijo (que
   * podría dejar fuera de la vista una ruta larga).
   */
  private drawRoute(geometry: GeoJSON.LineString, origen: RouteCoordinates, destino: RouteCoordinates): void {
    if (!this.map) {
      return;
    }

    this.routeLayer = L.geoJSON(geometry, {
      style: { color: ROUTE_LINE_COLOR, weight: ROUTE_LINE_WEIGHT },
    }).addTo(this.map);

    this.originMarker = L.marker([origen.lat, origen.lon], { icon: ORIGIN_ICON, title: 'Origen' })
      .addTo(this.map)
      .bindPopup('Origen');
    this.destinationMarker = L.marker([destino.lat, destino.lon], { icon: DESTINATION_ICON, title: 'Destino' })
      .addTo(this.map)
      .bindPopup('Destino');

    this.map.fitBounds(this.routeLayer.getBounds(), { padding: [32, 32] });
  }

  /** Dibuja los marcadores de gasolinera, reutilizando el icono/popup EXACTOS de `MapComponent` (`gas-station-popup.ts`, `[[09-rutas]]`), con botón de Favoritos y "Cómo llegar". */
  private drawStations(stations: GasStation[]): void {
    if (!this.stationsLayer) {
      return;
    }

    const fuel = this.selectedFuel();
    const fuelLabel = FUEL_LABELS[fuel];

    for (const estacion of stations) {
      this.estacionesPorId.set(estacion.id, estacion);

      const esFavorito = this.favoriteIds.has(estacion.id);
      const marker = L.marker([estacion.lat, estacion.lng], {
        icon: esFavorito ? FAVORITE_ICON : STATION_ICON,
        title: `Gasolinera ${estacion.marca} en ${estacion.municipio}`,
      })
        .bindPopup(buildGasStationPopupHtml(estacion, fuel, fuelLabel, esFavorito), { className: 'gas-station-popup' })
        .addTo(this.stationsLayer);

      this.markersPorId.set(estacion.id, marker);
    }
  }

  /**
   * Cableado con estado del botón de favorito del popup — misma estructura
   * ya probada y auditada en `MapComponent` (ver justificación completa de
   * por qué `popupopen`/`popupclose` son el único punto de entrada real
   * entre el HTML plano de Leaflet y Angular en `docs/features/06-favoritos.md`),
   * adaptada a los campos propios de este componente.
   */
  private onPopupOpen(event: L.PopupEvent): void {
    const boton = event.popup.getElement()?.querySelector<HTMLButtonElement>(`.${FAV_BUTTON_CLASS}`);
    const stationId = boton?.dataset['stationId'];
    if (!boton || !stationId) {
      return;
    }

    this.openPopupButton = boton;
    this.openPopupStationId = stationId;
    this.setFavoriteButtonState(boton, this.favoriteIds.has(stationId));

    if (boton.dataset['favBound'] === 'true') {
      return;
    }
    boton.dataset['favBound'] = 'true';
    boton.addEventListener('click', () => this.onFavoriteButtonClick(stationId, boton));
  }

  private onPopupClose(event: L.PopupEvent): void {
    const boton = event.popup.getElement()?.querySelector<HTMLButtonElement>(`.${FAV_BUTTON_CLASS}`);
    if (boton && boton === this.openPopupButton) {
      this.openPopupButton = null;
      this.openPopupStationId = null;
    }
  }

  private onFavoriteButtonClick(stationId: string, boton: HTMLButtonElement): void {
    const estacion = this.estacionesPorId.get(stationId);
    if (!estacion) {
      return;
    }

    const eraFavorito = this.favoriteIds.has(stationId);
    boton.disabled = true;

    const operacion = eraFavorito
      ? this.favoritesService.removeFavorite(stationId)
      : this.favoritesService.addFavorite(estacion);

    operacion
      .catch((error: unknown) => {
        this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo actualizar el favorito.');
      })
      .finally(() => {
        boton.disabled = false;
      });
  }

  private syncOpenPopupButton(): void {
    if (!this.openPopupButton || !this.openPopupStationId) {
      return;
    }
    this.setFavoriteButtonState(this.openPopupButton, this.favoriteIds.has(this.openPopupStationId));
  }

  private syncMarkerIcons(): void {
    for (const [stationId, marker] of this.markersPorId) {
      marker.setIcon(this.favoriteIds.has(stationId) ? FAVORITE_ICON : STATION_ICON);
    }
  }

  private setFavoriteButtonState(boton: HTMLButtonElement, esFavorito: boolean): void {
    boton.textContent = esFavorito ? 'Quitar ⭐' : '⭐ Guardar';
    boton.setAttribute('aria-pressed', String(esFavorito));
    boton.classList.toggle(`${FAV_BUTTON_CLASS}--active`, esFavorito);
  }
}
