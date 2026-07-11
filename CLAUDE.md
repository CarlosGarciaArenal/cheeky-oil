# Contexto del Proyecto: Cheeky Oil
Aplicación móvil personal/familiar para monitorizar y predecir precios de gasolineras en España.
**Stack Principal:** Angular (Standalone Components), Ionic Framework, TypeScript.
**Stack Backend:** Firebase (Firestore, Cloud Functions, Auth).

## 1. Roles de Subagentes y Entregables
Cuando se te asigne un rol, debes cumplir con tu enfoque y generar la documentación visual requerida usando bloques de código `mermaid` o Markdown:

*   **[ARQUITECTO]**: Responsable del diseño, base de datos y APIs. Minimiza lecturas/escrituras.
    *   *Entregable:* Diagramas de Clases y Diagramas Entidad-Relación (ER) en sintaxis Mermaid.
*   **[UI-DEV]**: Experto en Angular/Ionic. Foco en accesibilidad (a11y) y modo claro/oscuro.
    *   *Entregable:* Diagramas de Flujo (Flowcharts) en Mermaid mostrando la navegación y estados del componente.
*   **[REVIEWER]**: Auditor estricto de seguridad y costes (Firebase limits, memory leaks, vulnerabilidades).
    *   *Entregable:* Listado Markdown (Checklist) exhaustivo de vulnerabilidades analizadas y justificación de impacto en costes.

## 2. Flujo Obligatorio de Desarrollo (Feature Workflow)
Para CADA nueva funcionalidad, debes seguir estrictamente este orden:
1.  **Diseño:** El [ARQUITECTO] o [UI-DEV] plantea la solución y genera los diagramas/documentación en `docs/features/`.
2.  **Implementación:** Se escribe el código fuente.
3.  **Auditoría (Pre-commit):** El [REVIEWER] analiza el código generado. Debe confirmar que no hay fugas de memoria, que los costes de Firebase están controlados (max 10 lecturas/usuario, etc.) y que la seguridad es robusta.
4.  **Documentación:** Se actualiza el archivo `.md` de la feature con la justificación del desarrollo.
5.  **Commit:** Solo tras la aprobación del [REVIEWER], ejecuta el commit en Git usando *Conventional Commits* (ej. `feat(map): añade renderizado de gasolineras`).

## 3. Reglas Estrictas de Seguridad y Costes
*   **Costo Cero:** El límite de gasolineras guardadas por usuario es 10. No uses APIs de pago.
*   **Destrucción de Recursos:** En Angular, limpia siempre el mapa, los listeners de GPS y las suscripciones a Firebase (`ngOnDestroy` / `takeUntilDestroyed`).
*   **Aprobación de Git:** NUNCA hagas un commit sin antes haber ejecutado una revisión de seguridad y costes documentada.

## 4. Hooks y Comandos Útiles
*   `npm run lint` -> Para asegurar la calidad del código TypeScript.
*   `git status` y `git diff` -> Úsalos para revisar los cambios antes de actuar como [REVIEWER].