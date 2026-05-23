/**
 * @fileoverview USGS Earthquake Hazards Program API client — real-time feeds and FDSN event queries.
 * @module services/usgs/usgs-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { notFound, serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
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
  UsgsCountResponse,
  UsgsFeature,
  UsgsFeatureCollection,
} from './types.js';

/** Convert a USGS epoch-millisecond timestamp to an ISO 8601 string. */
function epochMsToIso(ms: number | null | undefined): string {
  if (ms == null) return new Date(0).toISOString();
  return new Date(ms).toISOString();
}

/** Normalize a USGS GeoJSON feature to the shared EarthquakeEvent domain type. */
function normalizeUsgsFeature(f: UsgsFeature): EarthquakeEvent {
  const p = f.properties;
  const [lon, lat, depth] = f.geometry.coordinates;

  const rawStatus = p.status ?? 'automatic';
  const status: 'automatic' | 'reviewed' | 'deleted' =
    rawStatus === 'reviewed' || rawStatus === 'deleted' ? rawStatus : 'automatic';

  const rawAlert = p.alert;
  const alert: 'green' | 'yellow' | 'orange' | 'red' | null =
    rawAlert === 'green' || rawAlert === 'yellow' || rawAlert === 'orange' || rawAlert === 'red'
      ? rawAlert
      : null;

  return {
    id: f.id,
    title: p.title ?? `M ${p.mag ?? '?'} - ${p.place ?? 'Unknown location'}`,
    magnitude: p.mag ?? 0,
    magnitude_type: p.magType ?? 'unknown',
    time: epochMsToIso(p.time),
    updated: epochMsToIso(p.updated),
    place: p.place ?? 'Unknown location',
    latitude: lat,
    longitude: lon,
    depth_km: depth,
    felt: p.felt ?? null,
    cdi: p.cdi ?? null,
    mmi: p.mmi ?? null,
    alert,
    tsunami: p.tsunami ?? 0,
    significance: p.sig ?? null,
    status,
    ...(p.url ? { event_url: p.url } : {}),
    ...(p.detail ? { detail_url: p.detail } : {}),
  };
}

export class UsgsService {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    _config: AppConfig,
    _storage: StorageService,
    usgsBaseUrl: string,
    timeoutMs: number,
  ) {
    this.baseUrl = usgsBaseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  /** Fetch a pre-computed USGS real-time feed. */
  async getFeed(
    magnitudeTier: 'all' | '1.0' | '2.5' | '4.5' | 'significant',
    timeWindow: 'hour' | 'day' | 'week' | 'month',
    ctx: Context,
  ): Promise<{ events: EarthquakeEvent[]; generatedAt: string; count: number; feedUrl: string }> {
    const feedUrl = `${this.baseUrl}/earthquakes/feed/v1.0/summary/${magnitudeTier}_${timeWindow}.geojson`;
    const reqCtx = requestContextService.createRequestContext({
      operation: 'UsgsService.getFeed',
      parentContext: {
        requestId: ctx.requestId,
        traceId: ctx.traceId,
        tenantId: ctx.tenantId,
        timestamp: new Date().toISOString(),
      },
    });

    return withRetry(
      async () => {
        const response = await fetchWithTimeout(feedUrl, this.timeoutMs, reqCtx, {
          signal: ctx.signal,
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) {
          throw await httpErrorFromResponse(response, {
            service: 'USGS Feed',
            data: { feedUrl },
          });
        }

        const text = await response.text();
        if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
          throw serviceUnavailable(
            'USGS returned HTML instead of GeoJSON — likely rate-limited or a CDN error.',
            { feedUrl },
          );
        }

        const data = JSON.parse(text) as UsgsFeatureCollection;
        const events = data.features.map(normalizeUsgsFeature);

        return {
          events,
          generatedAt: epochMsToIso(data.metadata.generated),
          count: data.metadata.count,
          feedUrl: data.metadata.url ?? feedUrl,
        };
      },
      {
        operation: 'UsgsService.getFeed',
        context: reqCtx,
        baseDelayMs: 1000,
        signal: ctx.signal,
      },
    );
  }

  /** Query USGS FDSN event API. */
  async searchEvents(
    params: EarthquakeQueryParams,
    ctx: Context,
  ): Promise<{
    events: EarthquakeEvent[];
    count: number;
    totalCount?: number;
  }> {
    const query = this.buildFdsnQuery(params);
    const url = `${this.baseUrl}/fdsnws/event/1/query?format=geojson&${query}`;
    const reqCtx = requestContextService.createRequestContext({
      operation: 'UsgsService.searchEvents',
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

        if (response.status === 400) {
          // USGS returns plain-text "Error 400: ..." for overly broad queries
          const body = await response.text();
          const broadMatch = /(\d+) matching events exceeds search limit/.exec(body);
          if (broadMatch?.[1]) {
            const totalCount = parseInt(broadMatch[1], 10);
            throw Object.assign(
              new Error(
                `Query matches ${totalCount} events, exceeding the 20,000-event limit. ` +
                  'Narrow time range, raise min_magnitude, or add location filters.',
              ),
              { code: -32602, data: { reason: 'query_too_broad', totalCount } },
            );
          }
          throw await httpErrorFromResponse(response, { service: 'USGS FDSN' });
        }

        if (!response.ok) {
          throw await httpErrorFromResponse(response, { service: 'USGS FDSN', data: { url } });
        }

        const text = await response.text();
        if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
          throw serviceUnavailable('USGS returned HTML instead of GeoJSON.', { url });
        }

        const data = JSON.parse(text) as UsgsFeatureCollection;
        const events = data.features.map(normalizeUsgsFeature);
        const requestedLimit = params.limit ?? 100;

        return {
          events,
          count: events.length,
          ...(data.metadata.count > requestedLimit ? { totalCount: data.metadata.count } : {}),
        };
      },
      {
        operation: 'UsgsService.searchEvents',
        context: reqCtx,
        baseDelayMs: 1000,
        signal: ctx.signal,
      },
    );
  }

  /** Fetch a single event by USGS event ID. */
  async getEvent(eventId: string, ctx: Context): Promise<EarthquakeEvent> {
    const url = `${this.baseUrl}/fdsnws/event/1/query?eventid=${encodeURIComponent(eventId)}&format=geojson`;
    const reqCtx = requestContextService.createRequestContext({
      operation: 'UsgsService.getEvent',
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

        if (response.status === 404) {
          throw notFound(
            `No earthquake event found for ID "${eventId}". Verify the ID from a feed or search result.`,
            { eventId },
          );
        }

        if (!response.ok) {
          // USGS sometimes returns 400 with "Error 404" body for unknown IDs
          const body = await response.text();
          if (/Error 404/i.test(body)) {
            throw notFound(
              `No earthquake event found for ID "${eventId}". Verify the ID from a feed or search result.`,
              { eventId },
            );
          }
          throw serviceUnavailable(`USGS returned HTTP ${response.status} for event lookup.`, {
            eventId,
            status: response.status,
          });
        }

        const text = await response.text();
        if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
          throw serviceUnavailable('USGS returned HTML instead of GeoJSON.', { eventId });
        }

        const data = JSON.parse(text) as UsgsFeatureCollection;
        if (!data.features || data.features.length === 0) {
          throw notFound(
            `No earthquake event found for ID "${eventId}". Verify the ID from a feed or search result.`,
            { eventId },
          );
        }

        const feature = data.features[0];
        if (!feature) {
          throw notFound(`No event data returned for ID "${eventId}".`, { eventId });
        }
        return normalizeUsgsFeature(feature);
      },
      {
        operation: 'UsgsService.getEvent',
        context: reqCtx,
        baseDelayMs: 1000,
        signal: ctx.signal,
      },
    );
  }

  /** Count events matching a query. */
  async countEvents(
    params: EarthquakeQueryParams,
    ctx: Context,
  ): Promise<{
    count: number;
    maxAllowed: number | null;
    exceedsLimit: boolean;
  }> {
    const query = this.buildFdsnQuery(params);
    const url = `${this.baseUrl}/fdsnws/event/1/count?format=geojson&${query}`;
    const reqCtx = requestContextService.createRequestContext({
      operation: 'UsgsService.countEvents',
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
          throw await httpErrorFromResponse(response, {
            service: 'USGS Count',
            data: { url },
          });
        }

        const text = await response.text();
        if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
          throw serviceUnavailable('USGS returned HTML instead of JSON.', { url });
        }

        const data = JSON.parse(text) as UsgsCountResponse;
        const maxAllowed = data.maxAllowed ?? 20000;
        return {
          count: data.count,
          maxAllowed,
          exceedsLimit: data.count > maxAllowed,
        };
      },
      {
        operation: 'UsgsService.countEvents',
        context: reqCtx,
        baseDelayMs: 1000,
        signal: ctx.signal,
      },
    );
  }

  /** Build FDSN query string from params. */
  private buildFdsnQuery(params: EarthquakeQueryParams): string {
    const q = new URLSearchParams();

    if (params.startTime) q.set('starttime', params.startTime);
    if (params.endTime) q.set('endtime', params.endTime);
    if (params.minMagnitude != null) q.set('minmagnitude', String(params.minMagnitude));
    if (params.maxMagnitude != null) q.set('maxmagnitude', String(params.maxMagnitude));
    if (params.latitude != null) q.set('latitude', String(params.latitude));
    if (params.longitude != null) q.set('longitude', String(params.longitude));
    if (params.radiusKm != null) q.set('maxradiuskm', String(params.radiusKm));
    if (params.minDepthKm != null) q.set('mindepth', String(params.minDepthKm));
    if (params.maxDepthKm != null) q.set('maxdepth', String(params.maxDepthKm));
    if (params.alertLevel) q.set('alertlevel', params.alertLevel);
    if (params.minFelt != null) q.set('minfelt', String(params.minFelt));
    if (params.minSignificance != null) q.set('minsig', String(params.minSignificance));
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.orderBy) q.set('orderby', params.orderBy);

    return q.toString();
  }
}

// --- Init/accessor pattern ---

let _service: UsgsService | undefined;

export function initUsgsService(
  config: AppConfig,
  storage: StorageService,
  usgsBaseUrl: string,
  timeoutMs: number,
): void {
  _service = new UsgsService(config, storage, usgsBaseUrl, timeoutMs);
}

export function getUsgsService(): UsgsService {
  if (!_service) {
    throw new Error('UsgsService not initialized — call initUsgsService() in setup()');
  }
  return _service;
}
