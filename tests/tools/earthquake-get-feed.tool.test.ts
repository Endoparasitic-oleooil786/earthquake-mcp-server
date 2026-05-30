/**
 * @fileoverview Tests for the earthquake-get-feed tool.
 * @module tests/tools/earthquake-get-feed.tool.test
 */

import { createMockContext, getEnrichment } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { earthquakeGetFeed } from '@/mcp-server/tools/definitions/earthquake-get-feed.tool.js';
import type { EarthquakeEventOutput } from '@/mcp-server/tools/schemas.js';
import * as usgsModule from '@/services/usgs/usgs-service.js';

const sampleEvent: EarthquakeEventOutput = {
  id: 'us6000sznj',
  title: 'M 6.2 - 10 km NE of Anchorage, Alaska',
  magnitude: 6.2,
  magnitude_type: 'mww',
  time: '2026-05-01T12:00:00.000Z',
  updated: '2026-05-01T12:30:00.000Z',
  place: '10 km NE of Anchorage, Alaska',
  latitude: 61.2181,
  longitude: -149.9003,
  depth_km: 40,
  felt: 120,
  cdi: 5.2,
  mmi: 6.1,
  alert: 'yellow',
  tsunami: 0,
  significance: 820,
  status: 'reviewed',
  event_url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000sznj',
  detail_url: 'https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=us6000sznj&format=geojson',
};

const sparseEvent: EarthquakeEventOutput = {
  id: 'us0000abc1',
  title: 'M 2.5 - Unknown location',
  magnitude: 2.5,
  magnitude_type: 'ml',
  time: '2026-05-02T00:00:00.000Z',
  updated: '2026-05-02T00:05:00.000Z',
  place: 'Unknown location',
  latitude: 0,
  longitude: 0,
  depth_km: 10,
  felt: null,
  cdi: null,
  mmi: null,
  alert: null,
  tsunami: 0,
  significance: null,
  status: 'automatic',
};

describe('earthquakeGetFeed', () => {
  let mockGetFeed: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetFeed = vi.fn();
    vi.spyOn(usgsModule, 'getUsgsService').mockReturnValue({
      getFeed: mockGetFeed,
    } as unknown as usgsModule.UsgsService);
  });

  it('returns feed data for valid input', async () => {
    mockGetFeed.mockResolvedValue({
      events: [sampleEvent],
      generatedAt: '2026-05-23T10:00:00.000Z',
      count: 1,
      feedUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
    });

    const ctx = createMockContext();
    const input = earthquakeGetFeed.input.parse({ magnitude_tier: '2.5', time_window: 'day' });
    const result = await earthquakeGetFeed.handler(input, ctx);

    expect(result.count).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.id).toBe('us6000sznj');
    expect(result.generated_at).toBe('2026-05-23T10:00:00.000Z');
    expect(result.feed_url).toContain('usgs.gov');
  });

  it('applies defaults for magnitude_tier and time_window', async () => {
    mockGetFeed.mockResolvedValue({
      events: [],
      generatedAt: '2026-05-23T10:00:00.000Z',
      count: 0,
      feedUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
    });

    const ctx = createMockContext();
    const input = earthquakeGetFeed.input.parse({});
    const result = await earthquakeGetFeed.handler(input, ctx);

    expect(input.magnitude_tier).toBe('2.5');
    expect(input.time_window).toBe('day');
    expect(result.count).toBe(0);
    expect(mockGetFeed).toHaveBeenCalledWith('2.5', 'day', ctx);
  });

  it('handles empty feed gracefully', async () => {
    mockGetFeed.mockResolvedValue({
      events: [],
      generatedAt: '2026-05-23T10:00:00.000Z',
      count: 0,
      feedUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_hour.geojson',
    });

    const ctx = createMockContext();
    const input = earthquakeGetFeed.input.parse({
      magnitude_tier: 'significant',
      time_window: 'hour',
    });
    const result = await earthquakeGetFeed.handler(input, ctx);

    expect(result.count).toBe(0);
    expect(result.events).toHaveLength(0);
  });

  it('populates notice enrichment when feed is empty', async () => {
    mockGetFeed.mockResolvedValue({
      events: [],
      generatedAt: '2026-05-23T10:00:00.000Z',
      count: 0,
      feedUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_hour.geojson',
    });

    const ctx = createMockContext();
    const input = earthquakeGetFeed.input.parse({
      magnitude_tier: 'significant',
      time_window: 'hour',
    });
    await earthquakeGetFeed.handler(input, ctx);

    const notice = getEnrichment(ctx).notice as string | undefined;
    expect(notice).toBeDefined();
    expect(notice).toContain('significant/hour');
  });

  it('does not populate notice enrichment when feed has events', async () => {
    mockGetFeed.mockResolvedValue({
      events: [sampleEvent],
      generatedAt: '2026-05-23T10:00:00.000Z',
      count: 1,
      feedUrl: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
    });

    const ctx = createMockContext();
    const input = earthquakeGetFeed.input.parse({ magnitude_tier: '2.5', time_window: 'day' });
    await earthquakeGetFeed.handler(input, ctx);

    expect(getEnrichment(ctx).notice).toBeUndefined();
  });

  it('propagates service errors', async () => {
    mockGetFeed.mockRejectedValue(new Error('Service unavailable'));

    const ctx = createMockContext({ errors: earthquakeGetFeed.errors });
    const input = earthquakeGetFeed.input.parse({ magnitude_tier: '4.5', time_window: 'week' });

    await expect(earthquakeGetFeed.handler(input, ctx)).rejects.toThrow('Service unavailable');
  });

  it('formats output with all event fields', () => {
    const output = {
      count: 1,
      generated_at: '2026-05-23T10:00:00.000Z',
      events: [sampleEvent],
      feed_url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
    };
    const blocks = earthquakeGetFeed.format!(output);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('us6000sznj');
    expect(text).toContain('6.2');
    expect(text).toContain('Anchorage');
    expect(text).toContain('earthquake.usgs.gov');
  });

  it('formats empty feed with fallback message', () => {
    const output = {
      count: 0,
      generated_at: '2026-05-23T10:00:00.000Z',
      events: [],
      feed_url:
        'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_hour.geojson',
    };
    const blocks = earthquakeGetFeed.format!(output);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('No events');
  });

  it('formats sparse event without fabricating null fields', () => {
    const output = {
      count: 1,
      generated_at: '2026-05-23T10:00:00.000Z',
      events: [sparseEvent],
      feed_url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
    };
    const blocks = earthquakeGetFeed.format!(output);
    const text = (blocks[0] as { text: string }).text;
    // sparse event should still render without crashing
    expect(text).toContain('us0000abc1');
    // null alert should render as "Not computed", not as a real alert level
    expect(text).toContain('Not computed');
  });
});
