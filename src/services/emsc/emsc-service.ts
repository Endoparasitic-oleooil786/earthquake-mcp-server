/**
 * @fileoverview EMSC (European-Mediterranean Seismological Centre) FDSN event API client.
 * @module services/emsc/emsc-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import {
  fetchWithTimeout,
  httpErrorFromResponse,
  requestContextService,
  withRetry,
} from '@cyanheads/mcp-ts-core/utils';
import type {
  EarthquakeEvent,
  EarthquakeQueryParams,
  EmscCountResponse,
  EmscFeature,
  EmscFeatureCollection,
} from '../usgs/types.js';

/** 1 degree of latitude ≈ 111.2 km. */
const KM_PER_DEGREE = 111.2;

/** Normalize an EMSC GeoJSON feature to the shared EarthquakeEvent domain type. */
function normalizeEmscFeature(f: EmscFeature): EarthquakeEvent {
  const p = f.properties;
  const [lon, lat, depth] = f.geometry.coordinates;

  const id = p.unid ?? f.id ?? `emsc-unknown-${Date.now()}`;
  const place = p.flynn_region ?? 'Unknown location';
  const magType = p.magtype ?? 'unknown';
  const time = p.time ?? new Date(0).toISOString();
  const updated = p.lastupdate ?? time;

  // EMSC: properties.lat/lon may duplicate geometry coordinates; use them when present
  const actualLat = typeof p.lat === 'number' ? p.lat : lat;
  const actualLon = typeof p.lon === 'number' ? p.lon : lon;
  const actualDepth = typeof p.depth === 'number' ? p.depth : depth;

  return {
    id,
    title: `M ${p.mag ?? '?'} - ${place}`,
    magnitude: p.mag ?? 0,
    magnitude_type: magType,
    time,
    updated,
    place,
    latitude: actualLat,
    longitude: actualLon,
    depth_km: actualDepth,
    // EMSC does not provide USGS-specific impact fields
    felt: null,
    cdi: null,
    mmi: null,
    alert: null,
    tsunami: 0,
    significance: null,
    status: 'reviewed', // EMSC events are generally reviewed
  };
}

export class EmscService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    _config: AppConfig,
    _storage: StorageService,
    emscBaseUrl: string,
    timeoutMs: number,
  ) {
    this.baseUrl = emscBaseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  /** Query EMSC FDSN event API. */
  searchEvents(
    params: EarthquakeQueryParams,
    ctx: Context,
  ): Promise<{
    events: EarthquakeEvent[];
    count: number;
    totalCount?: number;
  }> {
    const query = this.buildFdsnQuery(params);
    const url = `${this.baseUrl}/fdsnws/event/1/query?format=json&${query}`;
    const reqCtx = requestContextService.createRequestContext({
      operation: 'EmscService.searchEvents',
      parentContext: {
        requestId: ctx.requestId,
        traceId: ctx.traceId,
        tenantId: ctx.tenantId,
        timestamp: new Date().toISOString(),
      },
    });

    return withRetry(
      async () => {
        const response = await fetchWithTimeout(url, this.timeoutMs, reqCtx, {
          signal: ctx.signal,
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) {
          throw await httpErrorFromResponse(response, { service: 'EMSC FDSN', data: { url } });
        }

        const text = await response.text();
        if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
          throw serviceUnavailable('EMSC returned HTML instead of JSON.', { url });
        }

        const data = JSON.parse(text) as EmscFeatureCollection;
        const events = data.features.map(normalizeEmscFeature);

        return {
          events,
          count: events.length,
        };
      },
      {
        operation: 'EmscService.searchEvents',
        context: reqCtx,
        baseDelayMs: 1000,
        signal: ctx.signal,
      },
    );
  }

  /** Count events matching a query. */
  countEvents(
    params: EarthquakeQueryParams,
    ctx: Context,
  ): Promise<{
    count: number;
    maxAllowed: number | null;
    exceedsLimit: boolean;
  }> {
    const query = this.buildFdsnQuery(params);
    const url = `${this.baseUrl}/fdsnws/event/1/count?format=json&${query}`;
    const reqCtx = requestContextService.createRequestContext({
      operation: 'EmscService.countEvents',
      parentContext: {
        requestId: ctx.requestId,
        traceId: ctx.traceId,
        tenantId: ctx.tenantId,
        timestamp: new Date().toISOString(),
      },
    });

    return withRetry(
      async () => {
        const response = await fetchWithTimeout(url, this.timeoutMs, reqCtx, {
          signal: ctx.signal,
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) {
          throw await httpErrorFromResponse(response, { service: 'EMSC Count', data: { url } });
        }

        const text = await response.text();
        if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
          throw serviceUnavailable('EMSC returned HTML instead of JSON.', { url });
        }

        const data = JSON.parse(text) as EmscCountResponse;
        const EMSC_LIMIT = 20000;
        return {
          count: data.count,
          maxAllowed: null, // EMSC count endpoint does not return maxAllowed
          exceedsLimit: data.count > EMSC_LIMIT,
        };
      },
      {
        operation: 'EmscService.countEvents',
        context: reqCtx,
        baseDelayMs: 1000,
        signal: ctx.signal,
      },
    );
  }

  /** Build FDSN query string from params, converting km radius to degrees for EMSC. */
  private buildFdsnQuery(params: EarthquakeQueryParams): string {
    const q = new URLSearchParams();

    if (params.startTime) q.set('starttime', params.startTime);
    if (params.endTime) q.set('endtime', params.endTime);
    if (params.minMagnitude != null) q.set('minmagnitude', String(params.minMagnitude));
    if (params.maxMagnitude != null) q.set('maxmagnitude', String(params.maxMagnitude));
    if (params.latitude != null) q.set('latitude', String(params.latitude));
    if (params.longitude != null) q.set('longitude', String(params.longitude));
    if (params.radiusKm != null) {
      // EMSC only supports maxradius in degrees — convert from km
      const degrees = params.radiusKm / KM_PER_DEGREE;
      q.set('maxradius', degrees.toFixed(4));
    }
    if (params.minDepthKm != null) q.set('mindepth', String(params.minDepthKm));
    if (params.maxDepthKm != null) q.set('maxdepth', String(params.maxDepthKm));
    // EMSC does not support alertlevel, minfelt, minsig — silently omit
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.orderBy) q.set('orderby', params.orderBy);

    return q.toString();
  }
}

// --- Init/accessor pattern ---

let _service: EmscService | undefined;

export function initEmscService(
  config: AppConfig,
  storage: StorageService,
  emscBaseUrl: string,
  timeoutMs: number,
): void {
  _service = new EmscService(config, storage, emscBaseUrl, timeoutMs);
}

export function getEmscService(): EmscService {
  if (!_service) {
    throw new Error('EmscService not initialized — call initEmscService() in setup()');
  }
  return _service;
}
