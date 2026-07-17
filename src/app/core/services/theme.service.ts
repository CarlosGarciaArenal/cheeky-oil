import { Injectable, computed, effect, signal } from '@angular/core';

/** Modo de tema elegido por el usuario. `'system'` sigue la preferencia del SO en vivo (`prefers-color-scheme`). */
export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_STORAGE_KEY = 'cheeky-oil-theme';

/**
 * Clase que activa la paleta oscura de Ionic (`dark.class.css`, ver `global.scss`).
 * Se cambió el import de `dark.system.css` a `dark.class.css` precisamente para
 * poder controlarla a mano desde aquí: con `dark.system.css` el modo oscuro
 * sigue SIEMPRE la preferencia del sistema vía media query, sin ninguna forma
 * de que el usuario fuerce "Claro" aunque su SO esté en oscuro (o viceversa).
 */
const DARK_PALETTE_CLASS = 'ion-palette-dark';

/**
 * Gestiona el tema Claro/Oscuro/Sistema de la app (RF-0X). Estado en un signal,
 * persistido en `localStorage` (sin backend, sin coste de Firebase: es una
 * preferencia puramente local del dispositivo). `providedIn: 'root'`: única
 * instancia para toda la app, igual que el resto de servicios del proyecto.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly systemPrefersDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  /** Preferencia elegida por el usuario (o `'system'` por defecto/no guardada aún). */
  readonly mode = signal<ThemeMode>(this.readStoredMode());

  /**
   * Preferencia del SISTEMA en vivo, como signal — no solo leída una vez. Sin
   * esto, si el usuario tiene `mode() === 'system'` y cambia el tema del SO
   * mientras la app está abierta, no habría ninguna signal que un `effect()`
   * pudiera "ver" cambiar, y la paleta se quedaría con el valor de sistema
   * capturado al arrancar.
   */
  private readonly systemPrefersDark = signal(this.systemPrefersDarkQuery.matches);

  /** Tema oscuro REALMENTE activo ahora mismo, resolviendo `'system'` contra la preferencia real del SO. */
  readonly isDark = computed(() => {
    const mode = this.mode();
    return mode === 'dark' || (mode === 'system' && this.systemPrefersDark());
  });

  constructor() {
    this.systemPrefersDarkQuery.addEventListener('change', (event) => this.systemPrefersDark.set(event.matches));

    // Aplica la clase CSS al `<html>` cada vez que cambia el modo resuelto.
    // Se ejecuta también en la construcción del servicio (primer disparo de
    // todo `effect()`), que es precisamente el momento de "arranque de la
    // app" en que `AppComponent` inyecta este servicio por primera vez.
    effect(() => {
      document.documentElement.classList.toggle(DARK_PALETTE_CLASS, this.isDark());
    });
  }

  /** Fija un modo explícito y lo persiste. */
  setMode(mode: ThemeMode): void {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
    this.mode.set(mode);
  }

  /**
   * Alterna entre Claro y Oscuro para el botón de icono sol/luna (RF-0X). Se
   * basa en `isDark()` (el tema REALMENTE activo, no en `mode()` a secas) para
   * que, partiendo de `'system'`, el primer toque siempre invierta lo que el
   * usuario está viendo ahora mismo — nunca un salto que dependa de qué decía
   * el modo antes de resolver `'system'`. A partir de ahí queda fijado en
   * `'light'`/`'dark'` explícito (deja de seguir al sistema), como espera un
   * toggle binario simple.
   */
  toggle(): void {
    this.setMode(this.isDark() ? 'light' : 'dark');
  }

  private readStoredMode(): ThemeMode {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  }
}
