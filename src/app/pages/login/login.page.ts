import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { IonButton, IonContent, IonInput, IonItem, IonList, IonSpinner, IonText } from '@ionic/angular/standalone';

import { AuthService } from '../../core/services/auth.service';

/**
 * Formulario mínimo de acceso (email/password). Sin registro ni "recuperar
 * contraseña": es una app personal/familiar (ver `CLAUDE.md`), las cuentas
 * se crean manualmente desde la consola de Firebase, no hace falta
 * autoservicio de alta.
 */
@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, IonContent, IonButton, IonInput, IonItem, IonList, IonSpinner, IonText],
})
export class LoginPage {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);

  /** Mensaje de error genérico (no distingue "email no existe" de "contraseña incorrecta") para no facilitar enumeración de cuentas. */
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly loading = signal(false);

  protected readonly form = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  protected async onSubmit(): Promise<void> {
    if (this.loading()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);
    const { email, password } = this.form.getRawValue();

    try {
      await this.authService.login(email, password);
      await this.router.navigateByUrl('/home', { replaceUrl: true });
    } catch {
      this.errorMessage.set('Email o contraseña incorrectos.');
    } finally {
      this.loading.set(false);
    }
  }
}
