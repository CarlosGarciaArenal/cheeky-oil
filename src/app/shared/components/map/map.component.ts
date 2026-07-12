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

import { Coordinates, LocationService } from '../../../core/services/location.service';

/** Centro por defecto (Madrid) mientras se resuelve o si falla la geolocalización. */
const DEFAULT_CENTER: L.LatLngTuple = [40.4168, -3.7038];
const DEFAULT_ZOOM = 13;
const USER_ZOOM = 15;

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

  private readonly locationService = inject(LocationService);
  private readonly destroyRef = inject(DestroyRef);

  private map: L.Map | null = null;
  private userMarker: L.Marker | null = null;

  ngAfterViewInit(): void {
    this.map = L.map(this.mapContainerRef.nativeElement, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(this.map);

    this.locationService
      .getCurrentPosition()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (coords) => this.centerOnUser(coords),
        error: (error: Error) => this.locationError.set(error.message),
      });
  }

  /**
   * Destruye la instancia de Leaflet al destruirse el componente: libera sus
   * listeners internos (drag, zoom, resize) y el DOM del mapa, evitando la
   * fuga de memoria si el usuario navega repetidamente hacia/desde esta vista.
   */
  ngOnDestroy(): void {
    this.map?.remove();
    this.map = null;
    this.userMarker = null;
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
}
