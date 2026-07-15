/**
 * Documento de la subcolección `users/{uid}/favorites/{ideess}/history`
 * (RF-04, histórico de precios, `[[07-monitorizacion-historica]]`). El id de
 * cada documento ES la fecha en formato `YYYY-MM-DD` (huso horario local del
 * dispositivo) — no se duplica como campo, igual que `Favorite.id` ya
 * reutiliza el IDEESS como id de documento en vez de guardarlo dos veces.
 */
export interface PriceHistoryDoc {
  price: number;
}

/**
 * Punto de histórico ya combinado con su fecha (extraída de `doc.id`), tal
 * como lo devuelve `FavoritesService.getHistory()` a sus consumidores
 * (ej. una gráfica `ng2-charts`). Nunca se persiste con esta forma exacta —
 * en Firestore solo vive `PriceHistoryDoc.price`.
 */
export interface PriceHistoryPoint {
  /** `YYYY-MM-DD`, igual al id del documento en Firestore. */
  date: string;
  price: number;
}
