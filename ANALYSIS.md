# Source analysis

Inspection was intentionally bounded: first envelopes, one successful nested menu, and structural/count summaries. No provider API or shared-folder link was used. Full processing is streaming; sample files are not embedded in the repository.

| Source | Sample envelopes | Shape and relation |
|---|---:|---|
| `xbyte-raw-locations` | 8 | `payload.results[]` has `location_id`, `location_name`, `location_slug`. 5,576 observations represent 697 distinct IDs. |
| `xbyte-raw-restaurants` | 70 | `params.areaId` identifies the delivery area; `payload.results[]` lists restaurant names and URLs. 1,011 restaurant observations. URL `/uae/restaurant/{id}/...` supplies the restaurant ID. |
| `xbyte-raw-menus` | 500 | `params.restaurant_url` supplies restaurant/area context. 345 successful result profiles include restaurant details and `category[].items[]`; 155 envelopes contain an application error message instead. Successful profiles contain 4,195 category observations. |

These are scrape/request envelopes, not one entity per Mongo document. All inspected domains are `talabat`. Envelope `_id` identifies an observation, not a restaurant. Location IDs join numeric `location_id` to string `params.areaId` and URL `aid`. Crucially, the restaurant URL's numeric ID matches **`outletCode` in all 345 successful profiles**, and matches profile `id` in none. Restaurant identity therefore uses the URL/outlet ID. Preserve profile `id` as `sourceRestaurantId` without assuming its business meaning or using it for the listing join.

## Anomalies and policy

* Location lists repeat: flatten and deduplicate by canonical string provider ID. Never deduplicate by display name.
* Listing pages can return provider errors. Observed restaurant payload shapes include 68 ordinary `results` envelopes, one `Page Error Message` envelope and one `error` envelope. All application errors quarantine even if HTTP reports 200; any results in such an error envelope are deliberately not trusted.
* 155 menu payloads say the requested URL is not a restaurant page, despite HTTP 200. Quarantine with source reference and reason; do not pretend the run was entirely successful.
* Successful menus can have empty category lists. An empty list is valid; a missing/mistyped list produces a quarantine issue.
* IDs, coordinates and fees mix strings and numbers. Canonicalise integer IDs and validate numeric ranges. Names and descriptions contain inconsistent whitespace/newlines. Normalize NFKC and whitespace without changing input.
* Menu prices include float32 representation artefacts: e.g. `50.80000076293945` represents AED 50.80. The adapter accepts numeric noise within 0.00001 AED of a cent, then the core converts exact decimal strings to integer minor units. Real sub-cent amounts still fail validation. This prevents 811 valid item observations from being incorrectly quarantined for provider serialization noise.
* Restaurant URLs have slugs and area query parameters. Those vary without changing restaurant identity. Persist a canonical URL containing only the numeric restaurant path; record delivery-area relations separately.
* Items appear in promotional categories as well as ordinary categories. An item owns its price/name/description; category membership is a separate entity, avoiding duplicate independent prices.
* Missing IDs/names, malformed item prices or conflicting URL/outlet IDs are quarantined. Valid siblings still survive. Bad item rows do not emit dangling category membership. Parent identity failures suppress their children.
* Sample exports are partial and observations are from different times (menus in July, listings/locations in September). Richer menus win restaurant conflicts ahead of timestamp ordering; this accepts the possibility of a stale display name to preserve detail consistently. A production freshness/field ownership contract would improve this policy.
* Request URLs contain credentials. Never copy request logs, endpoint URLs or raw payloads into target collections, error responses or logs. Quarantine stores only source references, paths and controlled reasons.

## Model and trade-offs

Locations and restaurants have independent lifecycles. Service areas model the many-to-many delivery relation; they are not a claim about the restaurant's physical address. Categories belong to a restaurant; items are scoped to a restaurant because provider-wide uniqueness is not guaranteed. Category-item links allow one item to be advertised in multiple categories. Keys are namespaced by adapter/provider and collection, with parent IDs where necessary; exact formats and lookup indexes are in ARCHITECTURE.md.

Embed small scalar profile fields (address, city, coordinates) because they are read and versioned together. Reference unbounded collections (categories, items, memberships and delivery areas) because they grow and change independently. This adds joins, but avoids giant restaurant documents and category-level copies of mutable item data. Keep operational state outside domain records so repeating a run never adds timestamps/run IDs that drift the target state.
