/**
 * @fileoverview Tool definition for fetching full detail for a specific USGS earthquake event.
 * @module mcp-server/tools/definitions/earthquake-get-event.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { EarthquakeEventSchema, formatEvent } from '@/mcp-server/tools/schemas.js';
import { getUsgsService } from '@/services/usgs/usgs-service.js';

export const earthquakeGetEvent = tool('earthquake_get_event', {
  title: 'Get Earthquake Event Detail',
  description:
    'Fetch complete detail for a specific earthquake by USGS event ID. ' +
    'Returns the full property set including felt reports count (DYFI), ShakeMap maximum intensity (MMI), ' +
    'PAGER alert level, tsunami flag, and magnitude type. ' +
    'Event IDs appear in the "id" field of earthquake_get_feed and earthquake_search results. ' +
    'This tool is USGS-only — EMSC events have no per-event detail endpoint.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },

  input: z.object({
    event_id: z
      .string()
      .describe(
        'USGS event ID, e.g. "hv74966427" or "us6000sznj". ' +
          'Found in the "id" field of earthquake_get_feed and earthquake_search results.',
      ),
  }),

  output: z.object({
    event: EarthquakeEventSchema.describe('Full earthquake event detail.'),
  }),

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No event matches the provided event_id.',
      recovery:
        'Verify the event ID from a feed or search result. ' +
        'IDs are network-specific strings like "us6000sznj" or "hv74966427".',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Fetching earthquake event detail', { event_id: input.event_id });

    const event = await getUsgsService().getEvent(input.event_id, ctx);

    ctx.log.info('Event fetched', {
      event_id: input.event_id,
      magnitude: event.magnitude,
      place: event.place,
    });

    return { event };
  },

  format: (result) => {
    const lines = formatEvent(result.event);
    return [{ type: 'text', text: lines.join('\n') }];
  },
});
