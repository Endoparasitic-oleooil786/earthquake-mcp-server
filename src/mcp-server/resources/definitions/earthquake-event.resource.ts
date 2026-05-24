/**
 * @fileoverview Resource definition for accessing full USGS earthquake event detail by ID via URI.
 * @module mcp-server/resources/definitions/earthquake-event.resource
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError, notFound } from '@cyanheads/mcp-ts-core/errors';
import { EarthquakeEventSchema } from '@/mcp-server/tools/schemas.js';
import type { EarthquakeEvent } from '@/services/usgs/types.js';
import { getUsgsService } from '@/services/usgs/usgs-service.js';

export const earthquakeEventResource = resource('earthquake://event/{event_id}', {
  name: 'earthquake-event',
  title: 'USGS Earthquake Event',
  description:
    'Earthquake event detail by USGS event ID as injectable context. ' +
    'Returns felt reports, ShakeMap intensity, PAGER alert, tsunami flag, and magnitude type. ' +
    'Use event IDs from earthquake_get_feed or earthquake_search results.',
  mimeType: 'application/json',

  params: z.object({
    event_id: z.string().describe('USGS event ID, e.g. "us6000sznj" or "hv74966427".'),
  }),

  output: z.object({
    event: EarthquakeEventSchema.describe('Full earthquake event detail.'),
  }),

  async handler(params, ctx) {
    ctx.log.debug('Fetching event resource', { event_id: params.event_id });
    let event: EarthquakeEvent;
    try {
      event = await getUsgsService().getEvent(params.event_id, ctx);
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        throw notFound(
          `No earthquake event found for ID "${params.event_id}". Verify the ID from a feed or search result.`,
          { event_id: params.event_id },
          { cause: err },
        );
      }
      throw err;
    }
    return { event };
  },
});
