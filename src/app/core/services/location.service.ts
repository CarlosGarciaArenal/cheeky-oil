import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

/**
 * Coordenadas geográficas simples (WGS84), desacopladas de cualquier
 * proveedor de mapas (compatibles con `GasStation.lat`/`lng` y con Leaflet).
 */
export interface Coordinates {
  lat: number;
  lng: number;
}

/** Subconjunto de `PositionOptions` que la app necesita exponer. */
export interface LocationOptions {
  enableHighAccuracy?: boolean;
  timeoutMs?: number;
  maximumAgeMs?: number;
}

const DEFAULT_OPTIONS: Required<LocationOptions> = {
  enableHighAccuracy: true,
  timeoutMs: 10000,
  maximumAgeMs: 30000,
};

/**
 * Geolocalización basada en la API nativa `navigator.geolocation` del
 * navegador/WebView (sin SDKs de pago), en línea con la regla de coste cero.
 */
@Injectable({ providedIn: 'root' })
export class LocationService {

  /** Indica si el dispositivo/navegador soporta geolocalización. */
  isSupported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.geolocation;
  }

  /**
   * Obtiene la posición actual una única vez.
   * El Observable emite un valor y se completa (no requiere unsubscribe manual).
   */
  getCurrentPosition(options: LocationOptions = {}): Observable<Coordinates> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    return new Observable<Coordinates>((subscriber) => {
      if (!this.isSupported()) {
        subscriber.error(new Error('Geolocalización no soportada en este dispositivo.'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          subscriber.next(this.toCoordinates(position));
          subscriber.complete();
        },
        (error) => subscriber.error(this.toError(error)),
        {
          enableHighAccuracy: opts.enableHighAccuracy,
          timeout: opts.timeoutMs,
          maximumAge: opts.maximumAgeMs,
        },
      );
    });
  }

  /**
   * Observa la posición del usuario de forma continua (para centrar el mapa
   * en tiempo real). La función de teardown del Observable llama a
   * `clearWatch` automáticamente al desuscribirse, por lo que basta con que
   * el consumidor use `takeUntilDestroyed()` (o cancele en `ngOnDestroy`)
   * para liberar el GPS y evitar fugas de batería/memoria.
   */
  watchPosition(options: LocationOptions = {}): Observable<Coordinates> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    return new Observable<Coordinates>((subscriber) => {
      if (!this.isSupported()) {
        subscriber.error(new Error('Geolocalización no soportada en este dispositivo.'));
        return;
      }

      const watchId = navigator.geolocation.watchPosition(
        (position) => subscriber.next(this.toCoordinates(position)),
        (error) => subscriber.error(this.toError(error)),
        {
          enableHighAccuracy: opts.enableHighAccuracy,
          timeout: opts.timeoutMs,
          maximumAge: opts.maximumAgeMs,
        },
      );

      return () => navigator.geolocation.clearWatch(watchId);
    });
  }

  private toCoordinates(position: GeolocationPosition): Coordinates {
    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    };
  }

  private toError(error: GeolocationPositionError): Error {
    switch (error.code) {
      case error.PERMISSION_DENIED:
        return new Error('Permiso de ubicación denegado por el usuario.');
      case error.POSITION_UNAVAILABLE:
        return new Error('Ubicación no disponible.');
      case error.TIMEOUT:
        return new Error('Tiempo de espera agotado al obtener la ubicación.');
      default:
        return new Error('Error desconocido de geolocalización.');
    }
  }
}
