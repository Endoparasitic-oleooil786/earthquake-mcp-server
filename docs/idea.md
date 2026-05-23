# earthquake-mcp-server

Real-time and historical global earthquake data via USGS Earthquake Hazards Program and EMSC.

## Data source

- **USGS Earthquake Hazards API** — GeoJSON feeds for global seismic events, real-time and historical
- **EMSC (European-Mediterranean Seismological Centre)** — complementary European seismic data
- **Auth**: None required
- **Rate limits**: Generous, GeoJSON feeds are public

## Why it earns its keep

Real-time global data with immediate utility. Simple API, fast to ship. Pairs with NWS weather for a "real-time hazards" stack. Journalists, researchers, disaster preparedness — everyone cares about earthquakes.

## Target users

- Anyone asking "was there just an earthquake near X?"
- Journalists covering seismic events
- Researchers analyzing seismic patterns
- Disaster preparedness and emergency management
- Agents combining with nominatim for location context

## Scope

- Read-only
- Query earthquakes by time range, magnitude, location/radius
- Real-time feeds (past hour/day/week/month)
- Significant earthquakes feed
- Event detail by ID
- Tectonic/fault data where available
