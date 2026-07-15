import { EnvironmentInjector, Injectable, inject, runInInjectionContext } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  documentId,
  getCountFromServer,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  where,
} from '@angular/fire/firestore';
import { Observable, combineLatest, from, map, of, tap, throwError } from 'rxjs';

import { AuthService } from './auth.service';
import { MitecoService } from './miteco.service';
import { FuelType, GasStation } from '../models/gas-station.model';
import { Favorite, FavoriteWithPrice } from '../models/favorite.model';
import { PriceHistoryDoc, PriceHistoryPoint } from '../models/price-history.model';
import { MAX_GASOLINERAS_GUARDADAS } from '../models/user.model';

/**
 * Gestiona la subcolección `users/{uid}/favorites` (RF-04). El id de cada
 * documento es `GasStation.id` (IDEESS): guardar una gasolinera ya guardada
 * es un `setDoc` idempotente (sobrescribe el mismo documento), sin necesidad
 * de consultar antes si ya existe, y evita duplicados por diseño.
 */
@Injectable({ providedIn: 'root' })
export class FavoritesService {
  private readonly authService = inject(AuthService);
  private readonly firestore = inject(Firestore);
  private readonly mitecoService = inject(MitecoService);
  /**
   * Capturado aquí (en el constructor del servicio, que SIEMPRE corre en
   * contexto de inyección) para poder restaurarlo más tarde dentro de
   * `getFavorites()` — ver justificación completa ahí.
   */
  private readonly environmentInjector = inject(EnvironmentInjector);

  private favoritesCollectionPath(uid: string): string {
    return `users/${uid}/favorites`;
  }

  private historyCollectionPath(uid: string, ideess: string): string {
    return `users/${uid}/favorites/${ideess}/history`;
  }

  /** `YYYY-MM-DD` en huso horario local del dispositivo — coherente con `[[07-monitorizacion-historica]]`. */
  private dateId(fecha: Date): string {
    const yyyy = fecha.getFullYear();
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const dd = String(fecha.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  /** UID puntual y síncrono: los métodos de este servicio solo se invocan tras `authGuard`. */
  private requireUid(): string {
    const uid = this.authService.getCurrentUser()?.uid;
    if (!uid) {
      throw new Error('No hay sesión activa: no se puede acceder a favoritos.');
    }
    return uid;
  }

  /**
   * Añade `station` a favoritos. Antes de escribir comprueba el límite de
   * `MAX_GASOLINERAS_GUARDADAS` con `getCountFromServer` (consulta de
   * agregación: cuesta 1 sola lectura, independientemente de cuántos
   * favoritos existan), en vez de traer los hasta 10 documentos completos
   * con `getDocs` solo para contarlos.
   *
   * Nota: es una comprobación de UX en el cliente, no el límite real (igual
   * que el código familiar en `AuthService.register`) — el límite efectivo
   * debe replicarse en Firestore Security Rules antes de producción.
   */
  async addFavorite(station: GasStation): Promise<void> {
    const uid = this.requireUid();
    const favoritesRef = collection(this.firestore, this.favoritesCollectionPath(uid));

    const countSnap = await getCountFromServer(favoritesRef);
    if (countSnap.data().count >= MAX_GASOLINERAS_GUARDADAS) {
      throw new Error(`No se pueden guardar más de ${MAX_GASOLINERAS_GUARDADAS} gasolineras favoritas.`);
    }

    const favorite: Favorite = {
      id: station.id,
      marca: station.marca,
      direccion: station.direccion,
      municipio: station.municipio,
      lat: station.lat,
      lng: station.lng,
      guardadoEn: Date.now(),
    };

    const favoriteRef = doc(this.firestore, this.favoritesCollectionPath(uid), station.id);
    await setDoc(favoriteRef, favorite);
  }

  async removeFavorite(stationId: string): Promise<void> {
    const uid = this.requireUid();
    const favoriteRef = doc(this.firestore, this.favoritesCollectionPath(uid), stationId);
    await deleteDoc(favoriteRef);
  }

  /**
   * Observable en vivo (máx. 10 documentos) de los favoritos del usuario actual.
   *
   * A diferencia de `addFavorite`/`removeFavorite` (funciones `async`, donde un
   * `throw` síncrono se convierte automáticamente en una `Promise` rechazada),
   * este método NO es `async`: devuelve el `Observable` directamente. Por eso
   * NO puede usar `requireUid()` (que lanza una excepción de verdad) — un
   * `throw` aquí rompería de forma síncrona a quien llame a `getFavorites()`
   * ANTES de que exista ningún `Observable` al que suscribirse, saltándose
   * por completo el canal de error de RxJS (hallazgo de la auditoría
   * [REVIEWER], ver `docs/features/06-favoritos.md`). `throwError(...)`
   * devuelve en su lugar un `Observable` que emite el error de forma normal
   * en `subscribe({ error: ... })`, igual que cualquier otro fallo de red.
   *
   * `collectionData(...)` se ejecuta dentro de `runInInjectionContext(...)`
   * (hallazgo de una auditoría [REVIEWER] posterior, ver `docs/features/06-favoritos.md`):
   * `collectionData` (de `rxfire`, re-exportado por `@angular/fire`) necesita
   * un contexto de inyección real para resolver sus "schedulers" internos
   * (`ɵAngularFireSchedulers`/`PendingTasks`/`EnvironmentInjector`), que son
   * los que reenganchan las emisiones del listener de Firestore a la zona de
   * Angular (`observeOn(schedulers.insideAngular)`). Este método se invoca
   * desde sitios que NO garantizan ese contexto por sí solos — directamente
   * en `ngAfterViewInit()` de `MapComponent`, y dentro de un `switchMap()` en
   * `FavoritesPanelPage` — y sin él, `@angular/fire` cae a un *fallback*
   * silencioso (solo un `console.warn`, no una excepción) que sigue
   * funcionando pero SIN esa reconexión a la zona: las emisiones posteriores
   * del listener de Firestore pueden no disparar detección de cambios,
   * dejando la UI que depende de esos datos desactualizada hasta que algún
   * otro evento fuerce un ciclo de Angular. `environmentInjector` se capturó
   * en el constructor de este servicio (que sí corre en contexto de
   * inyección) precisamente para poder restaurarlo aquí, en el único sitio
   * que lo necesita — así ningún consumidor de `getFavorites()` tiene que
   * preocuparse de en qué contexto se le ocurre llamarlo.
   */
  getFavorites(): Observable<Favorite[]> {
    const uid = this.authService.getCurrentUser()?.uid;
    if (!uid) {
      return throwError(() => new Error('No hay sesión activa: no se puede acceder a favoritos.'));
    }

    const favoritesRef = collection(this.firestore, this.favoritesCollectionPath(uid));
    return runInInjectionContext(
      this.environmentInjector,
      () => collectionData(favoritesRef) as Observable<Favorite[]>,
    );
  }

  /**
   * RF-04 (Monitorización y Comparación): cruza los favoritos guardados en
   * Firestore con los precios de HOY de MITECO para `combustibleType`, y
   * marca el/los más barato(s) y más caro(s) del propio conjunto de
   * favoritos. Ver el cruce de datos y el análisis de coste completos en
   * `docs/features/06-favoritos.md`.
   *
   * `combineLatest`, no `switchMap`, a propósito: `getEstaciones()` es un
   * `Observable` que se completa tras su única emisión (una petición HTTP),
   * así que `combineLatest` conserva ese último valor y NO vuelve a pedirlo
   * cada vez que `getFavorites()` emite (ej. el usuario añade/quita un
   * favorito) — solo se repite el cruce en memoria, sin una segunda descarga
   * de las ~11.500 estaciones de MITECO.
   *
   * Nota (auditoría [REVIEWER] posterior, ver `docs/features/06-favoritos.md`):
   * `FavoritesPanelPage` NO usa este método directamente — llama a
   * `getFavorites()` una vez y a `mergeWithPrices()` (público, más abajo) por
   * separado, para poder mostrar la lista (Firestore, rápida) sin esperar al
   * cruce con MITECO (lento) Y compartir la MISMA suscripción de Firestore
   * entre ambos usos (`shareReplay`), en vez de abrir un segundo listener
   * como haría llamar a este método por su cuenta. Este método sigue siendo
   * válido y correcto para cualquier consumidor futuro que solo necesite
   * "favoritos con precio" en una sola llamada, sin ese requisito extra.
   *
   * Historiador (RF-04, `[[07-monitorizacion-historica]]`): el `tap(...)`
   * dispara `recordTodayHistory` como side-effect de "fire-and-forget" —
   * NO forma parte de la cadena del `Observable` (no se hace `switchMap` a
   * la promesa) para que un fallo o una latencia de Firestore al ESCRIBIR el
   * histórico nunca retrase ni rompa la emisión de los precios de HOY, que
   * es lo único que este método promete a sus consumidores. Cualquier error
   * se captura y se registra en consola dentro del propio método privado,
   * nunca llega al `Observable` público.
   */
  getFavoritesWithPrices(combustibleType: FuelType): Observable<FavoriteWithPrice[]> {
    return combineLatest([this.getFavorites(), this.mitecoService.getEstaciones()]).pipe(
      map(([favoritos, estaciones]) => this.mergeWithPrices(favoritos, estaciones, combustibleType)),
      tap((favoritosConPrecio) => this.recordTodayHistory(favoritosConPrecio)),
    );
  }

  /**
   * Cruce de datos por `id` (IDEESS, compartido entre `Favorite` y
   * `GasStation`, ver `[[06-favoritos]]`): un `Map` de `estaciones` da una
   * búsqueda O(1) por favorito, en vez de un `.find()` por cada uno (que
   * sería O(favoritos × estaciones) — con hasta 11.500 estaciones, notable).
   *
   * Público (no `private`) para que un consumidor que YA tiene su propia
   * copia de `favoritos` (ej. `FavoritesPanelPage`, que la obtiene de una
   * suscripción a `getFavorites()` que comparte con otro fin) pueda cruzarla
   * con MITECO sin tener que volver a abrir un segundo listener de Firestore
   * llamando a `getFavoritesWithPrices()` por su cuenta — pura función,
   * sin estado ni acceso a Firestore/MITECO por sí misma.
   */
  mergeWithPrices(
    favoritos: Favorite[],
    estaciones: GasStation[],
    combustibleType: FuelType,
  ): FavoriteWithPrice[] {
    const preciosPorId = new Map(estaciones.map((estacion) => [estacion.id, estacion.precios[combustibleType]]));

    const favoritosConPrecio: FavoriteWithPrice[] = favoritos.map((favorito) => ({
      ...favorito,
      precio: preciosPorId.get(favorito.id) ?? null,
      isCheapest: false,
      isMostExpensive: false,
    }));

    this.markExtremes(favoritosConPrecio);

    return favoritosConPrecio;
  }

  /**
   * Marca `isCheapest`/`isMostExpensive` IN-PLACE sobre `favoritosConPrecio`
   * (array recién creado por `mergeWithPrices`, sin otras referencias — mutar
   * aquí no afecta a nada más).
   *
   * Reglas, deliberadas y no solo "el primero que encuentre":
   * - Ignora los favoritos con `precio: null` (estación sin ese combustible,
   *   o ya no presente en la respuesta de MITECO) — no participan ni como
   *   candidatos ni distorsionan el mínimo/máximo de los demás.
   * - Con 0 o 1 favoritos con precio, no hay nada que comparar: ningún flag.
   * - Si TODOS los favoritos con precio cuestan exactamente lo mismo
   *   (empate total), tampoco se marca nada: "más barato" y "más caro" no
   *   son conceptos útiles cuando coinciden en el mismo valor.
   * - Si hay empate SOLO en un extremo (ej. dos favoritos comparten el precio
   *   más bajo, y hay un tercero más caro), se marcan TODOS los que empatan
   *   en ese extremo, no solo el primero — no hay razón para preferir uno
   *   sobre otro con el mismo precio real.
   */
  private markExtremes(favoritosConPrecio: FavoriteWithPrice[]): void {
    const precios = favoritosConPrecio
      .map((favorito) => favorito.precio)
      .filter((precio): precio is number => precio !== null);

    if (precios.length < 2) {
      return;
    }

    const minimo = Math.min(...precios);
    const maximo = Math.max(...precios);
    if (minimo === maximo) {
      return;
    }

    for (const favorito of favoritosConPrecio) {
      if (favorito.precio === minimo) {
        favorito.isCheapest = true;
      }
      if (favorito.precio === maximo) {
        favorito.isMostExpensive = true;
      }
    }
  }

  /**
   * Historiador (RF-04, `[[07-monitorizacion-historica]]`): por cada favorito
   * con precio conocido hoy, registra en Firestore
   * `users/{uid}/favorites/{ideess}/history/{YYYY-MM-DD}` (id de documento =
   * fecha de hoy) con el único campo `price` — pero SOLO si ese documento no
   * existe ya, comprobado con un `getDoc` previo. Con como mucho 10
   * favoritos, el coste máximo de esta llamada es 10 lecturas (`getDoc`) +
   * hasta 10 escrituras (`setDoc`, solo la PRIMERA vez que se consulta cada
   * estación en el día — el resto del día, siempre 0 escrituras).
   *
   * `Promise.all`, no un `for` secuencial: las hasta 10 comprobaciones
   * "¿existe ya el de hoy?" son independientes entre sí (estaciones
   * distintas, subcolecciones distintas) — no hay razón para esperar a que
   * termine una antes de lanzar la siguiente.
   *
   * Favoritos con `precio: null` (estación sin ese combustible, o ya no
   * presente en la respuesta de MITECO) se excluyen: no hay ningún precio
   * real de hoy que registrar para ellos.
   *
   * CORRECCIÓN (ciclo [UI-DEV], `[[07-monitorizacion-historica]]`): este
   * método pasa a ser público. En el diseño original solo se llamaba desde
   * el `tap(...)` de `getFavoritesWithPrices` — pero `FavoritesPanelPage`
   * (el ÚNICO consumidor real de esta pantalla, ver `[[06-favoritos]]`) NO
   * usa `getFavoritesWithPrices`: llama a `getFavorites()` y a
   * `mergeWithPrices()` por separado (a propósito, para compartir el mismo
   * listener de Firestore entre la lista rápida y el cruce con MITECO). Con
   * el método `private`, el Historiador nunca llegaba a ejecutarse en la
   * práctica — ningún precio quedaba jamás registrado. Ahora
   * `FavoritesPanelPage` lo llama explícitamente tras `mergeWithPrices()`
   * (ver su constructor), y `getFavoritesWithPrices` conserva su propio
   * `tap(...)` para cualquier consumidor futuro que sí la use directamente.
   */
  async recordTodayHistory(favoritosConPrecio: FavoriteWithPrice[]): Promise<void> {
    const uid = this.authService.getCurrentUser()?.uid;
    if (!uid) {
      return;
    }

    const hoy = this.dateId(new Date());

    await Promise.all(
      favoritosConPrecio
        .filter((favorito): favorito is FavoriteWithPrice & { precio: number } => favorito.precio !== null)
        .map(async (favorito) => {
          try {
            const historyDocRef = doc(this.firestore, this.historyCollectionPath(uid, favorito.id), hoy);
            const historySnap = await getDoc(historyDocRef);
            if (historySnap.exists()) {
              return;
            }

            const entry: PriceHistoryDoc = { price: favorito.precio };
            await setDoc(historyDocRef, entry);
          } catch (error) {
            // No debe romper la emisión de precios de hoy (ver justificación en getFavoritesWithPrices).
            console.error(`No se pudo registrar el histórico de precio de ${favorito.id}`, error);
          }
        }),
    );
  }

  /**
   * RF-04 (Monitorización histórica): devuelve, para cada IDEESS de
   * `ideessList`, sus últimos `days` días de histórico de precio (por
   * defecto 30), como un `Map<ideess, PriceHistoryPoint[]>` listo para
   * alimentar una gráfica (ej. `ng2-charts`) por gasolinera. Ver arquitectura
   * completa en `docs/features/07-monitorizacion-historica.md`.
   *
   * Lectura puntual (`getDocs`), no un listener en vivo (`collectionData`):
   * el histórico de días pasados es inmutable una vez escrito (el propio
   * `recordTodayHistory` nunca reescribe un día ya registrado), así que no
   * hay ninguna actualización en tiempo real que escuchar — un listener
   * permanente aquí solo mantendría abierta una conexión sin ningún cambio
   * que reportar la inmensa mayoría del tiempo.
   *
   * Filtro por rango de fechas con `where(documentId(), '>=', cutoff)`, no
   * un campo `date` duplicado dentro del documento: como el id de cada
   * documento YA ES la fecha `YYYY-MM-DD` (`recordTodayHistory`), y esas
   * cadenas ordenan lexicográficamente igual que cronológicamente, Firestore
   * puede filtrar y ordenar directamente por `documentId()` sin necesitar un
   * campo adicional que solo repetiría el propio id del documento.
   *
   * Coste: una consulta por IDEESS solicitado (`Promise.all`, en paralelo, no
   * secuencial) — con hasta 10 favoritos y `days = 30`, hasta 10 consultas
   * que devuelven, en conjunto, como mucho 300 lecturas (10 × 30), acotado
   * por cuántos días llevan realmente registrados (nunca más que `days`, y
   * nunca más que los días que la app lleva en uso). **Recomendación
   * explícita para quien consuma este método (`[[UI-DEV]]`, fuera de este
   * documento):** llamarlo una única vez por apertura de la gráfica/pantalla
   * de histórico, no dentro de un binding o `effect()` que se reevalúe en
   * cada redibujado — mismo criterio de coste ya documentado para
   * `getFavoritesWithPrices` en `[[06-favoritos]]`.
   */
  getHistory(ideessList: string[], days: number = 30): Observable<Map<string, PriceHistoryPoint[]>> {
    const uid = this.authService.getCurrentUser()?.uid;
    if (!uid) {
      return throwError(() => new Error('No hay sesión activa: no se puede acceder al histórico de precios.'));
    }

    if (ideessList.length === 0) {
      return of(new Map<string, PriceHistoryPoint[]>());
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (days - 1));
    const cutoffId = this.dateId(cutoff);

    return from(
      Promise.all(
        ideessList.map(async (ideess): Promise<readonly [string, PriceHistoryPoint[]]> => {
          const historyRef = collection(this.firestore, this.historyCollectionPath(uid, ideess));
          const historyQuery = query(historyRef, where(documentId(), '>=', cutoffId), orderBy(documentId()));
          const snapshot = await getDocs(historyQuery);

          const puntos: PriceHistoryPoint[] = snapshot.docs.map((historyDoc) => ({
            date: historyDoc.id,
            price: (historyDoc.data() as PriceHistoryDoc).price,
          }));

          return [ideess, puntos] as const;
        }),
      ),
    ).pipe(map((entradas) => new Map(entradas)));
  }
}
