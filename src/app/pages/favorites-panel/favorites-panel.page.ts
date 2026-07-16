import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { NgClass } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  IonButton,
  IonContent,
  IonIcon,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonText,
  ModalController,
  SelectCustomEvent,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowBackOutline, medalOutline, statsChartOutline, trashOutline, trendingUpOutline } from 'ionicons/icons';
import { catchError, combineLatest, firstValueFrom, map, of, shareReplay, switchMap, tap } from 'rxjs';

import { PriceChartModalComponent, PriceChartStation } from '../../components/price-chart-modal/price-chart-modal.component';
import { FuelType, GasStation } from '../../core/models/gas-station.model';
import { Favorite, FavoriteWithPrice } from '../../core/models/favorite.model';
import { FavoritesService } from '../../core/services/favorites.service';
import { MitecoService } from '../../core/services/miteco.service';

/**
 * Id "sentinela" para `loadingHistoryId` cuando el botón en curso es el
 * general ("Ver evolución general"), no el de una tarjeta concreta. No
 * puede colisionar con un `Favorite.id` real: los IDEESS de MITECO son
 * siempre numéricos (ver comentario ya existente sobre `escapeHtmlAttribute`
 * en `map.component.ts`, `[[06-favoritos]]`).
 */
const GENERAL_HISTORY_ID = '__general__';

/**
 * Etiquetas de combustible para el selector de esta página. Deliberadamente
 * un `Record` local pequeño (3 entradas), no importado desde `map.component.ts`
 * (que tiene uno estructuralmente idéntico, `FUEL_LABELS`, sin exportar):
 * evita acoplar esta página a un componente de UI ajeno por 3 strings. Si en
 * el futuro aparece un tercer consumidor, se debería extraer a un sitio
 * compartido (ver nota de `[[06-favoritos]]` sobre unificar `FuelType`).
 */
const FUEL_LABELS: Record<FuelType, string> = {
  gasolina95: 'Gasolina 95',
  gasolina98: 'Gasolina 98',
  diesel: 'Diésel',
};

/** `FuelType` no tiene un valor "por defecto" propio (es un `keyof`); se fija aquí el mismo criterio que ya usa `MapComponent`. */
const DEFAULT_FUEL: FuelType = 'gasolina95';

/**
 * URL universal de Google Maps para trazar ruta hasta una gasolinera (sin
 * API key, sin coste). Duplicada a propósito respecto a la función homónima
 * de `map.component.ts` (mismo criterio ya aplicado a `FUEL_LABELS` en este
 * mismo archivo): evita acoplar esta página a un componente de UI ajeno por
 * una función de una línea.
 *
 * CORRECCIÓN CRÍTICA [ARQUITECTO] (RF-04): enruta por TEXTO (rótulo +
 * dirección + localidad), no por `lat`/`lng` — las coordenadas de MITECO no
 * siempre son precisas; ver justificación completa en la función homónima de
 * `map.component.ts`. `encodeURIComponent` neutraliza cualquier carácter con
 * significado HTML que pudiera venir en `direccion`/`municipio` (texto libre
 * de MITECO/Firestore, sin validar), dejando el resultado seguro para un
 * atributo `[href]`.
 */
function buildGoogleMapsDirectionsUrl(rotulo: string, direccion: string, localidad: string): string {
  return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(`${rotulo} ${direccion}, ${localidad}`);
}

/**
 * Panel de favoritos (RF-04, "Monitorización y Comparación"): lista las
 * gasolineras guardadas por el usuario con su precio de HOY para el
 * combustible elegido, resaltando la más barata y la más cara del conjunto.
 * Ver `docs/features/06-favoritos.md` para el diseño completo.
 */
@Component({
  selector: 'app-favorites-panel',
  templateUrl: './favorites-panel.page.html',
  styleUrl: './favorites-panel.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgClass,
    RouterLink,
    IonButton,
    IonContent,
    IonIcon,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonText,
  ],
})
export class FavoritesPanelPage {
  private readonly favoritesService = inject(FavoritesService);
  private readonly mitecoService = inject(MitecoService);
  private readonly modalController = inject(ModalController);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly fuelLabels = FUEL_LABELS;
  protected readonly selectedFuel = signal<FuelType>(DEFAULT_FUEL);

  protected readonly loading = signal(true);
  /**
   * `true` mientras se está recalculando el precio para el combustible
   * recién seleccionado (una descarga completa de MITECO, ver comentario de
   * `estacionesPorFuel$` más abajo). Distinto de `loading`: `loading` solo
   * cubre la carga INICIAL de la lista de favoritos (Firestore, rápida);
   * `isLoading` cubre cualquier cambio de combustible posterior, para que la
   * plantilla pueda avisar de que el precio mostrado se está actualizando en
   * vez de dejar visible el precio del combustible anterior.
   */
  protected readonly isLoading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  /** Lista "rápida": solo Firestore (`getFavorites()`), SIN precio. Es la única fuente de la que depende `loading`/el estado vacío. */
  protected readonly favoritos = signal<Favorite[]>([]);
  /**
   * Precios de HOY, por id, cruzados con MITECO para el combustible elegido.
   * `null` = todavía no ha llegado ninguna respuesta (ni éxito ni error) para
   * el combustible actual — así el `computed` de abajo distingue "aún
   * cargando precio" de "cargó, y esta gasolinera no tiene". Ver
   * justificación completa del porqué de esta separación en
   * `docs/features/06-favoritos.md`.
   */
  protected readonly preciosPorId = signal<Map<string, FavoriteWithPrice> | null>(null);

  /** `id` del favorito cuyo botón "Quitar" está esperando la respuesta de Firestore (deshabilita SOLO ese botón, no toda la lista). */
  protected readonly removingId = signal<string | null>(null);

  /**
   * `id` del favorito (o `GENERAL_HISTORY_ID`) cuyo botón de histórico está
   * esperando `FavoritesService.getHistory(...)` — deshabilita SOLO ese
   * botón, mismo patrón ya usado por `removingId`.
   */
  protected readonly loadingHistoryId = signal<string | null>(null);
  protected readonly generalHistoryId = GENERAL_HISTORY_ID;

  /**
   * Vista combinada para la plantilla: cada favorito de la lista rápida,
   * emparejado con su entrada de `preciosPorId` (o `null` si ese mapa
   * general aún no ha llegado). Evita anidar `preciosPorId()?.get(id)` varias
   * veces dentro del `@for` de la plantilla.
   */
  protected readonly cardsView = computed(() => {
    const precios = this.preciosPorId();
    return this.favoritos().map((favorito) => ({
      favorito,
      precioInfo: precios?.get(favorito.id) ?? null,
    }));
  });

  constructor() {
    addIcons({ arrowBackOutline, medalOutline, statsChartOutline, trashOutline, trendingUpOutline });

    // `shareReplay({ bufferSize: 1, refCount: true })`: los dos usos de abajo
    // (la lista rápida, y el cruce con precios) necesitan los MISMOS datos de
    // `getFavorites()`, pero sin esto cada `.subscribe()` abriría su PROPIO
    // listener de Firestore independiente — el doble de lecturas (hasta 20
    // en vez de 10 al cargar, y el doble en cada cambio posterior) para el
    // mismo dato (hallazgo de una auditoría [REVIEWER], ver
    // `docs/features/06-favoritos.md`). Con `shareReplay`, solo se abre UN
    // listener real (al primer `.subscribe()`), que se cierra solo cuando
    // ambos consumidores se desuscriben (`refCount: true`); `bufferSize: 1`
    // hace que el segundo consumidor (el `combineLatest` de abajo) reciba
    // inmediatamente el último valor conocido en vez de esperar la próxima
    // emisión del listener.
    const favoritos$ = this.favoritesService.getFavorites().pipe(shareReplay({ bufferSize: 1, refCount: true }));

    // Lista de favoritos (Firestore, rápida): independiente del combustible
    // seleccionado — el nombre/dirección de un favorito no cambia al cambiar
    // de combustible. De ella depende `loading`/el estado vacío, para que la
    // lista aparezca sin esperar a la descarga completa de MITECO (~11.500
    // estaciones, la parte lenta, ver `preciosPorId` más abajo).
    favoritos$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (favoritos) => {
        this.loading.set(false);
        this.favoritos.set(favoritos);
      },
      error: (error: Error) => {
        this.loading.set(false);
        this.errorMessage.set(error.message);
      },
    });

    // MITECO: `switchMap` SOLO sobre `selectedFuel` (no sobre `favoritos$`).
    // A propósito separado del `combineLatest` de abajo, no anidado dentro de
    // él: si el `switchMap` envolviera también a `favoritos$`, cada alta/baja
    // de un favorito volvería a disparar una descarga completa de MITECO
    // (~11.500 estaciones) — justo lo que `getFavoritesWithPrices()` evita a
    // propósito con su propio `combineLatest` plano (ver su documentación,
    // más arriba). Así, solo cambiar de combustible pide MITECO de nuevo;
    // añadir/quitar un favorito reutiliza la última respuesta ya descargada.
    const estacionesPorFuel$ = toObservable(this.selectedFuel).pipe(
      // `tap` ANTES del `switchMap`: se ejecuta de inmediato al cambiar de
      // combustible, no cuando responde MITECO. Pone `isLoading` a `true` y
      // `preciosPorId` a `null` (mismo "aún no ha llegado nada" que el
      // estado inicial, ver su documentación) para que la plantilla deje de
      // mostrar el precio del combustible ANTERIOR mientras llega el nuevo —
      // sin esto, `preciosPorId` conservaba su último valor durante toda la
      // descarga de MITECO (~11.500 estaciones, 3-4 s), mostrando un precio
      // que ya no corresponde al combustible seleccionado.
      tap(() => {
        this.isLoading.set(true);
        this.preciosPorId.set(null);
      }),
      switchMap((fuel) =>
        this.mitecoService.getEstaciones().pipe(
          map((estaciones) => ({ fuel, estaciones })),
          // `catchError` DENTRO de este `switchMap` interno: un fallo de red
          // de MITECO para un combustible concreto no debe matar la cadena
          // externa (`estacionesPorFuel$` seguiría viva para el próximo
          // cambio de combustible).
          catchError((error: unknown) => {
            this.errorMessage.set(
              error instanceof Error ? error.message : 'No se pudieron cargar los precios.',
            );
            return of({ fuel, estaciones: [] as GasStation[] });
          }),
        ),
      ),
    );

    // Precios: cruce en memoria (`mergeWithPrices`, público en
    // `FavoritesService`) entre la MISMA `favoritos$` de arriba (reutilizada,
    // no una segunda llamada a `getFavorites()`) y `estacionesPorFuel$`. Al
    // ser un `combineLatest` PLANO (sin `switchMap` envolviéndolo), una
    // emisión de cualquiera de los dos simplemente recombina con el último
    // valor conocido del otro — nunca vuelve a pedir nada por sí solo. A
    // propósito NO toca `loading` (la carga INICIAL de la lista, ver su
    // documentación): es una mejora progresiva sobre la lista ya visible,
    // nunca bloquea la aparición de la lista en sí. Sí pone `isLoading` a
    // `false` aquí, en el único punto en que se conoce el precio ya
    // actualizado para el combustible vigente — sea el cruce recién resuelto
    // (éxito) o el `catchError` de `estacionesPorFuel$` (fallo ya gestionado,
    // con `estaciones: []`): ambos casos llegan hasta aquí y dejan de estar
    // "cargando".
    combineLatest([favoritos$, estacionesPorFuel$])
      .pipe(
        map(([favoritos, { fuel, estaciones }]) => ({
          favoritos,
          estaciones,
          favoritosConPrecio: this.favoritesService.mergeWithPrices(favoritos, estaciones, fuel),
        })),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ favoritos, estaciones, favoritosConPrecio }) => {
        this.preciosPorId.set(new Map(favoritosConPrecio.map((favorito) => [favorito.id, favorito])));
        this.isLoading.set(false);

        // Historiador (RF-04, `[[07-monitorizacion-historica]]`), llamado
        // explícitamente aquí: esta página NO usa `getFavoritesWithPrices`
        // (que ya lleva su propio `tap(recordTodayHistory)` para otros
        // consumidores), sino `getFavorites()` + `mergeWithPrices()` por
        // separado — sin esta llamada, el Historiador nunca se ejecutaría en
        // la práctica. Se pasan `favoritos`/`estaciones` CRUDOS (no
        // `favoritosConPrecio`, ya filtrado a un solo combustible): desde la
        // corrección [ARQUITECTO] del bug de histórico mezclado,
        // `recordTodayHistory` necesita `GasStation.precios` completo para
        // registrar los 3 combustibles a la vez (ver su documentación en
        // `FavoritesService`). Fire-and-forget: `recordTodayHistory` ya
        // captura sus propios errores, así que un fallo de Firestore al
        // escribir el histórico nunca puede afectar a los precios ya
        // mostrados en pantalla.
        void this.favoritesService.recordTodayHistory(favoritos, estaciones);
      });
  }

  /** Usado desde la plantilla para el `[href]` del enlace "📍 Cómo llegar" de cada tarjeta. */
  protected directionsUrl(favorito: Favorite): string {
    return buildGoogleMapsDirectionsUrl(favorito.marca, favorito.direccion, favorito.municipio);
  }

  protected onFuelChange(event: SelectCustomEvent): void {
    const value: unknown = event.detail.value;
    if (value === 'gasolina95' || value === 'gasolina98' || value === 'diesel') {
      this.selectedFuel.set(value);
    }
  }

  protected async onRemove(favorito: Favorite): Promise<void> {
    if (this.removingId()) {
      return;
    }

    this.removingId.set(favorito.id);
    try {
      await this.favoritesService.removeFavorite(favorito.id);
      // Sin actualización manual de `this.favoritos`/`this.preciosPorId`: el
      // listener en vivo compartido (`favoritos$`, ver constructor) recibe la
      // baja de Firestore y vuelve a emitir solo, igual que ya hace
      // `MapComponent` con el botón del popup (`[[06-favoritos]]`, sección UI-DEV).
    } catch (error: unknown) {
      this.errorMessage.set(
        error instanceof Error ? error.message : 'No se pudo quitar la gasolinera de favoritos.',
      );
    } finally {
      this.removingId.set(null);
    }
  }

  /** Botón "gráfica" de una tarjeta concreta: histórico de una única gasolinera. */
  protected async openStationHistory(favorito: Favorite): Promise<void> {
    await this.openHistoryModal(favorito.id, [favorito], `Evolución de precio — ${favorito.marca}`);
  }

  /** Botón "Ver evolución general": histórico de TODOS los favoritos actuales a la vez. */
  protected async openGeneralHistory(): Promise<void> {
    await this.openHistoryModal(GENERAL_HISTORY_ID, this.favoritos(), 'Evolución general de tus favoritas');
  }

  /**
   * Pide el histórico a `FavoritesService.getHistory(...)` (una sola vez,
   * `firstValueFrom` — no un listener: el histórico de días pasados es
   * inmutable, ver justificación en `[[07-monitorizacion-historica]]`) y
   * presenta `PriceChartModalComponent` ya con los datos resueltos, en vez de
   * abrir el modal primero y dejar que cargue por su cuenta: así el modal en
   * sí no necesita conocer `FavoritesService` ni gestionar su propio estado
   * de carga/error, solo dibujar lo que se le pasa (ver su documentación).
   *
   * `loadingId` (el `Favorite.id` de la tarjeta pulsada, o `GENERAL_HISTORY_ID`
   * para el botón general) deshabilita SOLO ese botón mientras se resuelve,
   * mismo patrón ya usado por `removingId` en `onRemove`.
   *
   * `getHistory(...)` recibe `this.selectedFuel()` (el combustible YA
   * seleccionado en esta pantalla, ver `onFuelChange`): la gráfica siempre
   * muestra la evolución del mismo combustible que el usuario está viendo en
   * las tarjetas en ese momento, nunca una mezcla de los 3 (corrección
   * [ARQUITECTO] del bug de histórico mezclado, ver `FavoritesService.getHistory`).
   * Por el mismo motivo, `PriceChartModalComponent` recibe `fuelLabel:
   * this.fuelLabels[this.selectedFuel()]` (texto legible, no el `FuelType`
   * en crudo — ver documentación de ese `@Input` en el propio componente)
   * para dejar claro en el título de la gráfica de qué combustible son los
   * datos, ya que el mismo botón puede abrirse con gasolina95, gasolina98 o
   * diésel según lo que el usuario tuviera seleccionado en ese momento.
   */
  private async openHistoryModal(
    loadingId: string,
    favoritosParaHistorico: Favorite[],
    titulo: string,
  ): Promise<void> {
    if (this.loadingHistoryId() || favoritosParaHistorico.length === 0) {
      return;
    }

    this.loadingHistoryId.set(loadingId);
    try {
      const historial = await firstValueFrom(
        this.favoritesService.getHistory(
          favoritosParaHistorico.map((favorito) => favorito.id),
          this.selectedFuel(),
        ),
      );

      const stations: PriceChartStation[] = favoritosParaHistorico.map((favorito) => ({
        id: favorito.id,
        marca: favorito.marca,
        municipio: favorito.municipio,
        puntos: historial.get(favorito.id) ?? [],
      }));

      const modal = await this.modalController.create({
        component: PriceChartModalComponent,
        componentProps: { stations, title: titulo, fuelLabel: this.fuelLabels[this.selectedFuel()] },
      });
      await modal.present();
    } catch (error: unknown) {
      this.errorMessage.set(
        error instanceof Error ? error.message : 'No se pudo cargar el histórico de precios.',
      );
    } finally {
      this.loadingHistoryId.set(null);
    }
  }
}
