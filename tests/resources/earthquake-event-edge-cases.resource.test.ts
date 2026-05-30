/**
 * @fileoverview Edge-case and security tests for the earthquake-event resource.
 * @module tests/resources/earthquake-event-edge-cases.resource.test
 */

import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { earthquakeEventResource } from '@/mcp-server/resources/definitions/earthquake-event.resource.js';
import type { EarthquakeEventOutput } from '@/mcp-server/tools/schemas.js';
import * as usgsModule from '@/services/usgs/usgs-service.js';

const deletedEvent: EarthquakeEventOutput = {
  id: 'us9999999',
  title: 'M 2.0 - Deleted event',
  magnitude: 2.0,
  magnitude_type: 'ml',
  time: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-01T12:00:00.000Z',
  place: 'Somewhere',
  latitude: 10.0,
  longitude: 10.0,
  depth_km: 5,
  felt: null,
  cdi: null,
  mmi: null,
  alert: null,
  tsunami: 0,
  significance: null,
  status: 'deleted',
};

describe('earthquakeEventResource — params schema', () => {
  it('requires event_id', () => {
    expect(() => earthquakeEventResource.params.parse({})).toThrow();
  });

  it('accepts a valid event_id string', () => {
    const params = earthquakeEventResource.params.parse({ event_id: 'ci38457511' });
    expect(params.event_id).toBe('ci38457511');
  });
});

describe('earthquakeEventResource — handler behavior', () => {
  let mockGetEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetEvent = vi.fn();
    vi.spyOn(usgsModule, 'getUsgsService').mockReturnValue({
      getEvent: mockGetEvent,
    } as unknown as usgsModule.UsgsService);
  });

  it('passes event_id directly to the USGS service', async () => {
    mockGetEvent.mockResolvedValue(deletedEvent);
    const ctx = createMockContext();
    const params = earthquakeEventResource.params.parse({ event_id: 'us9999999' });
    await earthquakeEventResource.handler(params, ctx);
    expect(mockGetEvent).toHaveBeenCalledWith('us9999999', ctx);
  });

  it('returns a deleted event without crashing', async () => {
    mockGetEvent.mockResolvedValue(deletedEvent);
    const ctx = createMockContext();
    const params = earthquakeEventResource.params.parse({ event_id: 'us9999999' });
    const result = await earthquakeEventResource.handler(params, ctx);
    expect(result.event.status).toBe('deleted');
  });

  it('translates McpError NotFound to a notFound error', async () => {
    const { McpError, JsonRpcErrorCode } = await import('@cyanheads/mcp-ts-core/errors');
    mockGetEvent.mockRejectedValue(
      new McpError(JsonRpcErrorCode.NotFound, 'No event for ID "xx"', { eventId: 'xx' }),
    );
    const ctx = createMockContext();
    const params = earthquakeEventResource.params.parse({ event_id: 'xx' });
    await expect(earthquakeEventResource.handler(params, ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.NotFound,
    });
  });

  it('re-throws non-NotFound McpErrors unchanged', async () => {
    const { McpError, JsonRpcErrorCode } = await import('@cyanheads/mcp-ts-core/errors');
    const originalErr = new McpError(JsonRpcErrorCode.ServiceUnavailable, 'Upstream down', {});
    mockGetEvent.mockRejectedValue(originalErr);
    const ctx = createMockContext();
    const params = earthquakeEventResource.params.parse({ event_id: 'ci38457511' });
    const err = await earthquakeEventResource.handler(params, ctx).catch((e: unknown) => e);
    expect(err).toBe(originalErr);
  });
});

describe('earthquakeEventResource — security', () => {
  let mockGetEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetEvent = vi.fn();
    vi.spyOn(usgsModule, 'getUsgsService').mockReturnValue({
      getEvent: mockGetEvent,
    } as unknown as usgsModule.UsgsService);
  });

  it('handles path-traversal-like event IDs — errors correctly and does not execute traversal', async () => {
    const { McpError, JsonRpcErrorCode } = await import('@cyanheads/mcp-ts-core/errors');
    const traversalId = '../../../etc/passwd';
    mockGetEvent.mockRejectedValue(
      new McpError(JsonRpcErrorCode.NotFound, `No event for ID "${traversalId}"`, {}),
    );

    const ctx = createMockContext();
    const params = earthquakeEventResource.params.parse({ event_id: traversalId });
    const err = await earthquakeEventResource.handler(params, ctx).catch((e: unknown) => e);

    // Should throw a NotFound error (the ID is echoed in the message, which is fine —
    // the key assertion is that the handler throws NotFound rather than attempting a
    // filesystem read or exposing stack frames / internal paths).
    expect(err).toBeDefined();
    // Must not expose stack-trace internal paths or ENOENT errors from the Node runtime
    const msg = (err as { message?: string }).message ?? '';
    expect(msg).not.toContain('ENOENT');
    expect(msg).not.toContain('node_modules');
    // The error code must be NotFound, not an InternalError leaking filesystem details
    expect((err as { code?: number }).code).toBe(JsonRpcErrorCode.NotFound);
  });

  it('handles very long event IDs without crashing', async () => {
    const { McpError, JsonRpcErrorCode } = await import('@cyanheads/mcp-ts-core/errors');
    const longId = 'x'.repeat(2000);
    mockGetEvent.mockRejectedValue(new McpError(JsonRpcErrorCode.NotFound, 'No event found', {}));

    const ctx = createMockContext();
    const params = earthquakeEventResource.params.parse({ event_id: longId });
    // Must not crash (may throw NotFound, which is expected)
    await expect(earthquakeEventResource.handler(params, ctx)).rejects.toBeDefined();
  });
});
