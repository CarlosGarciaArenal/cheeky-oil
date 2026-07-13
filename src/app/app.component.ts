import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
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
import { logOutOutline } from 'ionicons/icons';

import { AuthService } from './core/services/auth.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrl: 'app.component.scss',
  imports: [IonApp, IonRouterOutlet, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon],
})
export class AppComponent {
  /** `protected` (no `private`) a propósito: la plantilla lo lee directamente (`@if (authService.currentUser())`) para mostrar el botón de cerrar sesión solo cuando hay sesión activa. */
  protected readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  constructor() {
    addIcons({ logOutOutline });
  }

  protected async onLogout(): Promise<void> {
    await this.authService.logout();
    await this.router.navigateByUrl('/login', { replaceUrl: true });
  }
}
