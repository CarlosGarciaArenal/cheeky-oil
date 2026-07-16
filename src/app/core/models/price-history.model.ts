import { FuelType } from './gas-station.model';

/**
 * Documento de la subcolección `users/{uid}/favorites/{ideess}/history`
 * (RF-04, histórico de precios, `[[07-monitorizacion-historica]]`). El id de
 * cada documento ES la fecha en formato `YYYY-MM-DD` (huso horario local del
 * dispositivo) — no se duplica como campo, igual que `Favorite.id` ya
 * reutiliza el IDEESS como id de documento en vez de guardarlo dos veces.
 *
 * CORRECCIÓN CRÍTICA [ARQUITECTO]: `prices` es un mapa por `FuelType`, no un
 * único `price` — un mismo documento diario registra TODOS los combustibles
 * que la estación vendía ese día (bug previo: el histórico solo guardaba el
 * precio del combustible seleccionado en el momento de la consulta,
 * mezclando gasolina95/98/diésel en la misma serie temporal según qué
 * combustible tuviera seleccionado el usuario ese día). `Partial` porque no
 * todas las estaciones venden los 3 tipos (ver `FuelPrices`) — solo se
 * guardan las claves con precio real, nunca `null`.
 */
export interface PriceHistoryDoc {
  prices: Partial<Record<FuelType, number>>;
}

/**
 * Punto de histórico ya combinado con su fecha (extraída de `doc.id`) y
 * filtrado a un único `FuelType` (extraído de `PriceHistoryDoc.prices`), tal
 * como lo devuelve `FavoritesService.getHistory()` a sus consumidores (ej.
 * una gráfica `ng2-charts`, o `RefuelAdvisorService.getRefuelAdvice`, ver
 * `[[08-semaforo-repostaje]]`). Nunca se persiste con esta forma exacta — en
 * Firestore solo vive `PriceHistoryDoc.prices`.
 */
export interface PriceHistoryPoint {
  /** `YYYY-MM-DD`, igual al id del documento en Firestore. */
  date: string;
  price: number;
}
