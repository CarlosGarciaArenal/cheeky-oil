/**
 * Límite estricto de gasolineras guardadas por usuario.
 * Definido como constante (no mágico) para que la validación en el
 * cliente y en las Cloud Functions/Firestore Rules referencien el mismo valor.
 */
export const MAX_GASOLINERAS_GUARDADAS = 10;

/**
 * Documento raíz de la colección `users` en Firestore (id = uid de Firebase Auth).
 * `gasolinerasGuardadasIds` almacena solo IDs (no objetos GasStation completos)
 * para minimizar el tamaño del documento y evitar datos duplicados/desactualizados:
 * los precios siempre se leen desde la colección `gasStations`.
 */
export interface AppUser {
  uid: string;
  email: string;
  nombre: string;
  /**
   * IDs de GasStation guardadas por el usuario.
   * Debe validarse (cliente + Firestore Rules) que su longitud
   * nunca supere MAX_GASOLINERAS_GUARDADAS.
   */
  gasolinerasGuardadasIds: string[];
  creadoEn: number;
  /**
   * Token FCM del dispositivo nativo actual (`[[12-push-notifications]]`).
   * Opcional: solo existe tras el primer registro de push notifications en
   * una build nativa (Android) — nunca se escribe en web. Se sobrescribe en
   * cada `register()` (un usuario con varios dispositivos solo conserva el
   * token del último con el que se autenticó; suficiente para el caso de uso
   * personal/familiar de la app, ver `CLAUDE.md`).
   */
  fcmToken?: string;
}
