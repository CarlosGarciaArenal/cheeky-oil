import { Component, DestroyRef, effect, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { PushNotifications, type Token } from '@capacitor/push-notifications';
import {
  IonApp,
  IonButton,
  IonButtons,
  IonHeader,
  IonIcon,
  IonRouterOutlet,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { logOutOutline, navigateOutline, starOutline } from 'ionicons/icons';

import { AuthService } from './core/services/auth.service';
import { LocationService } from './core/services/location.service';
import { ThemeService } from './core/services/theme.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrl: 'app.component.scss',
  imports: [IonApp, IonRouterOutlet, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon, RouterLink],
})
export class AppComponent {
  /** `protected` (no `private`) a propósito: la plantilla lo lee directamente (`@if (authService.currentUser())`) para mostrar el botón de cerrar sesión solo cuando hay sesión activa. */
  protected readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  /**
   * Inyectado aquí (sin que la plantilla lo use) para que el tema se aplique
   * "al iniciar la app" (RF-0X): `providedIn: 'root'` construye la instancia
   * en su primera inyección real, que con `AppComponent` siendo la raíz del
   * árbol de componentes ocurre lo antes posible — el `effect()` de su
   * constructor lee la preferencia guardada y aplica la clase CSS de
   * inmediato, sin esperar a que ninguna otra vista lo inyecte primero.
   */
  private readonly themeService = inject(ThemeService);
  private readonly locationService = inject(LocationService);
  private readonly destroyRef = inject(DestroyRef);

  /** Evita repetir el registro de push en cada reevaluación del `effect()` mientras la sesión sigue activa. */
  private pushInitialized = false;
  private registrationListener?: PluginListenerHandle;
  private registrationErrorListener?: PluginListenerHandle;

  constructor() {
    addIcons({ logOutOutline, navigateOutline, starOutline });

    /**
     * Permiso de ubicación (empaquetado nativo): se pide "al entrar por
     * primera vez a la app" (pedido explícito del usuario, ver
     * `docs/features/02-mapa-base.md`), no gated a `currentUser()` como el
     * bloque de push de abajo — a diferencia del token FCM, el permiso de
     * ubicación no necesita asociarse a ningún `uid`, así que no hay motivo
     * para esperar a que exista sesión. Sin flag `already-requested`: al
     * vivir en el constructor (no en un `effect()`), esta llamada ya
     * ocurre una única vez por instancia de `AppComponent` — que, al ser
     * la raíz del árbol, prácticamente nunca se destruye/recrea durante
     * una sesión de la app.
     */
    void this.locationService.requestPermissions();

    /**
     * Push Notifications (empaquetado nativo, `[[12-push-notifications]]`).
     * `Capacitor.isNativePlatform()` es obligatorio: en web este plugin no
     * tiene implementación real y llamarlo sin la guarda lanza
     * "not implemented on web". Se dispara a partir de `currentUser()`
     * (no directamente en el constructor) a propósito: pedir el permiso de
     * notificaciones ANTES de que exista sesión guardaría un token que
     * `AuthService.saveFcmToken()` no podría asociar a ningún usuario
     * (no-op silencioso, ver su documentación) — y el evento 'registration'
     * no vuelve a dispararse solo porque el usuario haga login después.
     */
    effect(() => {
      if (Capacitor.isNativePlatform() && this.authService.currentUser() && !this.pushInitialized) {
        this.pushInitialized = true;
        void this.initPushNotifications();
      }
    });

    this.destroyRef.onDestroy(() => {
      void this.registrationListener?.remove();
      void this.registrationErrorListener?.remove();
    });
  }

  protected async onLogout(): Promise<void> {
    await this.authService.logout();
    await this.router.navigateByUrl('/login', { replaceUrl: true });
  }

  /**
   * Solicita permiso, se suscribe a 'registration'/'registrationError' y
   * registra el dispositivo. Si el usuario deniega el permiso, no se llega
   * a llamar `register()` (evita un registro nativo inútil sin forma de
   * recibir notificaciones).
   */
  private async initPushNotifications(): Promise<void> {
    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') return;

    this.registrationListener = await PushNotifications.addListener('registration', (token: Token) => {
      void this.authService.saveFcmToken(token.value);
    });
    this.registrationErrorListener = await PushNotifications.addListener('registrationError', (error) => {
      console.error('Error al registrar notificaciones push:', error);
    });

    await PushNotifications.register();
  }
}
