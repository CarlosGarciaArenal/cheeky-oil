import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { GasStation, GasStationBrand } from '../models/gas-station.model';

/**
 * Endpoint público y gratuito del Ministerio para la Transición Ecológica (MITECO)
 * con los precios de todas las estaciones terrestres de España. Sin API key,
 * sin cuota, sin coste — en línea con la regla de coste cero del proyecto.
 */
const MITECO_API_URL =
  'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';

/**
 * Forma (parcial) de cada estación tal y como la devuelve la API de MITECO.
 * Solo se tipan los campos que consumimos: la API incluye decenas de campos
 * adicionales (Adblue, Hidrógeno, GLP...) que esta app no necesita todavía.
 * Los nombres de campo son los oficiales de la API (español, con acentos y
 * espacios), verificados contra la respuesta real del endpoint.
 */
interface MitecoEstacionRaw {
  IDEESS: string;
  Rótulo: string;
  Dirección: string;
  Municipio: string;
  Latitud: string;
  'Longitud (WGS84)': string;
  'Precio Gasolina 95 E5': string;
  'Precio Gasolina 98 E5': string;
  'Precio Gasoleo A': string;
}

/** Envoltorio raíz de la respuesta de la API de MITECO. */
interface MitecoRespuesta {
  Fecha: string;
  ListaEESSPrecio: MitecoEstacionRaw[];
  ResultadoConsulta: string;
}

/**
 * Palabras clave (en mayúsculas) para reconocer cada marca dentro del campo
 * libre `Rótulo`, que en la práctica contiene desde el nombre exacto de la
 * marca ("REPSOL") hasta razones sociales completas ("REPSOL. LOS ANGELES DE
 * LA MANCHA, S.L.") o nombres comerciales de terceros ("BP ROMICA").
 * "MOEVE" se incluye en Cepsa por ser el rebranding comercial del grupo Cepsa.
 */
const BRAND_KEYWORDS: ReadonlyArray<readonly [GasStationBrand, readonly string[]]> = [
  ['Repsol', ['REPSOL']],
  ['Cepsa', ['CEPSA', 'MOEVE']],
  ['BP', ['BP']],
  ['Shell', ['SHELL']],
  ['Galp', ['GALP']],
  ['Petronor', ['PETRONOR']],
  ['Petroprix', ['PETROPRIX']],
];

/** Rótulos que son solo un código interno (ej. "Nº 10.935", "13344") en vez de un nombre comercial. */
const ROTULO_SIN_MARCA = /^(N[º°o]?\.?\s*)?\d/;

/**
 * Cliente HTTP de la API pública de precios de carburantes de MITECO.
 * Traduce el formato "administrativo" de la API (campos en español,
 * decimales con coma, sin tipado) al modelo de dominio `GasStation`
 * ([[01-modelos-base]]). No escribe en Firestore: esa sincronización
 * corresponde a una capa posterior (Cloud Function/servicio de guardado).
 */
@Injectable({ providedIn: 'root' })
export class MitecoService {
  private readonly http = inject(HttpClient);

  /**
   * Descarga y mapea todas las estaciones terrestres de España.
   * Las estaciones cuya `Latitud`/`Longitud (WGS84)` no se puedan parsear a
   * un número válido se descartan (no se emiten con `lat`/`lng` a `0`, que
   * sería una coordenada real y falsa en el golfo de Guinea): una estación
   * sin coordenadas fiables no puede participar en el cálculo de "más
   * cercanas" de `MapComponent`. El resto de estaciones no se ve afectado.
   */
  getEstaciones(): Observable<GasStation[]> {
    return this.http.get<MitecoRespuesta>(MITECO_API_URL).pipe(
      map((respuesta) => {
        const actualizadoEn = this.parseFecha(respuesta.Fecha);
        return respuesta.ListaEESSPrecio.map((raw) => this.toGasStation(raw, actualizadoEn)).filter(
          (estacion): estacion is GasStation => estacion !== null,
        );
      }),
    );
  }

  private toGasStation(raw: MitecoEstacionRaw, actualizadoEn: number): GasStation | null {
    const lat = this.parseNumero(raw.Latitud);
    const lng = this.parseNumero(raw['Longitud (WGS84)']);
    if (lat === null || lng === null) {
      return null;
    }

    return {
      id: raw.IDEESS,
      marca: this.toBrand(raw['Rótulo']),
      direccion: raw['Dirección'],
      municipio: raw.Municipio,
      precios: {
        gasolina95: this.parseNumero(raw['Precio Gasolina 95 E5']),
        gasolina98: this.parseNumero(raw['Precio Gasolina 98 E5']),
        diesel: this.parseNumero(raw['Precio Gasoleo A']),
      },
      lat,
      lng,
      actualizadoEn,
    };
  }

  /** Convierte "1,499" / "-3,703790" a 1.499 / -3.70379; "" (sin precio) a null. */
  private parseNumero(valor: string): number | null {
    if (!valor || valor.trim() === '') {
      return null;
    }
    const numero = parseFloat(valor.replace(',', '.'));
    return Number.isNaN(numero) ? null : numero;
  }

  private toBrand(rotulo: string): GasStationBrand {
    const normalizado = (rotulo ?? '').trim().toUpperCase();
    if (!normalizado) {
      return 'Otra';
    }
    for (const [marca, palabrasClave] of BRAND_KEYWORDS) {
      if (palabrasClave.some((palabra) => normalizado.includes(palabra))) {
        return marca;
      }
    }
    return ROTULO_SIN_MARCA.test(normalizado) ? 'Independiente' : 'Otra';
  }

  /** Parsea "Fecha" ("dd/mm/aaaa HH:mm:ss", hora local de España) a epoch ms. */
  private parseFecha(fecha: string): number {
    const match = fecha?.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
    if (!match) {
      return Date.now();
    }
    const [, dd, mm, yyyy, hh, min, ss] = match;
    return new Date(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(min),
      Number(ss),
    ).getTime();
  }
}
