import { Routes } from '@angular/router';

import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage),
  },
  {
    // Sin `authGuard`, a propósito: hace falta poder registrarse sin sesión
    // previa (es justo el punto de esta ruta). La única puerta real es el
    // Código Familiar comprobado dentro de `AuthService.register()`, no el
    // router (ver `[[05b-registro-seguro]]`).
    path: 'register',
    loadComponent: () => import('./pages/register/register.page').then((m) => m.RegisterPage),
  },
  {
    path: 'home',
    canActivate: [authGuard],
    loadComponent: () => import('./home/home.page').then((m) => m.HomePage),
  },
  {
    // Protegida igual que `home`: `FavoritesPanelPage` depende de una sesión
    // activa (`FavoritesService`), así que no tiene sentido como ruta pública.
    path: 'favoritos',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/favorites-panel/favorites-panel.page').then((m) => m.FavoritesPanelPage),
  },
  {
    // Protegida igual que `favoritos`: `RoutePlannerPage` también depende de
    // una sesión activa (`FavoritesService`, para el botón de favorito de
    // cada gasolinera del popup — `[[09-rutas]]`).
    path: 'rutas',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/route-planner/route-planner.page').then((m) => m.RoutePlannerPage),
  },
  {
    // Sin sesión, `authGuard` intercepta esta redirección y desvía a `/login`
    // (ver `auth.guard.ts`): la ruta por defecto resultante es el login
    // cuando no hay usuario autenticado, y el mapa cuando sí lo hay.
    path: '',
    redirectTo: 'home',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: 'home',
  },
];
