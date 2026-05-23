#!/usr/bin/env node
/**
 * @fileoverview earthquake-mcp-server MCP server entry point.
 * @module index
 */

import { createApp } from '@cyanheads/mcp-ts-core';
import { getServerConfig } from './config/server-config.js';
import { earthquakeEventResource } from './mcp-server/resources/definitions/earthquake-event.resource.js';
import { earthquakeFeedResource } from './mcp-server/resources/definitions/earthquake-feed.resource.js';
import { earthquakeCount } from './mcp-server/tools/definitions/earthquake-count.tool.js';
import { earthquakeGetEvent } from './mcp-server/tools/definitions/earthquake-get-event.tool.js';
import { earthquakeGetFeed } from './mcp-server/tools/definitions/earthquake-get-feed.tool.js';
import { earthquakeSearch } from './mcp-server/tools/definitions/earthquake-search.tool.js';
import { initEmscService } from './services/emsc/emsc-service.js';
import { initUsgsService } from './services/usgs/usgs-service.js';

await createApp({
  tools: [earthquakeGetFeed, earthquakeSearch, earthquakeGetEvent, earthquakeCount],
  resources: [earthquakeFeedResource, earthquakeEventResource],
  prompts: [],
  setup(core) {
    const config = getServerConfig();
    initUsgsService(core.config, core.storage, config.usgsBaseUrl, config.requestTimeoutMs);
    initEmscService(core.config, core.storage, config.emscBaseUrl, config.requestTimeoutMs);
  },
});
