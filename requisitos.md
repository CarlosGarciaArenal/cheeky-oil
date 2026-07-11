# Especificación de Requisitos del Software (SRS) - Cheeky Oil

## 1. Descripción General
**Cheeky Oil** es una aplicación móvil de uso personal y familiar diseñada para monitorizar, visualizar y predecir los precios de los combustibles (Gasolina 95, 98 y Diesel) en España. El objetivo principal es optimizar el gasto en combustible mediante un mapa interactivo, alertas proactivas y un registro histórico de hasta 10 estaciones clave, todo ello bajo una interfaz minimalista, accesible y sin publicidad.

---

## 2. Requisitos Funcionales (RF)

| ID | Funcionalidad | Descripción |
| :--- | :--- | :--- |
| **RF-01** | **Mapa Base y Localización** | Visualización de un mapa interactivo centrado de forma precisa en la ubicación GPS actual del usuario. |
| **RF-02** | **Capa de Estaciones de Servicio** | Visualización de pines limpios en el mapa indicando las gasolineras. Al interactuar, se mostrará: Marca, Precio (95, 98, Diesel) y distancia estimada. |
| **RF-03** | **Filtros Activos** | Selector rápido para filtrar el mapa por tipo de combustible, mostrando únicamente los precios e información del combustible de interés. |
| **RF-04** | **Sistema de Gasolineras Guardadas** | El usuario podrá guardar un **máximo de 10 gasolineras** en su perfil familiar. Al guardar una estación, esta se destacará visualmente en el mapa y el sistema comenzará a registrar automáticamente su histórico de precios diario, permitiendo visualizar su gráfica de evolución (30 días). |
| **RF-05** | **Radar Inteligente (Cercanía)** | Funcionalidad para escanear un radio configurable (ej. 5km, 15km) y determinar la gasolinera más barata, permitiendo trazar la ruta hacia ella. |
| **RF-06** | **Notificaciones Push y Alertas** | Configuración de avisos automáticos sobre subidas o bajadas de precio en las gasolineras guardadas, o envío de resúmenes programados. |
| **RF-07** | **Sincronización Familiar** | Sistema de cuentas o "grupo familiar" que comparta la misma base de datos de gasolineras guardadas y alertas, sincronizando notificaciones entre los miembros. |
| **RF-08** | **Alertas en Rutas Frecuentes** | Capacidad de configurar trayectos habituales (ej. "Casa-Trabajo") para que el sistema notifique la estación más barata específicamente dentro de esa ruta. |
| **RF-09** | **Semáforo de Repostaje** | Indicador visual algorítmico (Verde = Buen momento para repostar, Ámbar = Esperar si es posible, Rojo = Precio en pico) basado en la media histórica de las gasolineras guardadas. |

---

## 3. Requisitos No Funcionales (RNF)

| ID | Categoría | Descripción |
| :--- | :--- | :--- |
| **RNF-01** | **Tecnología Frontend** | La aplicación se desarrollará utilizando **Angular** junto con **Ionic Framework** para garantizar la compatibilidad móvil (iOS/Android) manteniendo un único código base. |
| **RNF-02** | **Tecnología Backend** | Se utilizarán los servicios de **Google (Firebase)** en su capa gratuita: Firestore/Realtime Database para datos, Cloud Functions para actualizar los precios diarios de las estaciones guardadas mediante la API del MITECO, y Firebase Auth para las cuentas familiares. |
| **RNF-03** | **Interfaz e Intuición** | La UI debe ser intuitiva y minimalista, priorizando la legibilidad de los precios con botones grandes y claros, evitando la sobrecarga visual. |
| **RNF-04** | **Accesibilidad** | La aplicación debe cumplir con estándares básicos de accesibilidad: tamaños de fuente dinámicos, alto contraste y compatibilidad con lectores de pantalla. |
| **RNF-05** | **Modos de Visualización** | El sistema debe incluir un botón accesible para alternar manualmente entre **Modo Claro** y **Modo Oscuro**, además de respetar la preferencia del sistema operativo por defecto. |
| **RNF-06** | **Privacidad y Cumplimiento Legal (GDPR)** | Los datos de ubicación GPS se procesarán estrictamente en el dispositivo. No se cederán datos a terceros. Se incluirá un aviso claro de privacidad, cookies y uso de datos gubernamentales según marca la ley. |
| **RNF-07** | **Seguridad** | Las reglas de seguridad de Firebase (Security Rules) deben bloquear el acceso público, permitiendo solo a los usuarios autenticados del grupo familiar leer y escribir los datos de sus gasolineras guardadas. |