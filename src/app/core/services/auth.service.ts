import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  Auth,
  User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  user,
} from '@angular/fire/auth';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';

/** Ruta fija del documento de configuración que guarda el código familiar (RNF-08, `[[05b-registro-seguro]]`). */
const SECURITY_CONFIG_PATH = 'config/security';

/**
 * Envuelve Firebase Auth (email/password). No mantiene suscripciones propias:
 * `currentUser` se deriva de `user(auth)` vía `toSignal`, que se limpia solo
 * al destruirse el injector raíz (no requiere `ngOnDestroy`).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth);
  private readonly firestore = inject(Firestore);

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

  /**
   * Registro con "Código Familiar" (RNF-08): SOLO crea la cuenta si `userCode`
   * coincide con `familyCode` en `config/security` de Firestore. La lectura de
   * ese documento ocurre siempre antes que `createUserWithEmailAndPassword`,
   * para no dejar nunca una cuenta creada con un código incorrecto.
   *
   * ADVERTENCIA (ver justificación completa en `docs/features/05b-registro-seguro.md`):
   * esta comprobación es del lado del cliente, no un límite de seguridad real.
   * `config/security` tiene que ser legible sin sesión (el usuario aún no
   * existe cuando se lee), así que el código es, por diseño, público para
   * cualquiera que consulte Firestore directamente — y nada impide a alguien
   * con conocimientos técnicos llamar a `createUserWithEmailAndPassword`
   * saltándose esta función. Es un filtro disuasorio (evita altas casuales),
   * NO el límite real de acceso a los datos familiares: ese límite lo siguen
   * imponiendo las Firestore Security Rules por `uid` (RNF-07).
   */
  async register(email: string, password: string, userCode: string): Promise<User> {
    const securityDocRef = doc(this.firestore, SECURITY_CONFIG_PATH);
    const securityDocSnap = await getDoc(securityDocRef);
    const familyCode = securityDocSnap.data()?.['familyCode'];

    if (!securityDocSnap.exists() || familyCode !== userCode) {
      throw new Error('Código familiar incorrecto.');
    }

    const credential = await createUserWithEmailAndPassword(this.auth, email, password);
    return credential.user;
  }

  async logout(): Promise<void> {
    await signOut(this.auth);
  }

  getCurrentUser(): User | null {
    return this.auth.currentUser;
  }
}
