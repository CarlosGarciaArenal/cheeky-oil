import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  Auth,
  User,
  signInWithEmailAndPassword,
  signOut,
  user,
} from '@angular/fire/auth';

/**
 * Envuelve Firebase Auth (email/password). No mantiene suscripciones propias:
 * `currentUser` se deriva de `user(auth)` vía `toSignal`, que se limpia solo
 * al destruirse el injector raíz (no requiere `ngOnDestroy`).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth);

  /**
   * Observable crudo de Firebase Auth, expuesto para consumidores (ej. `authGuard`)
   * que necesitan esperar la PRIMERA emisión real (`take(1)`) en vez de leer el
   * signal `currentUser`, cuyo valor inicial síncrono (`undefined`) no distingue
   * "aún resolviendo la sesión persistida" de "sin sesión".
   */
  readonly authState$ = user(this.auth);

  /** Estado reactivo del usuario autenticado (undefined = aún no resuelto, null = sin sesión). */
  readonly currentUser = toSignal(this.authState$, { initialValue: undefined });

  async login(email: string, password: string): Promise<User> {
    const credential = await signInWithEmailAndPassword(this.auth, email, password);
    return credential.user;
  }

  async logout(): Promise<void> {
    await signOut(this.auth);
  }

  getCurrentUser(): User | null {
    return this.auth.currentUser;
  }
}
