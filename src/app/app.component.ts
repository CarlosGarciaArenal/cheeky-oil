import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
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

  constructor() {
    addIcons({ logOutOutline, navigateOutline, starOutline });
  }

  protected async onLogout(): Promise<void> {
    await this.authService.logout();
    await this.router.navigateByUrl('/login', { replaceUrl: true });
  }
}
