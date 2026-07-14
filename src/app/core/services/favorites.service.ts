import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  getCountFromServer,
  setDoc,
} from '@angular/fire/firestore';
import { Observable, combineLatest, map, throwError } from 'rxjs';

import { AuthService } from './auth.service';
import { MitecoService } from './miteco.service';
import { FuelType, GasStation } from '../models/gas-station.model';
import { Favorite, FavoriteWithPrice } from '../models/favorite.model';
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

  private favoritesCollectionPath(uid: string): string {
    return `users/${uid}/favorites`;
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
   */
  getFavorites(): Observable<Favorite[]> {
    const uid = this.authService.getCurrentUser()?.uid;
    if (!uid) {
      return throwError(() => new Error('No hay sesión activa: no se puede acceder a favoritos.'));
    }

    const favoritesRef = collection(this.firestore, this.favoritesCollectionPath(uid));
    return collectionData(favoritesRef) as Observable<Favorite[]>;
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
   */
  getFavoritesWithPrices(combustibleType: FuelType): Observable<FavoriteWithPrice[]> {
    return combineLatest([this.getFavorites(), this.mitecoService.getEstaciones()]).pipe(
      map(([favoritos, estaciones]) => this.mergeWithPrices(favoritos, estaciones, combustibleType)),
    );
  }

  /**
   * Cruce de datos por `id` (IDEESS, compartido entre `Favorite` y
   * `GasStation`, ver `[[06-favoritos]]`): un `Map` de `estaciones` da una
   * búsqueda O(1) por favorito, en vez de un `.find()` por cada uno (que
   * sería O(favoritos × estaciones) — con hasta 11.500 estaciones, notable).
   */
  private mergeWithPrices(
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
}
