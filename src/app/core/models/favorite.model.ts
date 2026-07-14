import { GasStationBrand } from './gas-station.model';

/**
 * Documento de la subcolección `users/{uid}/favorites` (id = GasStation.id / IDEESS).
 * Réplica mínima y estática de GasStation: los precios NUNCA se copian aquí
 * (cambian a diario) para no tener que reescribir cada favorito guardado en
 * cada sincronización de precios. Hoy (RF-04, `[[06-favoritos]]`) se leen en
 * vivo directamente de `MitecoService.getEstaciones()` (la API pública del
 * Ministerio, sin intermediario en Firestore): el proyecto no tiene todavía
 * ninguna colección `gasStations` en Firestore poblada — esa sincronización
 * periódica sigue siendo trabajo futuro, ver `[[03-capa-gasolineras]]`. Si
 * algún día existiera, el cruce pasaría a hacerse contra esa colección en
 * vez de contra la API en vivo, sin cambiar la forma de este documento.
 */
export interface Favorite {
  id: string;
  marca: GasStationBrand;
  direccion: string;
  municipio: string;
  lat: number;
  lng: number;
  /** Timestamp (epoch ms) en que el usuario guardó esta gasolinera como favorita. */
  guardadoEn: number;
}

/**
 * Vista combinada, solo en memoria (NUNCA se persiste en Firestore): un
 * `Favorite` enriquecido con su precio de HOY para un combustible concreto y
 * marcado como más barato/más caro dentro del propio conjunto de favoritos.
 * La construye `FavoritesService.getFavoritesWithPrices()` cruzando
 * Firestore (`Favorite[]`) con MITECO (`GasStation[]`) — ver justificación
 * completa en `docs/features/06-favoritos.md`.
 */
export interface FavoriteWithPrice extends Favorite {
  /**
   * Precio de hoy del combustible pedido, o `null` si la estación ya no lo
   * vende, o ya no aparece en absoluto en la respuesta de MITECO (ej. ha
   * cerrado). Un favorito con `precio: null` nunca puede llevar
   * `isCheapest`/`isMostExpensive` a `true` (ver `markExtremes` en
   * `FavoritesService`).
   */
  precio: number | null;
  /**
   * `true` si este favorito tiene el precio MÁS BAJO entre los favoritos con
   * precio no nulo para el combustible pedido. Puede haber empate: si dos o
   * más favoritos comparten el precio más bajo, todos llevan `true` (no se
   * elige uno arbitrariamente).
   */
  isCheapest: boolean;
  /** Igual que `isCheapest`, pero para el precio MÁS ALTO. */
  isMostExpensive: boolean;
}
