import { GasStationBrand } from './gas-station.model';

/**
 * Documento de la subcolección `users/{uid}/favorites` (id = GasStation.id / IDEESS).
 * Réplica mínima y estática de GasStation: los precios NUNCA se copian aquí
 * (cambian a diario) para no tener que reescribir cada favorito guardado en
 * cada sincronización de precios — se leen siempre en vivo desde `gasStations`
 * por `id`, mismo principio que ya aplicó `[[01-modelos-base]]` a
 * `AppUser.gasolinerasGuardadasIds`.
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
