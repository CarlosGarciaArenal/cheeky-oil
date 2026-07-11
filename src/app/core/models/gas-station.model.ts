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
