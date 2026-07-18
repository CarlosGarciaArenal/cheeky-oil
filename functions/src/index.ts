/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import * as admin from "firebase-admin";
import {setGlobalOptions} from "firebase-functions";
import {onSchedule} from "firebase-functions/scheduler";
import * as logger from "firebase-functions/logger";

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({maxInstances: 10});

admin.initializeApp();

const firestore = admin.firestore();
const messaging = admin.messaging();

/**
 * Igual que `FuelType` en `src/app/core/models/gas-station.model.ts` —
 * duplicado porque `functions/` es un proyecto npm/tsconfig independiente
 * del cliente Angular.
 */
type FuelType = "gasolina95" | "gasolina98" | "diesel";
const FUEL_TYPES: readonly FuelType[] = ["gasolina95", "gasolina98", "diesel"];

/**
 * Igual que `PriceHistoryDoc` en `src/app/core/models/price-history.model.ts`
 * (documento de `users/{uid}/favorites/{favoriteId}/history/{date}`).
 */
interface PriceHistoryDoc {
  prices: Partial<Record<FuelType, number>>;
}

const PRICE_ALERT_NOTIFICATION = {
  title: "¡Alerta de Precio!",
  body: "Las gasolineras han cambiado sus precios hoy. Toca para ver.",
};

/**
 * `true` si el registro de histórico más reciente de este favorito difiere
 * del inmediatamente anterior en algún combustible. No hay ningún día
 * "actual" fiable en un Cron Job de servidor (podría correr en un huso
 * horario distinto al del histórico, guardado con fecha local del
 * dispositivo del usuario) — comparar los DOS últimos documentos por orden
 * de id, en vez de asumir que el más reciente es "hoy", evita depender de
 * esa coincidencia de fechas.
 * @param {FirebaseFirestore.DocumentReference} favoriteRef Referencia al
 *   documento `users/{uid}/favorites/{favoriteId}`.
 * @return {Promise<boolean>} `true` si hay cambio de precio reciente.
 */
async function favoriteHasRecentPriceChange(
  favoriteRef: FirebaseFirestore.DocumentReference,
): Promise<boolean> {
  const historySnap = await favoriteRef
    .collection("history")
    .orderBy(admin.firestore.FieldPath.documentId(), "desc")
    .limit(2)
    .get();

  if (historySnap.size < 2) {
    // Sin al menos dos días de histórico no hay nada que comparar.
    return false;
  }

  const [latest, previous] = historySnap.docs.map(
    (doc) => doc.data() as PriceHistoryDoc,
  );

  return FUEL_TYPES.some(
    (fuel) => latest.prices[fuel] !== previous.prices[fuel],
  );
}

/**
 * `true` en cuanto encuentra el PRIMER favorito con cambio (no necesita
 * comprobar el resto para decidir si notificar).
 * @param {FirebaseFirestore.DocumentReference} userRef Referencia al
 *   documento `users/{uid}`.
 * @return {Promise<boolean>} `true` si algún favorito cambió de precio.
 */
async function userHasAnyFavoritePriceChange(
  userRef: FirebaseFirestore.DocumentReference,
): Promise<boolean> {
  const favoritesSnap = await userRef.collection("favorites").get();

  for (const favoriteDoc of favoritesSnap.docs) {
    if (await favoriteHasRecentPriceChange(favoriteDoc.ref)) {
      return true;
    }
  }

  return false;
}

/**
 * Cron diario (08:00 Europe/Madrid, `[[12-push-notifications]]`): recorre los
 * usuarios con `fcmToken` registrado y notifica a quienes tengan al menos un
 * favorito con cambio de precio reciente. Mensaje genérico (no dice QUÉ
 * gasolinera cambió) a propósito: personalizar el cuerpo por usuario
 * multiplicaría las llamadas a `sendEachForMulticast` (una por usuario en vez
 * de una por lote de hasta 500) sin necesidad real para el caso de uso
 * personal/familiar de la app (`CLAUDE.md`) — el usuario ya ve el detalle al
 * abrir la app.
 */
export const checkPricesAndNotify = onSchedule(
  {schedule: "0 8 * * *", timeZone: "Europe/Madrid"},
  async () => {
    const usersSnap = await firestore
      .collection("users")
      .where("fcmToken", "!=", null)
      .get();

    if (usersSnap.empty) {
      logger.info(
        "checkPricesAndNotify: ningún usuario con fcmToken registrado.",
      );
      return;
    }

    const tokensToNotify: string[] = [];

    for (const userDoc of usersSnap.docs) {
      const fcmToken = userDoc.data()["fcmToken"] as string | undefined;
      if (!fcmToken) continue;

      if (await userHasAnyFavoritePriceChange(userDoc.ref)) {
        tokensToNotify.push(fcmToken);
      }
    }

    if (tokensToNotify.length === 0) {
      logger.info(
        "checkPricesAndNotify: sin cambios de precio en favoritos, " +
          "no se envía nada.",
      );
      return;
    }

    // sendEachForMulticast admite hasta 500 tokens por llamada — se trocea
    // por si el número de usuarios llegara a superarlo (hoy, muy lejos).
    const MAX_TOKENS_PER_BATCH = 500;
    for (let i = 0; i < tokensToNotify.length; i += MAX_TOKENS_PER_BATCH) {
      const batch = tokensToNotify.slice(i, i + MAX_TOKENS_PER_BATCH);
      const response = await messaging.sendEachForMulticast({
        tokens: batch,
        notification: PRICE_ALERT_NOTIFICATION,
      });
      logger.info(
        `checkPricesAndNotify: ${response.successCount}/${batch.length} ` +
          "notificaciones enviadas.",
      );
    }
  },
);
