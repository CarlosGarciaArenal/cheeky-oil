# Política de Privacidad de Cheeky Oil

> ⚠️ **Nota de alcance (léase antes de publicar):** este documento es una plantilla redactada conforme a los principios del Reglamento General de Protección de Datos (RGPD/GDPR) y a los requisitos habituales de Apple App Store y Google Play, elaborada a partir de un análisis técnico real del código de la app (qué datos se recogen, a qué servicios se envían y por qué). **No sustituye el asesoramiento de un abogado especializado en protección de datos.** Antes de publicar la app, revisa especialmente los campos marcados como `[COMPLETAR]` y confirma con un profesional que el documento se ajusta a tu situación concreta (por ejemplo, si en algún momento monetizas la app, añades publicidad, o cambias de proveedor de backend).

**Última actualización:** 18 de julio de 2026

## 1. Responsable del tratamiento

- **Aplicación:** Cheeky Oil (app móvil personal/familiar de comparación y seguimiento de precios de combustible en España).
- **Responsable:** Carlos García Arenal
- **Contacto para cuestiones de privacidad:** cgarciaarenal@gmail.com

Cheeky Oil es una aplicación de uso personal y familiar, sin finalidad comercial ni publicitaria. Esta política describe qué datos personales trata la app, con qué finalidad, con quién se comparten y qué derechos tienes sobre ellos.

## 2. Qué datos tratamos

| Dato | Origen | Finalidad | ¿Dónde se almacena? |
|---|---|---|---|
| Email y contraseña | Introducidos por ti al registrarte | Autenticación de tu cuenta | Firebase Authentication (Google Cloud) |
| Gasolineras guardadas como favoritas (marca, dirección, municipio, coordenadas de la estación, fecha de guardado) | Elegidas por ti en la app | Mostrarte tus gasolineras favoritas y su precio | Firestore (Firebase, Google Cloud), en tu propia cuenta |
| Histórico diario de precios de tus favoritas | Calculado automáticamente a partir de datos públicos del Ministerio para la Transición Ecológica (MITECO) | Mostrarte la evolución del precio y el "semáforo de repostaje" | Firestore (Firebase, Google Cloud), en tu propia cuenta |
| Ubicación GPS de tu dispositivo | Sensor de localización de tu móvil (con tu permiso explícito) | Calcular la distancia a las gasolineras cercanas y centrar el mapa; calcular una ruta cuando usas el planificador | Ver sección 3 — **no se almacena en ningún servidor de Cheeky Oil** |
| Texto de búsqueda de direcciones (planificador de rutas) | Introducido por ti | Encontrar las coordenadas del lugar que buscas | Ver sección 3 (servicio externo, no almacenado por Cheeky Oil) |

Cheeky Oil **no recoge** datos de pago, contactos, fotos, identificadores publicitarios ni ningún dato biométrico. La app no muestra publicidad ni realiza seguimiento con fines comerciales o de perfilado.

## 3. Tratamiento de la ubicación GPS

Este es el punto que más nos importa dejar claro, porque tiene dos escenarios distintos dentro de la propia app:

- **Mapa principal ("gasolineras cerca de mí"):** tu ubicación se lee del sensor GPS de tu dispositivo y **se procesa enteramente en local, dentro de la propia app** (cálculo de distancia por la fórmula del haversine). Esta ubicación **no se envía a ningún servidor de Cheeky Oil, no se guarda en Firebase ni en ningún otro sitio**: se usa en el momento, en memoria, y desaparece al cerrar la app.
- **Planificador de rutas:** si utilizas esta función, el origen y destino que elijas (que puede incluir tu ubicación actual) se envían, en el momento del cálculo, a dos servicios públicos externos de código abierto para poder dibujar la ruta y encontrar direcciones:
  - **OSRM** (Open Source Routing Machine, `router.project-osrm.org`) — calcula la ruta entre dos puntos.
  - **Nominatim / OpenStreetMap** (`nominatim.openstreetmap.org`) — convierte una dirección en texto a coordenadas.

  Estos dos servicios son infraestructuras públicas y gratuitas de **OpenStreetMap Foundation**, independientes de Cheeky Oil. Reciben la consulta puntual necesaria para calcular la ruta o la dirección solicitada, mediante una petición sin identificar (no se envía tu email ni ningún identificador de tu cuenta), y **Cheeky Oil no almacena ni conserva copia de esas peticiones**. Estos servicios cuentan con sus propias políticas de privacidad como operadores independientes.
  - Además, el propio mapa (teselas visuales) se sirve desde los servidores de OpenStreetMap, lo que implica que tu dispositivo se conecta directamente a ellos para descargar las imágenes del mapa que estás viendo — igual que ocurre con cualquier mapa web o app de navegación.

En resumen: **tu ubicación GPS nunca se sube a un servidor propio de Cheeky Oil ni se guarda asociada a tu cuenta.** Cuando usas el planificador de rutas, las coordenadas que elijas se comparten de forma puntual con los servicios públicos de OpenStreetMap/OSRM estrictamente para realizar ese cálculo, sin quedar vinculadas a tu identidad.

## 4. Datos de autenticación y favoritos: Firebase (Google Cloud)

Tu email, tu contraseña (gestionada de forma segura por Firebase Authentication — Cheeky Oil nunca ve ni almacena tu contraseña en texto plano), tus gasolineras favoritas y su histórico de precios se almacenan en **Firebase**, la plataforma de backend de **Google Cloud Platform**, propiedad de Google Ireland Limited/Google LLC.

- El acceso a estos datos está restringido mediante reglas de seguridad de Firestore: **solo tú, autenticado con tu propia cuenta, puedes leer o modificar tus propios datos** — ni otros usuarios de la app ni terceros pueden acceder a tu información.
- Google actúa como **encargado del tratamiento** de estos datos por cuenta del responsable de la app, conforme a los términos de servicio de Firebase/Google Cloud, que incluyen las garantías necesarias para transferencias internacionales de datos (cláusulas contractuales tipo de la UE / marco de adecuación aplicable).
- `[COMPLETAR: confirma y especifica aquí la región de Google Cloud en la que está configurado el proyecto de Firebase — por ejemplo "europe-west1 (Bélgica)" — para que quede documentada la ubicación exacta de almacenamiento. Si el proyecto usa una región fuera del Espacio Económico Europeo, indícalo explícitamente aquí.]`

## 5. Datos públicos de terceros (MITECO)

Los precios de combustible que muestra la app provienen de la API pública y gratuita del **Ministerio para la Transición Ecológica y el Reto Demográfico (MITECO)**, que publica precios de gasolineras de toda España como datos abiertos. Esta consulta es de solo lectura, no requiere identificarte, y no se te asocia ningún dato personal en ella — Cheeky Oil solo descarga y muestra esta información pública, no la modifica ni contribuye datos propios a MITECO.

## 6. Base legal del tratamiento

- **Ejecución de una relación de uso del servicio** (art. 6.1.b RGPD): para poder ofrecerte tu cuenta, tus favoritos y el histórico de precios.
- **Consentimiento explícito** (art. 6.1.a RGPD): para el acceso a tu ubicación GPS, que tu dispositivo te pide de forma expresa y que puedes revocar en cualquier momento desde los ajustes de tu sistema operativo, sin que ello impida usar el resto de la app (solo dejarás de ver la distancia a las gasolineras cercanas).

## 7. Conservación de los datos

Tus datos de cuenta, favoritos e histórico se conservan mientras tu cuenta permanezca activa. El histórico de precios de una gasolinera favorita se conserva mientras esa gasolinera siga guardada como favorita. Al eliminar tu cuenta (ver sección 9), todos estos datos se eliminan.

## 8. Tus derechos

Como usuario, tienes derecho a:

- **Acceder** a los datos personales que tratamos sobre ti.
- **Rectificar** datos inexactos.
- **Suprimir** tus datos ("derecho al olvido") — ver sección 9 sobre cómo eliminar tu cuenta.
- **Limitar** u **oponerte** al tratamiento en determinadas circunstancias.
- **Portabilidad**: solicitar tus datos en un formato estructurado y de uso común.
- **Retirar tu consentimiento** en cualquier momento (por ejemplo, revocando el permiso de ubicación), sin que ello afecte a la licitud del tratamiento previo.

Para ejercer cualquiera de estos derechos, escribe a cgarciaarenal@gmail.com. Responderemos en el plazo máximo de un mes, conforme al artículo 12.3 del RGPD.

Si consideras que el tratamiento de tus datos no se ajusta a la normativa, tienes derecho a **presentar una reclamación ante la Agencia Española de Protección de Datos (AEPD)** — [www.aepd.es](https://www.aepd.es) — o ante la autoridad de control de tu país de residencia si resides en otro Estado miembro de la UE.

## 9. Eliminación de tu cuenta y tus datos

Puedes solicitar la eliminación completa de tu cuenta y de todos los datos asociados (email, favoritos, histórico de precios) escribiendo a cgarciaarenal@gmail.com desde el email asociado a tu cuenta. Procesaremos la solicitud y eliminaremos tus datos de forma permanente en un plazo máximo de 30 días.

> **Nota interna, no parte del texto legal publicado:** en el momento de escribir este documento, la app **no dispone todavía de una opción de autoservicio "Eliminar mi cuenta" dentro de la propia interfaz** — el borrado se gestiona hoy manualmente, bajo petición, por quien administra el proyecto. Esto es compatible con el RGPD (que no exige que el borrado sea instantáneo ni self-service, solo que se atienda en un plazo razonable), **pero Apple App Store exige explícitamente** (App Store Review Guideline 5.1.1(v)) que cualquier app que permita crear una cuenta también ofrezca una forma de eliminarla **dentro de la propia app**, no solo por contacto externo. Si el destino de publicación incluye Apple App Store, hay que añadir esa función a la app antes de enviarla a revisión — Google Play es, en este aspecto concreto, menos estricto (permite un proceso externo siempre que esté enlazado y documentado), pero también recomienda el autoservicio.

## 10. Seguridad

Aplicamos medidas técnicas razonables para proteger tus datos: autenticación gestionada por Firebase Authentication, reglas de seguridad de Firestore que restringen el acceso a cada usuario a sus propios datos, y cifrado en tránsito (HTTPS/TLS) en todas las comunicaciones con Firebase y con los servicios externos mencionados en esta política.

## 11. Menores de edad

Cheeky Oil es una aplicación de uso personal/familiar no dirigida específicamente a menores de edad. Si eres el titular de una cuenta familiar y un menor de tu unidad familiar usa la app, la responsabilidad de supervisión corresponde al titular de la cuenta.

## 12. Cambios en esta política

Podemos actualizar esta política de privacidad para reflejar cambios en la app o en la normativa aplicable. Si se realizan cambios significativos, se indicará la nueva fecha de "última actualización" en la cabecera de este documento.

## 13. Contacto

Para cualquier duda sobre esta política de privacidad o sobre el tratamiento de tus datos: cgarciaarenal@gmail.com.
