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

  /**
   * Promesa de la petición de permiso NATIVA actualmente en curso (si hay
   * alguna), compartida entre `requestPermissions()`, `getCurrentPosition()`
   * y `watchPosition()`. Existe para evitar que dos llamadas de permiso
   * lleguen a estar en curso A LA VEZ contra el mismo plugin — verificado
   * leyendo el código fuente de Capacitor (`Plugin.java`,
   * `Bridge.savePermissionCall`/`getPermissionCall`): la cola de
   * `PluginCall` pendientes de un resultado de permiso se indexa SOLO por
   * plugin (`pluginId`), no por el método de callback nativo concreto
   * (`requestPermissions` usa el callback base `checkPermissions`;
   * `getCurrentPosition`/`watchPosition` usan `completeCurrentPosition`/
   * `completeWatchPosition`, cada uno con su propio `ActivityResultLauncher`).
   * Si dos de estas llamadas estuvieran en curso simultáneamente (posible
   * desde que `AppComponent` empezó a pedir el permiso al arrancar, además
   * de `MapComponent`/`RoutePlannerPage` al leer la posición), el que
   * termine resolvería la cola compartida y podría entregar SU resultado a
   * la promesa de JS equivocada (la de la OTRA llamada, que llegó antes a
   * la cola) — un cruce real de la plataforma, no una suposición. Serializar
   * aquí todas las llamadas que puedan disparar el diálogo de permiso evita
   * que ese cruce llegue a producirse.
   */
  private pendingPermissionRequest: Promise<void> | null = null;

  /** Indica si el dispositivo/navegador soporta geolocalización. En nativo siempre `true` (el plugin gestiona permiso/GPS); en web depende de `navigator.geolocation`. */
  isSupported(): boolean {
    return Capacitor.isNativePlatform() || (typeof navigator !== 'undefined' && !!navigator.geolocation);
  }

  /**
   * Dispara el diálogo nativo de permiso de ubicación de Android/iOS de
   * forma proactiva, sin pedir ninguna posición todavía. Pensado para
   * llamarse UNA vez al arrancar la app (`AppComponent`), para que ese
   * diálogo aparezca "al entrar por primera vez a la app" en vez de la
   * primera vez que `MapComponent` intente leer el GPS — mismo problema de
   * fondo ya corregido una vez (migración a `@capacitor/geolocation`, ver
   * `docs/features/02-mapa-base.md`): pedirlo pronto y de forma explícita
   * evita depender de que el primer componente que necesite ubicación se
   * monte a tiempo, sin cambiar en nada el comportamiento ya auditado de
   * `getCurrentPosition()`/`watchPosition()` (siguen pidiendo el permiso
   * ellos mismos si todavía no se ha concedido, por si esta llamada de
   * arranque fallase o el usuario reinstalara la app).
   *
   * No-op en web: `Geolocation.requestPermissions()` no está implementado
   * ahí (`GeolocationWeb.requestPermissions()` lanza `unimplemented`) — el
   * navegador ya muestra su propio diálogo la primera vez que
   * `navigator.geolocation` se usa de verdad, no hace falta ni es posible
   * anticiparlo.
   */
  async requestPermissions(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    await this.ensurePermissionRequest();
  }

  /**
   * Punto único por el que pasan TODAS las llamadas que pueden disparar el
   * diálogo nativo de permiso (`requestPermissions`, `getCurrentPosition`,
   * `watchPosition`). Si ya hay una en curso, devuelve esa MISMA promesa en
   * vez de iniciar una segunda — ver el porqué en el comentario de
   * `pendingPermissionRequest`.
   */
  private ensurePermissionRequest(): Promise<void> {
    if (!this.pendingPermissionRequest) {
      this.pendingPermissionRequest = Geolocation.requestPermissions()
        .then(() => undefined)
        .catch((error: unknown) => {
          // No bloqueante: p. ej. si los servicios de ubicación del sistema
          // están desactivados, `requestPermissions()` lanza (ver
          // `GeolocationErrors.LOCATION_DISABLED`) en vez de simplemente
          // devolver un permiso denegado. `getCurrentPosition()`/
          // `watchPosition()` ya muestran un error real y accesible cuando
          // de verdad intenten leer la posición justo después de esperar
          // esta misma promesa; aquí solo queda registrado, nunca rompe el
          // arranque de la app ni dejan sin resolver a quien esté esperando.
          console.error('No se pudo solicitar el permiso de ubicación:', error);
        })
        .finally(() => {
          this.pendingPermissionRequest = null;
        });
    }
    return this.pendingPermissionRequest;
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

      // Si `AppComponent` (u otra llamada) ya tiene una petición de permiso
      // nativa en curso, se espera a que termine ANTES de llamar a
      // `getCurrentPosition()` — nunca en paralelo con ella (ver
      // `pendingPermissionRequest`). En el caso normal (sin ninguna
      // petición pendiente) esto no añade ninguna espera real.
      (this.pendingPermissionRequest ?? Promise.resolve())
        .then(() =>
          Geolocation.getCurrentPosition({
            enableHighAccuracy: opts.enableHighAccuracy,
            timeout: opts.timeoutMs,
            maximumAge: opts.maximumAgeMs,
          }),
        )
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

      // Misma espera que en `getCurrentPosition()`: nunca se llama a
      // `Geolocation.watchPosition(...)` mientras otra petición de permiso
      // nativa siga en curso (ver `pendingPermissionRequest`).
      (this.pendingPermissionRequest ?? Promise.resolve())
        .then(() => {
          // El Observable pudo desuscribirse MIENTRAS se esperaba el
          // permiso, antes incluso de haber registrado ningún watcher real
          // — sin esta comprobación, se arrancaría un watch huérfano que
          // nadie llegaría a limpiar (la función de teardown de abajo ya se
          // habría ejecutado, con `watchId` todavía en `null` en ese momento).
          if (cancelled) {
            return;
          }

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
            // En Android, si el permiso se deniega, el plugin lo comunica
            // como rechazo de ESTA promesa de registro (no como `error` del
            // callback de arriba): `startWatch()` -en el lado nativo- solo
            // marca la llamada como "keepAlive" (canal por el que llegarían
            // los `error` del callback) DESPUÉS de comprobar el permiso; si
            // se deniega, el primer y único mensaje que envía el plugin es
            // este rechazo. Sin este `.catch()`, ese permiso denegado se
            // perdía como una promesa rechazada sin gestionar y el
            // Observable se quedaba colgado, sin emitir jamás
            // `subscriber.error(...)` (hallazgo de la auditoría [REVIEWER],
            // ver `docs/features/02-mapa-base.md`).
            .catch((error: unknown) => subscriber.error(this.toError(error)));
        });

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
        // Mensaje accionable a propósito: si el usuario ya denegó el
        // permiso dos veces, Android deja de mostrar su propio diálogo en
        // futuros intentos (comportamiento del sistema operativo, no algo
        // que la app pueda forzar) — sin indicar CÓMO activarlo a mano, el
        // usuario se queda sin ninguna salida real más que adivinarlo.
        return new Error(
          'Permiso de ubicación denegado. Actívalo desde los ajustes de tu dispositivo (Ajustes → Aplicaciones → Cheeky Oil → Permisos → Ubicación) para ver tu posición en el mapa.',
        );
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
