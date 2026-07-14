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
import { Observable, throwError } from 'rxjs';

import { AuthService } from './auth.service';
import { GasStation } from '../models/gas-station.model';
import { Favorite } from '../models/favorite.model';
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
}
