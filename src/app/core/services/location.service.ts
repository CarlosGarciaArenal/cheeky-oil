import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Geolocation, type Position } from '@capacitor/geolocation';
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
 * Geolocalización basada en el plugin oficial `@capacitor/geolocation` (sin
 * SDKs de pago), en línea con la regla de coste cero. En web delega
 * internamente en `navigator.geolocation` (mismo comportamiento que antes);
 * en Android/iOS usa el GPS nativo y gestiona el diálogo de permisos del
 * sistema operativo, algo que la API `navigator.geolocation` cruda no hacía
 * de forma fiable dentro del WebView de la app empaquetada (ver
 * `docs/features/02-mapa-base.md`).
 */
@Injectable({ providedIn: 'root' })
export class LocationService {

  /** Indica si el dispositivo/navegador soporta geolocalización. En nativo siempre `true` (el plugin gestiona permiso/GPS); en web depende de `navigator.geolocation`. */
  isSupported(): boolean {
    return Capacitor.isNativePlatform() || (typeof navigator !== 'undefined' && !!navigator.geolocation);
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

      Geolocation.getCurrentPosition({
        enableHighAccuracy: opts.enableHighAccuracy,
        timeout: opts.timeoutMs,
        maximumAge: opts.maximumAgeMs,
      })
        .then((position) => {
          subscriber.next(this.toCoordinates(position));
          subscriber.complete();
        })
        .catch((error: unknown) => subscriber.error(this.toError(error)));
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

      // `Geolocation.watchPosition` registra el watcher de forma ASÍNCRONA
      // (devuelve `Promise<CallbackID>`), a diferencia de `navigator.geolocation.watchPosition`
      // (síncrono). Si el Observable se desuscribe ANTES de que esa promesa
      // resuelva, `watchId` seguiría siendo `null` en la función de teardown
      // de más abajo y el watcher quedaría huérfano (fuga de GPS/batería) —
      // `cancelled` cubre exactamente esa ventana: en cuanto llega el id, se
      // limpia inmediatamente si ya se había pedido cancelar.
      let cancelled = false;
      let watchId: string | null = null;

      Geolocation.watchPosition(
        {
          enableHighAccuracy: opts.enableHighAccuracy,
          timeout: opts.timeoutMs,
          maximumAge: opts.maximumAgeMs,
        },
        (position, error) => {
          if (error) {
            subscriber.error(this.toError(error));
            return;
          }
          if (position) {
            subscriber.next(this.toCoordinates(position));
          }
        },
      )
        .then((id) => {
          if (cancelled) {
            void Geolocation.clearWatch({ id });
          } else {
            watchId = id;
          }
        })
        // En Android, si el permiso se deniega, el plugin lo comunica como
        // rechazo de ESTA promesa de registro (no como `error` del callback
        // de arriba): `startWatch()` -en el lado nativo- solo marca la
        // llamada como "keepAlive" (canal por el que llegarían los `error`
        // del callback) DESPUÉS de comprobar el permiso; si se deniega, el
        // primer y único mensaje que envía el plugin es este rechazo. Sin
        // este `.catch()`, ese permiso denegado se perdía como una promesa
        // rechazada sin gestionar y el Observable se quedaba colgado, sin
        // emitir jamás `subscriber.error(...)` (hallazgo de la auditoría
        // [REVIEWER], ver `docs/features/02-mapa-base.md`).
        .catch((error: unknown) => subscriber.error(this.toError(error)));

      return () => {
        cancelled = true;
        if (watchId) {
          void Geolocation.clearWatch({ id: watchId });
        }
      };
    });
  }

  private toCoordinates(position: Position): Coordinates {
    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    };
  }

  /**
   * Traduce el error a un mensaje en español. Cubre DOS formatos distintos
   * (verificado leyendo el código fuente de `@capacitor/geolocation`):
   * en web el plugin reenvía el `GeolocationPositionError` crudo del
   * navegador (`code` numérico 1/2/3); en Android/iOS el plugin lanza sus
   * propios errores con `code` de tipo string (`OS-PLUG-GLOC-000X`).
   */
  private toError(error: unknown): Error {
    const { code, message } = (error ?? {}) as { code?: number | string; message?: string };

    switch (code) {
      case 1: // GeolocationPositionError.PERMISSION_DENIED (web)
      case 'OS-PLUG-GLOC-0003': // permiso denegado (nativo)
        return new Error('Permiso de ubicación denegado por el usuario.');
      case 2: // GeolocationPositionError.POSITION_UNAVAILABLE (web)
      case 'OS-PLUG-GLOC-0002': // posición no disponible (nativo)
        return new Error('Ubicación no disponible.');
      case 3: // GeolocationPositionError.TIMEOUT (web)
      case 'OS-PLUG-GLOC-0010': // timeout (nativo)
        return new Error('Tiempo de espera agotado al obtener la ubicación.');
      case 'OS-PLUG-GLOC-0007': // servicios de ubicación desactivados (nativo)
        return new Error('Los servicios de ubicación están desactivados en el dispositivo.');
      default:
        return new Error(message ?? 'Error desconocido de geolocalización.');
    }
  }
}
