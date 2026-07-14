import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
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
  SelectCustomEvent,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowBackOutline, medalOutline, trashOutline, trendingUpOutline } from 'ionicons/icons';
import { catchError, of, switchMap } from 'rxjs';

import { FuelType } from '../../core/models/gas-station.model';
import { FavoriteWithPrice } from '../../core/models/favorite.model';
import { FavoritesService } from '../../core/services/favorites.service';

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
  private readonly destroyRef = inject(DestroyRef);

  protected readonly fuelLabels = FUEL_LABELS;
  protected readonly selectedFuel = signal<FuelType>(DEFAULT_FUEL);

  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly favoritos = signal<FavoriteWithPrice[]>([]);

  /** `id` del favorito cuyo botón "Quitar" está esperando la respuesta de Firestore (deshabilita SOLO ese botón, no toda la lista). */
  protected readonly removingId = signal<string | null>(null);

  constructor() {
    addIcons({ arrowBackOutline, medalOutline, trashOutline, trendingUpOutline });

    // `switchMap`, no `subscribe` directo dentro de un `effect()`: cambiar de
    // combustible cambia el propio `Observable` de origen (un nuevo
    // `getFavoritesWithPrices(fuel)`, con su propia petición HTTP a MITECO y
    // su propio listener de Firestore) — `switchMap` cancela limpiamente la
    // suscripción anterior antes de crear la nueva, evitando dos listeners
    // de Firestore activos a la vez si el usuario cambia de combustible
    // varias veces seguidas.
    toObservable(this.selectedFuel)
      .pipe(
        switchMap((fuel) => {
          this.loading.set(true);
          this.errorMessage.set(null);

          // `catchError` DENTRO del `Observable` interno (por combustible),
          // no envolviendo todo el `pipe` externo: un error aquí (ej. sesión
          // caída, fallo de red de MITECO) solo afecta a ESTA emisión. Si el
          // error escapara hasta el `pipe` de `toObservable(selectedFuel)`,
          // RxJS completaría/terminaría con error TODA la cadena, y cambiar
          // de combustible después de un fallo ya no volvería a disparar
          // ninguna consulta (el `switchMap` externo ya estaría muerto).
          return this.favoritesService.getFavoritesWithPrices(fuel).pipe(
            catchError((error: unknown) => {
              this.errorMessage.set(
                error instanceof Error ? error.message : 'No se pudieron cargar los favoritos.',
              );
              return of<FavoriteWithPrice[]>([]);
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((favoritosConPrecio) => {
        this.loading.set(false);
        this.favoritos.set(favoritosConPrecio);
      });
  }

  protected onFuelChange(event: SelectCustomEvent): void {
    const value: unknown = event.detail.value;
    if (value === 'gasolina95' || value === 'gasolina98' || value === 'diesel') {
      this.selectedFuel.set(value);
    }
  }

  protected async onRemove(favorito: FavoriteWithPrice): Promise<void> {
    if (this.removingId()) {
      return;
    }

    this.removingId.set(favorito.id);
    try {
      await this.favoritesService.removeFavorite(favorito.id);
      // Sin actualización manual de `this.favoritos`: el listener en vivo de
      // `getFavoritesWithPrices` (vía `getFavorites()`) recibe la baja de
      // Firestore y vuelve a emitir solo, igual que ya hace `MapComponent`
      // con el botón del popup (`[[06-favoritos]]`, sección UI-DEV).
    } catch (error: unknown) {
      this.errorMessage.set(
        error instanceof Error ? error.message : 'No se pudo quitar la gasolinera de favoritos.',
      );
    } finally {
      this.removingId.set(null);
    }
  }
}
