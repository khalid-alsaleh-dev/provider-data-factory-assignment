# Provider Data Factory

A small NestJS service that turns Xbyte/Talabat exports into clean restaurant data. MongoDB stores raw data and output in separate databases; BullMQ and Redis handle background jobs.

## Run locally

Requires Node 22+, MongoDB on port 27017, and Redis installed. A standalone MongoDB server is sufficient.

```sh
npm ci --ignore-scripts
npm start
```

`npm start` builds the app, starts Redis if needed, and serves the API at http://localhost:3000. Ctrl+C stops the app and any Redis process it started. MongoDB stays running.

The launcher loads `.env` if present. Defaults: MongoDB on 27017, Redis on 43179, API on 3000. See [.env.example](.env.example) for configuration. On Windows, Redis is discovered under `%LOCALAPPDATA%/Programs/redis`; otherwise put `redis-server` on PATH or set `REDIS_SERVER_PATH`.

## Load data and start a run

Place these exports in `data/`:

```text
compero-xbyte.xbyte-raw-locations.json
compero-xbyte.xbyte-raw-restaurants.json
compero-xbyte.xbyte-raw-menus.json
```

With MongoDB running, seed the raw database after building:

```sh
npm run seed -- --dir data
```

For other filenames, pass `--locations PATH --restaurants PATH --menus PATH`. The seeder streams batches of 100 and preserves MongoDB IDs and dates. Only the seeder writes raw data; keep it unchanged during a run. Downloads are excluded from Git because their URLs contain provider credentials.

| Endpoint | Purpose |
|---|---|
| `POST /runs` | Start a run; `{}` selects all collections |
| `GET /runs/:id` | Status, timing, counters and an error sample |
| `GET /runs/:id/errors?limit=25&after=ERROR_ID` | Paginated quarantined issues |
| `GET /health` | MongoDB and Redis availability |

```sh
curl -X POST http://localhost:3000/runs -H "Content-Type: application/json" -d '{}'
curl http://localhost:3000/runs/RUN_ID
```

To process a smaller slice, send `{"collections":["menus"],"limit":10}`. The limit counts raw envelopes per selected collection. Invalid requests return 400; unknown runs return 404.

PowerShell:

```powershell
Invoke-RestMethod http://localhost:3000/runs -Method Post -ContentType application/json -Body '{"collections":["menus"],"limit":10}'
```

## Docker

```sh
docker compose up --build -d
docker compose run --rm -v "${PWD}/data:/data:ro" app npm run seed -- --dir /data
```

Then use the same API on port 3000. Compose runs MongoDB and Redis with persistent volumes. The Compose stack was not executed on the authoring machine; integration tests use native MongoDB and Redis processes.

## How it works

1. Save a run and enqueue its dispatcher job.
2. The dispatcher pages through source IDs, saves batches, and queues them with stable job IDs.
3. The batch processor passes each document through the Xbyte adapter and pure transformation pipeline, then saves entities and quarantined issues.
4. A receipt skips completed documents on retry. The run finishes when dispatch and all batches are done.

Start reading at `runs/runs.service.ts`, then `queue/dispatcher.service.ts` and `queue/batch-processor.service.ts`. Provider fields and conversions live in `providers/xbyte`; shared transformation stages live in `core/pipeline.ts`. `WorkRepository` owns output writes and receipts. See [ARCHITECTURE.md](ARCHITECTURE.md) for the model and recovery details, and [ANALYSIS.md](ANALYSIS.md) for source findings.

Key choices:

* Stable natural keys prevent duplicate entities. Items can belong to multiple categories.
* Restaurant URL IDs match menu `outletCode`; menu `id` is kept separately as `sourceRestaurantId`.
* Rich menu profiles outrank listing summaries. Timestamp, source ID and content hash break ties consistently, regardless of worker order.
* Prices use integer fils; the adapter removes observed float32 noise before conversion.
* Invalid provider data is quarantined. Dependency failures retry with exponential backoff; exhausted batch jobs become dead batches with a dead-letter queue reference.

Counters: `read` counts processed envelopes; `transformed` counts envelopes producing entities; `written` counts inserted/replaced entities; `skipped` counts duplicate, unchanged or older entities; `failed` counts quarantined issues.

## Tests

```sh
npm test
npm run test:integration
```

Integration tests start temporary MongoDB and Redis processes. Redis must be on PATH or configured through `REDIS_SERVER_PATH`; `mongodb-memory-server` downloads MongoDB on first use. Tests cover validation, deterministic transformation, repeated runs, checkpoints, restart with persisted jobs, and exhausted retries. Set `SAMPLE_DIR` to also test the downloaded exports.

Earlier full-export runs processed 578 envelopes: 421 produced entities and 157 were quarantined provider error responses. A second run wrote zero entities and left domain data unchanged.

## Deliberately left out

* **Atomic document writes.** Entities, issues, counters and receipts are saved separately. A crash can leave partial output or inaccurate counters. Transactions and replica-set setup are left out to keep standalone MongoDB support.
* **Automatic queue reconstruction.** Restart recovery relies on persisted BullMQ jobs and MongoDB receipts. There are no startup or periodic scans to rebuild missing jobs. If Redis loses its jobs, start a new run.
* **Transactional outbox.** Saving a run and enqueueing it are separate operations; a crash between them can leave a run without a job.
* **Multiple app instances, backpressure, retention and automatic DLQ replay.** Run one instance. Completed jobs are retained for job-ID deduplication; bounded dispatch and retention remain future work.
* **Deletion sync and source snapshots.** Keep raw data immutable during a run. The dispatcher records an upper ID bound, which does not protect against edits or inserts below that bound. Removed source entities are not deleted from the output.
* **Extra profile fields and product features.** Delivery fees, ETA, reviews and merchandising order are outside the chosen data slice. Authentication, a frontend, cloud deployment and a second provider adapter are outside this assignment's scope.
