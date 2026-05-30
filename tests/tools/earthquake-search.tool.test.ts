/**
 * @fileoverview Tests for the earthquake-search tool.
 * @module tests/tools/earthquake-search.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { earthquakeSearch } from '@/mcp-server/tools/definitions/earthquake-search.tool.js';
import type { EarthquakeEventOutput } from '@/mcp-server/tools/schemas.js';
import * as emscModule from '@/services/emsc/emsc-service.js';
import * as usgsModule from '@/services/usgs/usgs-service.js';

const sampleEvent: EarthquakeEventOutput = {
  id: 'us6000sznj',
  title: 'M 5.8 - 50 km W of Tokyo, Japan',
  magnitude: 5.8,
  magnitude_type: 'mww',
  time: '2026-05-01T08:00:00.000Z',
  updated: '2026-05-01T08:30:00.000Z',
  place: '50 km W of Tokyo, Japan',
  latitude: 35.6762,
  longitude: 139.6503,
  depth_km: 35,
  felt: 50,
  cdi: 4.1,
  mmi: 4.8,
  alert: 'green',
  tsunami: 0,
  significance: 540,
  status: 'reviewed',
  event_url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000sznj',
};

const emscEvent: EarthquakeEventOutput = {
  id: 'emsc-2026-xyz',
  title: 'M 4.2 - TURKEY',
  magnitude: 4.2,
  magnitude_type: 'ml',
  time: '2026-05-01T06:00:00.000Z',
  updated: '2026-05-01T06:10:00.000Z',
  place: 'TURKEY',
  latitude: 39.0,
  longitude: 35.0,
  depth_km: 12,
  felt: null,
  cdi: null,
  mmi: null,
  alert: null,
  tsunami: 0,
  significance: null,
  status: 'reviewed',
};

describe('earthquakeSearch', () => {
  let mockUsgsSearch: ReturnType<typeof vi.fn>;
  let mockEmscSearch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockUsgsSearch = vi.fn();
    mockEmscSearch = vi.fn();
    vi.spyOn(usgsModule, 'getUsgsService').mockReturnValue({
      searchEvents: mockUsgsSearch,
    } as unknown as usgsModule.UsgsService);
    vi.spyOn(emscModule, 'getEmscService').mockReturnValue({
      searchEvents: mockEmscSearch,
    } as unknown as emscModule.EmscService);
  });

  it('searches USGS by default', async () => {
    mockUsgsSearch.mockResolvedValue({ events: [sampleEvent], count: 1 });

    const ctx = createMockContext();
    const input = earthquakeSearch.input.parse({ min_magnitude: 5.0 });
    const result = await earthquakeSearch.handler(input, ctx);

    expect(result.source).toBe('usgs');
    expect(result.count).toBe(1);
    expect(result.events[0]?.id).toBe('us6000sznj');
    expect(mockUsgsSearch).toHaveBeenCalledOnce();
    expect(mockEmscSearch).not.toHaveBeenCalled();
  });

  it('routes to EMSC when source=emsc', async () => {
    mockEmscSearch.mockResolvedValue({ events: [emscEvent], count: 1 });

    const ctx = createMockContext();
    const input = earthquakeSearch.input.parse({ source: 'emsc', min_magnitude: 3.0 });
    const result = await earthquakeSearch.handler(input, ctx);

    expect(result.source).toBe('emsc');
    expect(result.events[0]?.id).toBe('emsc-2026-xyz');
    expect(mockEmscSearch).toHaveBeenCalledOnce();
    expect(mockUsgsSearch).not.toHaveBeenCalled();
  });

  it('throws invalid_radius when lat/lon provided without radius_km', async () => {
    const ctx = createMockContext({ errors: earthquakeSearch.errors });
    const input = earthquakeSearch.input.parse({ latitude: 35.0, longitude: 139.0 });

    await expect(earthquakeSearch.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'invalid_radius' },
    });
  });

  it('throws invalid_radius when radius_km provided without lat/lon', async () => {
    const ctx = createMockContext({ errors: earthquakeSearch.errors });
    const input = earthquakeSearch.input.parse({ radius_km: 100 });

    await expect(earthquakeSearch.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'invalid_radius' },
    });
  });

  it('accepts complete radius search params', async () => {
    mockUsgsSearch.mockResolvedValue({ events: [], count: 0 });

    const ctx = createMockContext();
    const input = earthquakeSearch.input.parse({
      latitude: 35.0,
      longitude: 139.0,
      radius_km: 100,
    });
    const result = await earthquakeSearch.handler(input, ctx);
    expect(result.count).toBe(0);
  });

  it('populates totalCount enrichment when service returns it', async () => {
    mockUsgsSearch.mockResolvedValue({
      events: [sampleEvent],
      count: 1,
      totalCount: 500,
    });

    const ctx = createMockContext();
    const input = earthquakeSearch.input.parse({ min_magnitude: 5.0 });
    await earthquakeSearch.handler(input, ctx);

    expect(getEnrichment(ctx).totalCount).toBe(500);
  });

  it('omits totalCount enrichment when service does not return it', async () => {
    mockUsgsSearch.mockResolvedValue({ events: [], count: 0 });

    const ctx = createMockContext();
    const input = earthquakeSearch.input.parse({});
    await earthquakeSearch.handler(input, ctx);

    expect(getEnrichment(ctx).totalCount).toBeUndefined();
  });

  it('sets truncated enrichment when count equals limit', async () => {
    // Default limit is 100 from server config, so mock exactly 100 events
    const events = Array.from({ length: 100 }, (_, i) => ({ ...sampleEvent, id: `us${i}` }));
    mockUsgsSearch.mockResolvedValue({ events, count: 100 });

    const ctx = createMockContext();
    const input = earthquakeSearch.input.parse({ limit: 100 });
    await earthquakeSearch.handler(input, ctx);

    expect(getEnrichment(ctx).truncated).toBe(true);
  });

  it('does not set truncated enrichment when count is below limit', async () => {
    mockUsgsSearch.mockResolvedValue({ events: [sampleEvent], count: 1 });

    const ctx = createMockContext();
    const input = earthquakeSearch.input.parse({ limit: 100 });
    await earthquakeSearch.handler(input, ctx);

    expect(getEnrichment(ctx).truncated).toBeUndefined();
  });

  it('populates notice enrichment on empty results', async () => {
    mockUsgsSearch.mockResolvedValue({ events: [], count: 0 });

    const ctx = createMockContext();
    const input = earthquakeSearch.input.parse({ min_magnitude: 8.0 });
    await earthquakeSearch.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string | undefined;
    expect(notice).toBeDefined();
    expect(notice).toContain('No events');
  });

  it('populates notice enrichment when results are truncated', async () => {
    const events = Array.from({ length: 5 }, (_, i) => ({ ...sampleEvent, id: `us${i}` }));
    mockUsgsSearch.mockResolvedValue({ events, count: 5 });

    const ctx = createMockContext();
    const input = earthquakeSearch.input.parse({ limit: 5 });
    await earthquakeSearch.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string | undefined;
    expect(notice).toBeDefined();
    expect(notice).toContain('earthquake_count');
  });

  it('does not populate notice on normal non-empty result', async () => {
    mockUsgsSearch.mockResolvedValue({ events: [sampleEvent], count: 1 });

    const ctx = createMockContext();
    const input = earthquakeSearch.input.parse({ min_magnitude: 5.0 });
    await earthquakeSearch.handler(input, ctx);

    expect(getEnrichment(ctx).notice).toBeUndefined();
  });

  it('propagates service errors', async () => {
    mockUsgsSearch.mockRejectedValue(new Error('USGS down'));

    const ctx = createMockContext({ errors: earthquakeSearch.errors });
    const input = earthquakeSearch.input.parse({ min_magnitude: 5.0 });

    await expect(earthquakeSearch.handler(input, ctx)).rejects.toThrow('USGS down');
  });

  it('formats results with source and count', () => {
    const output = {
      count: 1,
      source: 'usgs' as const,
      events: [sampleEvent],
    };
    const blocks = earthquakeSearch.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('USGS');
    expect(text).toContain('us6000sznj');
    expect(text).toContain('5.8');
    expect(text).toContain('Tokyo');
  });

  it('formats empty results with no-events message', () => {
    const output = { count: 0, source: 'usgs' as const, events: [] };
    const blocks = earthquakeSearch.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('No events');
  });
});
