/**
 * @fileoverview Resource definition for accessing full USGS earthquake event detail by ID via URI.
 * @module mcp-server/resources/definitions/earthquake-event.resource
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { EarthquakeEventSchema } from '@/mcp-server/tools/schemas.js';
import { getUsgsService } from '@/services/usgs/usgs-service.js';

export const earthquakeEventResource = resource('earthquake://event/{event_id}', {
  name: 'earthquake-event',
  title: 'USGS Earthquake Event',
  description:
    'Full earthquake event detail by USGS event ID as injectable context. ' +
    'Returns the complete property set including felt reports, ShakeMap intensity, PAGER alert, and products metadata. ' +
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
    const event = await getUsgsService().getEvent(params.event_id, ctx);
    return { event };
  },
});
