/**
 * @fileoverview Tests for the earthquake-event resource.
 * @module tests/resources/earthquake-event.resource.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { earthquakeEventResource } from '@/mcp-server/resources/definitions/earthquake-event.resource.js';
import type { EarthquakeEventOutput } from '@/mcp-server/tools/schemas.js';
import * as usgsModule from '@/services/usgs/usgs-service.js';

const sampleEvent: EarthquakeEventOutput = {
  id: 'ci38457511',
  title: 'M 7.1 - 15 km ESE of Ridgecrest, CA',
  magnitude: 7.1,
  magnitude_type: 'mw',
  time: '2019-07-06T03:19:53.040Z',
  updated: '2019-07-08T18:00:00.000Z',
  place: '15 km ESE of Ridgecrest, CA',
  latitude: 35.7695,
  longitude: -117.5993,
  depth_km: 8,
  felt: 18000,
  cdi: 7.1,
  mmi: 8.3,
  alert: 'orange',
  tsunami: 0,
  significance: 1539,
  status: 'reviewed',
  event_url: 'https://earthquake.usgs.gov/earthquakes/eventpage/ci38457511',
  detail_url: 'https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=ci38457511&format=geojson',
};

const sparseEvent: EarthquakeEventOutput = {
  id: 'nc12345678',
  title: 'M 1.2 - Northern California',
  magnitude: 1.2,
  magnitude_type: 'ml',
  time: '2026-05-23T01:00:00.000Z',
  updated: '2026-05-23T01:05:00.000Z',
  place: 'Northern California',
  latitude: 38.8,
  longitude: -122.8,
  depth_km: 3,
  felt: null,
  cdi: null,
  mmi: null,
  alert: null,
  tsunami: 0,
  significance: null,
  status: 'automatic',
};

describe('earthquakeEventResource', () => {
  let mockGetEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetEvent = vi.fn();
    vi.spyOn(usgsModule, 'getUsgsService').mockReturnValue({
      getEvent: mockGetEvent,
    } as unknown as usgsModule.UsgsService);
  });

  it('returns full event data for a valid event ID', async () => {
    mockGetEvent.mockResolvedValue(sampleEvent);

    const ctx = createMockContext();
    const params = earthquakeEventResource.params.parse({ event_id: 'ci38457511' });
    const result = await earthquakeEventResource.handler(params, ctx);

    expect(result.event.id).toBe('ci38457511');
    expect(result.event.magnitude).toBe(7.1);
    expect(result.event.alert).toBe('orange');
    expect(result.event.felt).toBe(18000);
    expect(mockGetEvent).toHaveBeenCalledWith('ci38457511', ctx);
  });

  it('propagates not_found error from service', async () => {
    const { McpError } = await import('@cyanheads/mcp-ts-core/errors');
    mockGetEvent.mockRejectedValue(
      new McpError(-32001, 'No earthquake event found for ID "bad-id"', { eventId: 'bad-id' }),
    );

    const ctx = createMockContext();
    const params = earthquakeEventResource.params.parse({ event_id: 'bad-id' });

    await expect(earthquakeEventResource.handler(params, ctx)).rejects.toThrow();
  });

  it('returns sparse event without crashing', async () => {
    mockGetEvent.mockResolvedValue(sparseEvent);

    const ctx = createMockContext();
    const params = earthquakeEventResource.params.parse({ event_id: 'nc12345678' });
    const result = await earthquakeEventResource.handler(params, ctx);

    expect(result.event.id).toBe('nc12345678');
    expect(result.event.felt).toBeNull();
    expect(result.event.alert).toBeNull();
    expect(result.event.significance).toBeNull();
  });

  it('propagates general service errors', async () => {
    mockGetEvent.mockRejectedValue(new Error('Network failure'));

    const ctx = createMockContext();
    const params = earthquakeEventResource.params.parse({ event_id: 'us6000sznj' });

    await expect(earthquakeEventResource.handler(params, ctx)).rejects.toThrow('Network failure');
  });
});
