# Scaling & graceful-shutdown verification — edtech-cloud-deploy

- **Date:** 2026-10-06T17:23:36.542Z
- **Environment:** Node v24.19.0 · win32 x64 · 13th Gen Intel(R) Core(TM) i5-13450HX · docker-compose (API + RabbitMQ 3 + MySQL 8 + worker replicas, production images)
- **Workload:** tasks enqueued through `POST /api/tasks` (4 task types); each task simulates 250 ms ± 50% of work and fails transiently 2% of the time (then retried); prefetch 10 per worker.
- **Drain time** = first enqueue → every task `completed`/`failed` in MySQL and the RabbitMQ queue empty.

## Horizontal scaling (same backlog, more stateless replicas)

| Worker replicas | Backlog | Drain time | Throughput | Per worker | Speed-up | Peak queue depth | Failed |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 2,000 | 71.6 s | 27.9 tasks/s | 27.9 tasks/s | 1.00× | 1,866 | 0 |
| 2 | 2,000 | 37.0 s | 54 tasks/s | 27 tasks/s | 1.94× | 1,725 | 0 |
| 4 | 2,000 | 22.3 s | 89.9 tasks/s | 22.5 tasks/s | 3.22× | 1,058 | 0 |

## Graceful shutdown (SIGTERM to one of 2 workers mid-load)

| Backlog | Completed when SIGTERM was sent | In-flight at stop | Drain time | Completed | Failed | Stuck in `processing` | Retried (attempts > 1) | Lost |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 338 | 10 | 723 ms | 1000 | 0 | 0 | 30 | **0** |

Reproduce: `docker compose up -d --build && npm run bench:scaling`.
