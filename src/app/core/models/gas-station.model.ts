/**
 * Marcas de gasolinera soportadas.
 * Restringido a un enum para evitar strings libres y facilitar filtrado/iconografía.
 */
export type GasStationBrand =
  | 'Repsol'
  | 'Cepsa'
  | 'BP'
  | 'Shell'
  | 'Galp'
  | 'Petronor'
  | 'Petroprix'
  | 'Independiente'
  | 'Otra';

/**
 * Precios de combustible en euros/litro.
 * Opcionales porque no todas las estaciones venden los 3 tipos (ej. sin diésel).
 */
export interface FuelPrices {
  gasolina95: number | null;
  gasolina98: number | null;
  diesel: number | null;
}

/**
 * Claves de combustible disponibles en `FuelPrices`. Tipo compartido (en vez
 * de que cada consumidor declare su propio `keyof FuelPrices` local, como ya
 * hacía `MapComponent` con su `FuelKey` privado) para que RF-04
 * (`FavoritesService.getFavoritesWithPrices`, ver `[[06-favoritos]]`) y el
 * mapa filtren por el mismo tipo de combustible sin dos fuentes de verdad.
 */
export type FuelType = keyof FuelPrices;

/**
 * Documento raíz de la colección `gasStations` en Firestore.
 * `id` coincide con el ID oficial de la estación (fuente: API pública del
 * Ministerio para Transición Ecológica), evitando así IDs autogenerados
 * y permitiendo upserts baratos (1 escritura por estación actualizada).
 */
export interface GasStation {
  id: string;
  marca: GasStationBrand;
  direccion: string;
  municipio: string;
  precios: FuelPrices;
  lat: number;
  lng: number;
  /** Timestamp (epoch ms) de la última actualización de precios. */
  actualizadoEn: number;
}
