import { Injectable } from '@angular/core';

import { PriceHistoryPoint } from '../models/price-history.model';
import { RefuelAdvice, RefuelAdviceStatus } from '../models/refuel-advice.model';

/**
 * Ventana usada para la media histórica de comparación ("los últimos 7-14
 * días" del encargo). 14, no 7: con más días la media es más estable frente
 * al ruido de un único día atípico (una estación que no reportó precio, un
 * pico puntual), y el precio de los carburantes en España no cambia lo
 * bastante rápido semana a semana como para que 14 días dejen de representar
 * "el precio habitual reciente".
 */
const HISTORICAL_WINDOW_DAYS = 14;

/** Ventana para la regla "mínimo histórico del mes" del encargo — 30 días, no los mismos 14 de la media, para que ambas reglas puedan disparar el semáforo en verde por motivos distintos. */
const MONTHLY_WINDOW_DAYS = 30;

/**
 * Mínimo de días de histórico PREVIOS a hoy necesarios para calcular una
 * media histórica que signifique algo. Con 1-2 días, "la media" es solo esos
 * 1-2 precios sueltos — no una tendencia. 3 es el umbral más bajo que ya deja
 * de ser "un par de puntos sueltos" sin exigir una semana completa de datos
 * ya acumulados (la app es de uso reciente: exigir 7 días completos dejaría
 * el semáforo en YELLOW/"necesito más días" durante toda la primera semana
 * de cualquier gasolinera favorita nueva).
 */
const MIN_HISTORICAL_DAYS = 3;

/** Umbral de variación porcentual del encargo: ±1.5% separa GREEN/YELLOW/RED. */
const THRESHOLD_PERCENT = 1.5;

/**
 * "Semáforo de Repostaje" (`[[08-semaforo-repostaje]]`): a partir del
 * histórico de precios ya leído de Firestore (`FavoritesService.getHistory`,
 * `[[07-monitorizacion-historica]]`), calcula si HOY es buen, normal o mal
 * momento para repostar en las gasolineras favoritas del usuario.
 *
 * Servicio aparte de `FavoritesService`, no un método más ahí, aunque no
 * tiene ninguna dependencia de Firestore/Auth que justificara inyección: es
 * lógica de ANÁLISIS pura sobre datos ya obtenidos, con una responsabilidad
 * claramente distinta de "leer/escribir Firestore" (la única que tiene hoy
 * `FavoritesService`, ya bastante grande). Mantenerlo `@Injectable`, no una
 * función suelta exportada, por consistencia con el resto de la capa de
 * servicios del proyecto (inyectable, mockable en tests, resoluble por DI
 * igual que cualquier otro) aunque hoy no inyecte nada él mismo.
 */
@Injectable({ providedIn: 'root' })
export class RefuelAdvisorService {
  /** `YYYY-MM-DD` en huso horario local del dispositivo — mismo criterio y formato que `FavoritesService.dateId` (duplicado a propósito: 5 líneas, no vale la pena acoplar este servicio a uno privado ajeno). */
  private todayId(): string {
    const fecha = new Date();
    const yyyy = fecha.getFullYear();
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const dd = String(fecha.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private parseDateId(dateId: string): Date {
    const [yyyy, mm, dd] = dateId.split('-').map(Number);
    return new Date(yyyy, mm - 1, dd);
  }

  private daysBetween(fromId: string, toId: string): number {
    const MS_POR_DIA = 24 * 60 * 60 * 1000;
    return Math.round((this.parseDateId(toId).getTime() - this.parseDateId(fromId).getTime()) / MS_POR_DIA);
  }

  private average(valores: number[]): number {
    return valores.reduce((suma, valor) => suma + valor, 0) / valores.length;
  }

  /**
   * Aplana el histórico de TODAS las favoritas (`Map<ideess, PriceHistoryPoint[]>`,
   * la misma forma que ya devuelve `FavoritesService.getHistory`) a una única
   * media por fecha (`Map<fecha, precio medio ese día>`) — el encargo pide
   * comparar "el precio medio de HOY" con "la media de los últimos días",
   * ambos ya agregados entre las favoritas, no una gráfica por estación.
   * Fechas sin ninguna favorita con precio simplemente no aparecen en el
   * resultado (no se inventa un `0`/`null` de relleno).
   */
  private buildDailyAverages(favoritesHistory: Map<string, PriceHistoryPoint[]>): Map<string, number> {
    const preciosPorFecha = new Map<string, number[]>();

    for (const puntos of favoritesHistory.values()) {
      for (const punto of puntos) {
        const precios = preciosPorFecha.get(punto.date) ?? [];
        precios.push(punto.price);
        preciosPorFecha.set(punto.date, precios);
      }
    }

    const promediosPorFecha = new Map<string, number>();
    for (const [fecha, precios] of preciosPorFecha) {
      promediosPorFecha.set(fecha, this.average(precios));
    }
    return promediosPorFecha;
  }

  private resolveStatus(percentChange: number, isMonthlyMinimum: boolean): RefuelAdviceStatus {
    if (isMonthlyMinimum || percentChange <= -THRESHOLD_PERCENT) {
      return 'GREEN';
    }
    if (percentChange >= THRESHOLD_PERCENT) {
      return 'RED';
    }
    return 'YELLOW';
  }

  private buildMessage(status: RefuelAdviceStatus, percentChange: number, isMonthlyMinimum: boolean): string {
    const variacion = Math.abs(percentChange).toFixed(1).replace('.', ',');

    switch (status) {
      case 'GREEN':
        return isMonthlyMinimum
          ? 'Precio mínimo del último mes: buen momento para llenar el depósito.'
          : `Precio un ${variacion}% por debajo de tu media habitual: buen momento para repostar.`;
      case 'RED':
        return `Los precios han subido un ${variacion}% respecto a tu media habitual: echa solo lo necesario.`;
      case 'YELLOW':
        return 'Precio dentro de lo habitual, sin cambios relevantes.';
    }
  }

  /**
   * "Semáforo de Repostaje": compara el precio medio de HOY entre las
   * favoritas (`favoritesHistory`, con la MISMA forma que devuelve
   * `FavoritesService.getHistory(ids, fuelType, 30)` — 30 días, no el valor
   * por defecto que use el consumidor, para tener margen de sobra tanto para
   * la media de `HISTORICAL_WINDOW_DAYS` como para el mínimo de
   * `MONTHLY_WINDOW_DAYS`) con su media histórica reciente, y con el mínimo
   * del último mes. Pura función de los datos ya recibidos: no llama a
   * Firestore ni a MITECO por sí mismo.
   *
   * Casos de "datos insuficientes" (YELLOW, sin cálculo numérico):
   * - Menos de `MIN_HISTORICAL_DAYS` días de histórico ANTERIORES a hoy: no
   *   hay suficiente base para hablar de una "media habitual".
   * - Hay suficiente histórico previo, pero NINGUNA favorita tiene precio
   *   registrado todavía hoy (`recordTodayHistory` aún no se ha ejecutado
   *   esta sesión, o el cruce con MITECO ha fallado): no hay ningún "precio
   *   de hoy" que comparar.
   *
   * Con datos suficientes:
   * - `historicalAveragePrice` = media de los `dailyAverages` de los
   *   `HISTORICAL_WINDOW_DAYS` días más recientes ANTERIORES a hoy (nunca
   *   incluye el propio hoy — comparar hoy contra una media que ya lo
   *   contiene sesgaría el resultado hacia YELLOW).
   * - `percentChange` = variación de `todayAveragePrice` respecto a esa
   *   media, en porcentaje.
   * - `isMonthlyMinimum` = si `todayAveragePrice` es menor o igual que el
   *   mínimo de los `dailyAverages` de los últimos `MONTHLY_WINDOW_DAYS` días
   *   ANTERIORES a hoy (mismo criterio de excluir hoy del propio mínimo con
   *   el que se compara, para que la comparación sea real y no trivialmente
   *   cierta).
   * - GREEN si `percentChange <= -1.5` O `isMonthlyMinimum`; RED si
   *   `percentChange >= 1.5`; YELLOW en cualquier otro caso (entre -1.5% y
   *   +1.5%) — umbrales del encargo, ver `THRESHOLD_PERCENT`.
   */
  getRefuelAdvice(favoritesHistory: Map<string, PriceHistoryPoint[]>): RefuelAdvice {
    const dailyAverages = this.buildDailyAverages(favoritesHistory);
    const hoy = this.todayId();
    const todayAveragePrice = dailyAverages.get(hoy) ?? null;

    const fechasAnteriores = [...dailyAverages.keys()]
      .filter((fecha) => fecha !== hoy)
      .sort()
      .reverse();

    if (fechasAnteriores.length < MIN_HISTORICAL_DAYS) {
      return {
        status: 'YELLOW',
        message: 'Necesito más días de histórico para poder analizar tus precios habituales.',
        todayAveragePrice,
        historicalAveragePrice: null,
        percentChange: null,
      };
    }

    if (todayAveragePrice === null) {
      return {
        status: 'YELLOW',
        message: 'Todavía no tengo el precio de hoy de tus gasolineras favoritas.',
        todayAveragePrice: null,
        historicalAveragePrice: null,
        percentChange: null,
      };
    }

    const ventanaHistorica = fechasAnteriores.slice(0, HISTORICAL_WINDOW_DAYS);
    const historicalAveragePrice = this.average(ventanaHistorica.map((fecha) => dailyAverages.get(fecha) as number));

    const ventanaMensual = fechasAnteriores.filter((fecha) => this.daysBetween(fecha, hoy) <= MONTHLY_WINDOW_DAYS);
    const minimoMensual =
      ventanaMensual.length > 0 ? Math.min(...ventanaMensual.map((fecha) => dailyAverages.get(fecha) as number)) : null;

    const percentChange = ((todayAveragePrice - historicalAveragePrice) / historicalAveragePrice) * 100;
    // Estricto (`<`), no `<=`: con precios totalmente planos (frecuente — los
    // carburantes no cambian de precio todos los días), hoy EMPATA con el
    // mínimo del mes por definición, y `<=` marcaría GREEN "mínimo del mes"
    // en cualquier día sin ningún movimiento real de precio. `<` exige que
    // hoy sea un mínimo GENUINO (estrictamente por debajo de cualquier otro
    // día de la ventana), no un empate trivial consigo mismo.
    const isMonthlyMinimum = minimoMensual !== null && todayAveragePrice < minimoMensual;

    const status = this.resolveStatus(percentChange, isMonthlyMinimum);
    const message = this.buildMessage(status, percentChange, isMonthlyMinimum);

    return { status, message, todayAveragePrice, historicalAveragePrice, percentChange };
  }
}
