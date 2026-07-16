/**
 * Estado del "Semáforo de Repostaje" (`[[08-semaforo-repostaje]]`). `type`
 * de 3 literales, no un `enum` de TypeScript — mismo criterio ya aplicado a
 * `GasStationBrand`/`FuelType` en `gas-station.model.ts` ("restringido a un
 * enum para evitar strings libres", pero implementado como union de
 * literales: sin el código adicional en el bundle de un `enum` real de
 * TypeScript, e igual de comprobable en tiempo de compilación).
 */
export type RefuelAdviceStatus = 'GREEN' | 'YELLOW' | 'RED';

/**
 * Resultado de `RefuelAdvisorService.getRefuelAdvice(...)`: no solo el
 * semáforo (`status`) y el mensaje ya redactado para la UI (`message`), sino
 * también los números de los que se deriva (`todayAveragePrice`,
 * `historicalAveragePrice`, `percentChange`) — `null` cuando no aplican
 * (datos insuficientes, o sin precio de hoy todavía). Exponerlos, en vez de
 * devolver solo `status`/`message`, permite que un futuro consumidor
 * ([[UI-DEV]], fuera de alcance de este ciclo) muestre el detalle numérico
 * (ej. "+2,3% sobre tu media") sin tener que recalcularlo por su cuenta ni
 * duplicar la lógica de `RefuelAdvisorService`.
 */
export interface RefuelAdvice {
  status: RefuelAdviceStatus;
  /** Mensaje corto, ya en español y listo para mostrar sin más formateo (ej. "Los precios han subido, echa solo lo necesario"). */
  message: string;
  /** Media de HOY entre las gasolineras favoritas con dato ese día. `null` si ninguna favorita tiene precio registrado hoy todavía. */
  todayAveragePrice: number | null;
  /** Media histórica de los días previos a hoy dentro de la ventana de análisis. `null` si no hay suficientes días de histórico. */
  historicalAveragePrice: number | null;
  /** Variación porcentual de `todayAveragePrice` respecto a `historicalAveragePrice` (positivo = más caro que la media). `null` si cualquiera de los dos anteriores es `null`. */
  percentChange: number | null;
}
