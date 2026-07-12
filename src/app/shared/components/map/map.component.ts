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
import * as L from 'leaflet';

import { GasStation } from '../../../core/models/gas-station.model';
import { Coordinates, LocationService } from '../../../core/services/location.service';
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

/**
 * Iconos de marcador servidos como assets propios (`assets/leaflet/`, copiados
 * desde `node_modules/leaflet/dist/images` vía `angular.json`) en lugar de
 * apuntar a una CDN: coste cero y funciona offline/sin depender de terceros.
 */
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'assets/leaflet/marker-icon-2x.png',
  iconUrl: 'assets/leaflet/marker-icon.png',
  shadowUrl: 'assets/leaflet/marker-shadow.png',
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
})
export class MapComponent implements AfterViewInit, OnDestroy {
  @ViewChild('mapContainer', { static: true })
  private readonly mapContainerRef!: ElementRef<HTMLDivElement>;

  /** Mensaje de error de geolocalización, mostrado de forma accesible bajo el mapa. */
  protected readonly locationError = signal<string | null>(null);
  /** Mensaje de error de carga de gasolineras, mostrado de forma accesible bajo el mapa. */
  protected readonly stationsError = signal<string | null>(null);

  private readonly locationService = inject(LocationService);
  private readonly mitecoService = inject(MitecoService);
  private readonly destroyRef = inject(DestroyRef);

  private map: L.Map | null = null;
  private userMarker: L.Marker | null = null;
  /**
   * Todas las gasolineras se añaden a este `L.LayerGroup` (en vez de
   * directamente al mapa) para poder limpiarlas con una sola llamada
   * (`clearLayers()`) si en el futuro se recargan (ej. el usuario se mueve).
   * Se destruye junto con el resto del mapa en `ngOnDestroy` (`map.remove()`).
   */
  private stationsLayer: L.LayerGroup | null = null;

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

    // Controles de zoom reubicados abajo a la izquierda para no tapar
    // la cabecera de marca (arriba) ni futuros controles/FAB en la esquina
    // inferior derecha (ej. botón "centrar en mi ubicación").
    L.control.zoom({ position: 'bottomleft' }).addTo(this.map);

    this.stationsLayer = L.layerGroup().addTo(this.map);

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
    this.map?.remove();
    this.map = null;
    this.userMarker = null;
    this.stationsLayer = null;
  }

  private centerOnUser(coords: Coordinates): void {
    if (!this.map) {
      return;
    }

    const latLng: L.LatLngTuple = [coords.lat, coords.lng];
    this.map.setView(latLng, USER_ZOOM);

    this.userMarker = L.marker(latLng, { alt: 'Tu ubicación actual' })
      .addTo(this.map)
      .bindPopup('Estás aquí');
  }

  /**
   * Obtiene todas las estaciones de MITECO y dibuja únicamente las
   * `MAX_ESTACIONES_EN_MAPA` más cercanas a `origen` (ver justificación de
   * memoria en `docs/features/03-capa-gasolineras.md`).
   */
  private loadNearestStations(origen: Coordinates): void {
    this.mitecoService
      .getEstaciones()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (estaciones) => this.renderStations(estaciones, origen),
        error: (error: Error) => this.stationsError.set(error.message),
      });
  }

  private renderStations(estaciones: GasStation[], origen: Coordinates): void {
    if (!this.map || !this.stationsLayer) {
      return;
    }

    const masCercanas = estaciones
      .map((estacion) => ({ estacion, distanciaKm: haversineDistanceKm(origen, estacion) }))
      .sort((a, b) => a.distanciaKm - b.distanciaKm)
      .slice(0, MAX_ESTACIONES_EN_MAPA);

    // Limpia los marcadores de una carga anterior antes de dibujar los nuevos
    // (evita acumular marcadores huérfanos si este método se invoca más de una vez).
    this.stationsLayer.clearLayers();

    for (const { estacion } of masCercanas) {
      L.marker([estacion.lat, estacion.lng], { alt: `Gasolinera ${estacion.marca} en ${estacion.municipio}` })
        .bindPopup(this.buildPopupHtml(estacion))
        .addTo(this.stationsLayer);
    }
  }

  /**
   * HTML del popup de cada gasolinera. Solo interpola `marca` (tipo cerrado
   * `GasStationBrand`, generado por `MitecoService`, nunca texto libre de la
   * API) y precios numéricos — nunca campos de texto libre de la fuente
   * externa (`direccion`/`municipio`), para no introducir HTML/JS arbitrario
   * en el mapa vía `bindPopup` (que interpreta el string como HTML).
   */
  private buildPopupHtml(estacion: GasStation): string {
    const precio = (valor: number | null): string => (valor !== null ? `${valor.toFixed(3)} €` : 'No disponible');

    return `
      <strong>${estacion.marca}</strong>
      <ul class="gas-station-popup__precios">
        <li>Gasolina 95: ${precio(estacion.precios.gasolina95)}</li>
        <li>Gasolina 98: ${precio(estacion.precios.gasolina98)}</li>
        <li>Diésel: ${precio(estacion.precios.diesel)}</li>
      </ul>
    `;
  }
}
