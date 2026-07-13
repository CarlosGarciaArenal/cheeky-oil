import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, take } from 'rxjs';

import { AuthService } from '../services/auth.service';

/**
 * Protege rutas que requieren sesión. Usa `authState$` (Observable) en vez del
 * signal `currentUser`: `take(1)` espera a la primera emisión REAL de Firebase
 * (que persiste la sesión en IndexedDB y tarda un instante en resolverla al
 * cargar la app), evitando redirigir a `/login` a un usuario ya autenticado
 * solo porque el signal todavía no había recibido su primer valor.
 */
export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.authState$.pipe(
    take(1),
    map((currentUser) => (currentUser ? true : router.parseUrl('/login'))),
  );
};
