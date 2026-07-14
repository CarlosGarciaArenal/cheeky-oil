import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonButton, IonContent, IonInput, IonItem, IonList, IonSpinner, IonText } from '@ionic/angular/standalone';

import { AuthService } from '../../core/services/auth.service';

/** Código de error de `firebase/app` para email ya registrado (ver `AuthService.register`, `[[05b-registro-seguro]]`). */
const EMAIL_IN_USE_CODE = 'auth/email-already-in-use';
/** Código de error de `firebase/app` para contraseña por debajo del mínimo exigido por Firebase Auth (6 caracteres). */
const WEAK_PASSWORD_CODE = 'auth/weak-password';
/** Mensaje lanzado a propósito por `AuthService.register` cuando el código familiar no coincide (no es un error de Firebase). */
const INVALID_FAMILY_CODE_MESSAGE = 'Código familiar incorrecto.';

/** `FirebaseError` (de `firebase/app`) sin importar la clase: solo nos interesa distinguir por `.code`. */
function firebaseErrorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code: unknown }).code === 'string'
    ? (error as { code: string }).code
    : null;
}

/**
 * Registro con Código Familiar (RF-10/RNF-08, `[[05b-registro-seguro]]`).
 * Mismo patrón que `LoginPage`: Reactive Forms + `errorText` por campo, un
 * único banner de error para el resultado del envío. La diferencia es que
 * aquí SÍ distinguimos el motivo del fallo (código incorrecto / email ya
 * registrado / contraseña débil) porque, a diferencia del login, no hay
 * riesgo de enumeración de cuentas que evitar: quien se registra ya sabe
 * si esperaba o no que ese email existiera.
 */
@Component({
  selector: 'app-register',
  templateUrl: './register.page.html',
  styleUrl: './register.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, IonContent, IonButton, IonInput, IonItem, IonList, IonSpinner, IonText],
})
export class RegisterPage {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly errorMessage = signal<string | null>(null);
  protected readonly loading = signal(false);
  /** Resaltan visualmente el campo responsable del error del último intento, además del banner. */
  protected readonly invalidFamilyCode = signal(false);
  protected readonly emailAlreadyInUse = signal(false);

  protected readonly form = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    familyCode: ['', [Validators.required]],
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
    this.resetErrors();
    const { email, password, familyCode } = this.form.getRawValue();

    try {
      await this.authService.register(email, password, familyCode);
      await this.router.navigateByUrl('/home', { replaceUrl: true });
    } catch (error) {
      this.handleError(error);
    } finally {
      this.loading.set(false);
    }
  }

  private handleError(error: unknown): void {
    if (error instanceof Error && error.message === INVALID_FAMILY_CODE_MESSAGE) {
      this.invalidFamilyCode.set(true);
      this.errorMessage.set('Código secreto incorrecto. Consulta el código con quien te lo compartió.');
      return;
    }

    const code = firebaseErrorCode(error);
    if (code === EMAIL_IN_USE_CODE) {
      this.emailAlreadyInUse.set(true);
      this.errorMessage.set('Ya existe una cuenta con ese email. Prueba a iniciar sesión.');
      return;
    }
    if (code === WEAK_PASSWORD_CODE) {
      this.errorMessage.set('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    this.errorMessage.set('No se pudo completar el registro. Inténtalo de nuevo.');
  }

  private resetErrors(): void {
    this.errorMessage.set(null);
    this.invalidFamilyCode.set(false);
    this.emailAlreadyInUse.set(false);
  }
}
