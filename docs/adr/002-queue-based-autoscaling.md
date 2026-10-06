# ADR 002: Auto-Scaling Workers Based on Queue Backlog Instead of CPU

## Status
Accepted (revised 2026-10-06: target tracking now uses **backlog per task**, see "Revision")

## Context
Standard container auto-scaling configurations rely on CPU utilization (e.g., target 70% CPU) or Memory utilization. However, background workers consuming asynchronous queues (like email sending, PDF report generation, SIS data synchronization) frequently experience I/O-bound wait states (network requests, third-party APIs, database writes).

Under high queue backlog, worker CPU might hover at 20-30% while thousands of messages accumulate in RabbitMQ, causing unacceptable SLA degradation and delayed notifications for students and teachers.

## Decision Drivers
- **Consumer Lag Prevention:** Scale workers proportionally to pending customer demand.
- **Cost Minimization:** Avoid keeping excess workers alive when the queue is empty.
- **Accurate Metric Signal:** Metric must reflect actual work queued rather than container processor load.
- **Stateless workers:** Scaling only helps if any replica can take any message (ADR-001).

## Considered Options
1. **CPU / Memory Target Tracking (Standard ECS scaling)**
   - *Pros:* Native CloudWatch metrics provided out-of-the-box.
   - *Cons:* I/O-bound workloads do not trigger scaling; high-latency external APIs cause queue starvation despite low CPU usage.
2. **Target tracking on raw `QueueDepth`**
   - *Pros:* Simple, one custom metric.
   - *Cons:* Target tracking assumes the metric **falls as capacity is added** (like CPU utilisation). Total queue depth does not, so the controller over-scales: with 10 tasks and 200 queued messages, a target of 50 asks for 10 × 200/50 = 40 tasks although each task only holds 20 messages.
3. **Target tracking on backlog per task = `QueueDepth` ÷ `RunningTaskCount` (CloudWatch metric math)**
   - *Pros:* The metric the controller expects ("messages each worker still has to process"); the AWS-recommended pattern for queue workers; scale-in happens naturally as the backlog drains.
   - *Cons:* Needs Container Insights for `RunningTaskCount` and a custom `QueueDepth` metric.

## Decision Outcome
We adopted **option 3 — target tracking on backlog per worker task** (`infra/terraform/modules/autoscaling`):
- The API runs a periodic sampler that reads the RabbitMQ queue depth every 15 s and publishes `Custom/EdTech QueueDepth{QueueName=edtech.tasks}` with `PutMetricData` (task role, no keys). Publishing it from the application keeps the signal identical whether RabbitMQ runs on Amazon MQ or is self-hosted.
- The scaling policy divides it by `ECS/ContainerInsights RunningTaskCount{ClusterName, ServiceName}` (metric math, `IF(tasks < 1, 1, tasks)` guards the division) and tracks **50 messages per worker task**, between 2 and 10 tasks.
- Example: 1,000 queued messages with 2 running tasks → backlog 500 per task → the policy asks for 1,000 / 50 = 20 tasks, capped at 10.
- Scale-out cooldown 30 s for rapid response; scale-in cooldown 180–300 s to avoid flapping.
- A CloudWatch alarm fires when the depth exceeds what the maximum fleet is sized for (50 × max tasks).

## Revision (2026-10-06)
The first version tracked raw `QueueDepth` **without dimensions**. Besides the over-scaling problem described in option 2, the application publishes the metric **with** the `QueueName` dimension, and CloudWatch treats a metric with different dimensions as a different metric: the policy would have received no data and never scaled. Both the policy and the alarm now query the dimensioned metric; `terraform validate` passes for `dev` and `prod`.

## Evidence (local, `npm run bench:scaling`)
Scaling on backlog only pays off if throughput grows with replicas. Draining the same 2,000-task backlog with stateless workers (docker-compose, 250 ms simulated tasks, prefetch 10):

| Workers | Drain time | Throughput | Speed-up |
|---:|---:|---:|---:|
| 1 | 71.6 s | 27.9 tasks/s | 1.00× |
| 2 | 37.0 s | 54.0 tasks/s | 1.94× |
| 4 | 22.3 s | 89.9 tasks/s | 3.22× |

The policy itself was not exercised on AWS (nothing was deployed); only its configuration is validated.

## Consequences
### Positive
- Strict adherence to task processing SLAs regardless of whether tasks are CPU-bound or I/O-bound.
- Automated scale-down to minimum baseline (2 workers) when queues drain.
- Direct visibility in Grafana and CloudWatch alarms.

### Negative / Trade-offs
- CloudWatch `PutMetricData` API calls incur minor AWS costs (one datapoint every 15 s).
- Depends on Container Insights being enabled on the cluster (it is, in the ECS module).
- The 15 s sampling interval plus CloudWatch's evaluation periods delay scale-out by roughly a minute; bursts shorter than that are absorbed by the existing tasks.
