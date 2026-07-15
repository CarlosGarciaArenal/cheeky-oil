import { ChangeDetectionStrategy, Component, Input, OnInit, inject } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData } from 'chart.js';

import { PriceHistoryPoint } from '../../core/models/price-history.model';

/** Una gasolinera ya resuelta con su histórico, lista para dibujar. */
export interface PriceChartStation {
  id: string;
  marca: string;
  municipio: string;
  puntos: PriceHistoryPoint[];
}

/**
 * Paleta categórica (8 tonos, ORDEN FIJO — nunca ciclada sin más) validada
 * con el script de la skill de dataviz (`validate_palette.js`) contra las
 * superficies reales de esta app (blanco en claro, negro en oscuro, ver
 * `docs/features/07-monitorizacion-historica.md`): separación CVD y de
 * visión normal en el límite superior en ambos modos. Tres tonos claros
 * (magenta/amarillo/aqua, índices 2-4) quedan por debajo de 3:1 de contraste
 * sobre fondo blanco — la propia skill exige entonces "relief": marcadores
 * de punto grandes y visibles en vez de solo una línea fina (ver `pointRadius`
 * más abajo), no simplemente aceptar que esa línea sea casi invisible.
 *
 * Variantes claro/oscuro separadas porque Chart.js dibuja en un `<canvas>`:
 * no puede resolver `prefers-color-scheme` por CSS como el resto de la app.
 */
const CATEGORICAL_HUES_LIGHT = [
  '#2a78d6',
  '#008300',
  '#e87ba4',
  '#eda100',
  '#1baf7a',
  '#eb6834',
  '#4a3aa7',
  '#e34948',
];
const CATEGORICAL_HUES_DARK = [
  '#3987e5',
  '#008300',
  '#d55181',
  '#c98500',
  '#199e70',
  '#d95926',
  '#9085e9',
  '#e66767',
];

/**
 * Modal (RF-04, `[[07-monitorizacion-historica]]`): dibuja la evolución de
 * precio de una o varias gasolineras favoritas con `ng2-charts`. Recibe los
 * datos YA resueltos (`stations`, con `puntos: PriceHistoryPoint[]` por
 * gasolinera) — este componente no conoce `FavoritesService` ni Firestore,
 * solo dibuja lo que se le pasa. `FavoritesPanelPage` es responsable de
 * llamar a `FavoritesService.getHistory(...)` y construir `PriceChartStation[]`
 * antes de presentar este modal (`ModalController.create({ componentProps })`).
 */
@Component({
  selector: 'app-price-chart-modal',
  standalone: true,
  templateUrl: './price-chart-modal.component.html',
  styleUrl: './price-chart-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon, IonContent, BaseChartDirective],
})
export class PriceChartModalComponent implements OnInit {
  private readonly modalController = inject(ModalController);
  private readonly prefersDark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;

  @Input({ required: true }) stations: PriceChartStation[] = [];
  @Input() title = 'Evolución de precio';

  protected chartData: ChartData<'line', (number | null)[], string> = { labels: [], datasets: [] };
  protected chartOptions: ChartConfiguration<'line'>['options'] = {};

  constructor() {
    addIcons({ closeOutline });
  }

  /**
   * `stations` es `{ required: true }` y se fija UNA vez al crear el modal
   * (`componentProps` de `ModalController.create(...)`, ver
   * `favorites-panel.page.ts`) — nunca cambia mientras el modal está abierto.
   *
   * CORRECCIÓN (verificado con Playwright + cuenta de prueba real, ver
   * `docs/features/07-monitorizacion-historica.md`): este método usaba
   * `ngOnChanges`, que en un componente creado normalmente por un `@Input`
   * enlazado en plantilla es el sitio correcto para recalcular tras cada
   * cambio. Pero `ModalController` (con la configuración por defecto de
   * `provideIonicAngular()` de este proyecto, `app.config.ts`, que NO activa
   * `useSetInputAPI: true`) aplica `componentProps` con `Object.assign(instance,
   * params)` (confirmado leyendo `node_modules/@ionic/angular/.../attachView`),
   * NO con `componentRef.setInput(...)` — y solo esta última dispara
   * `ngOnChanges`. Con `Object.assign`, `ngOnChanges` NUNCA se ejecutaba: el
   * modal se abría siempre con `chartData`/`chartOptions` en su valor inicial
   * (`{ labels: [], datasets: [] }`), mostrando el estado "sin histórico"
   * incluso con datos reales ya en Firestore (confirmado con una lectura
   * directa a la API REST de Firestore durante la verificación: el documento
   * de hoy existía, pero el modal seguía vacío). `ngOnInit`, en cambio, se
   * ejecuta en el primer ciclo de detección de cambios del componente sin
   * importar CÓMO se fijaron sus `@Input`s — y `Object.assign` ya ha corrido
   * ANTES de que Angular dispare ese primer ciclo (`attachView` asigna las
   * props y solo LUEGO llama a `applicationRef.attachView(...)`), así que
   * `this.stations` ya tiene su valor real para cuando `ngOnInit` lee.
   */
  ngOnInit(): void {
    this.chartData = this.buildChartData(this.stations);
    this.chartOptions = this.buildChartOptions(this.stations.length);
  }

  protected dismiss(): void {
    void this.modalController.dismiss();
  }

  /**
   * El eje X son TODOS los días entre el más antiguo y el más reciente
   * registrado (de cualquier estación), no solo los días con dato — así
   * `spanGaps: true` tiene huecos reales (`null`) que saltar cuando falta el
   * registro de un día concreto (app no abierta ese día, fallo puntual de
   * escritura, etc.), en vez de una escala categórica que solo conociera los
   * días que sí existen y por tanto nunca tuviera un hueco que salvar.
   */
  private buildChartData(stations: PriceChartStation[]): ChartData<'line', (number | null)[], string> {
    const todasLasFechas = stations
      .reduce<string[]>((fechas, station) => fechas.concat(station.puntos.map((punto) => punto.date)), [])
      .sort();
    if (todasLasFechas.length === 0) {
      return { labels: [], datasets: [] };
    }

    const labels = enumerateDateRange(todasLasFechas[0], todasLasFechas[todasLasFechas.length - 1]);
    const hues = this.prefersDark ? CATEGORICAL_HUES_DARK : CATEGORICAL_HUES_LIGHT;
    const superficie = this.prefersDark ? '#1a1a19' : '#fcfcfb';

    const datasets = stations.map((station, index) => {
      const precioPorFecha = new Map(station.puntos.map((punto) => [punto.date, punto.price]));
      const color = hues[index % hues.length];
      // Con más de 8 gasolineras (fuera de la paleta validada, aunque el
      // límite de favoritos de la app es 10 — ver MAX_GASOLINERAS_GUARDADAS),
      // un guión discontinuo es una codificación secundaria: dos series
      // nunca comparten color Y trazo continuo a la vez.
      const conGuionDiscontinuo = index >= hues.length;

      return {
        label: `${station.marca} (${station.municipio})`,
        data: labels.map((fecha) => precioPorFecha.get(fecha) ?? null),
        borderColor: color,
        backgroundColor: color,
        pointBackgroundColor: color,
        pointBorderColor: superficie,
        borderDash: conGuionDiscontinuo ? [6, 4] : [],
        spanGaps: true,
        borderWidth: 2,
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 5,
        tension: 0.25,
        fill: false,
      };
    });

    return { labels, datasets };
  }

  /**
   * Sin leyenda para una sola gasolinera (una única serie no necesita
   * "adivinar" de qué color es — el título del modal ya lo dice); con dos o
   * más, leyenda SIEMPRE visible (canal de identidad fiable, nunca solo
   * color-matching) — mismo criterio que ya exige la skill de dataviz.
   */
  private buildChartOptions(seriesCount: number): ChartConfiguration<'line'>['options'] {
    const inkMuted = '#898781';
    const inkSecondary = this.prefersDark ? '#c3c2b7' : '#52514e';
    const gridColor = this.prefersDark ? '#2c2c2a' : '#e1e0d9';

    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          title: { display: true, text: 'Fecha', color: inkMuted },
          ticks: { color: inkMuted, maxRotation: 45, minRotation: 0 },
          grid: { color: gridColor },
        },
        y: {
          title: { display: true, text: 'Precio (€/L)', color: inkMuted },
          // Formato español (coma decimal), no el punto que da `toFixed` por
          // defecto — mismo criterio ya aplicado al popup del mapa y a las
          // tarjetas de favoritos (ver `docs/features/06-favoritos.md`).
          // Sin este `callback`, Chart.js formatea los ticks numéricos según
          // el locale del navegador (`Intl.NumberFormat` implícito), que no
          // siempre es español — con esto, el eje es consistente sin
          // importar el idioma del dispositivo.
          ticks: {
            color: inkMuted,
            callback: (valor) => (typeof valor === 'number' ? valor.toFixed(3).replace('.', ',') : valor),
          },
          grid: { color: gridColor },
        },
      },
      plugins: {
        legend: {
          display: seriesCount > 1,
          position: 'bottom',
          labels: { color: inkSecondary },
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const valor = context.parsed.y;
              return valor === null || valor === undefined
                ? `${context.dataset.label}: sin dato ese día`
                : `${context.dataset.label}: ${valor.toFixed(3).replace('.', ',')} €`;
            },
          },
        },
      },
    };
  }
}

function enumerateDateRange(startId: string, endId: string): string[] {
  const inicio = parseDateId(startId);
  const fin = parseDateId(endId);
  const fechas: string[] = [];
  for (const cursor = new Date(inicio); cursor <= fin; cursor.setDate(cursor.getDate() + 1)) {
    fechas.push(formatDateId(cursor));
  }
  return fechas;
}

function parseDateId(dateId: string): Date {
  const [yyyy, mm, dd] = dateId.split('-').map(Number);
  return new Date(yyyy, mm - 1, dd);
}

function formatDateId(fecha: Date): string {
  const yyyy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const dd = String(fecha.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
