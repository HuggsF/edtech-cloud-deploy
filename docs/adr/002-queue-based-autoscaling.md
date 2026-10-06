# ADR 002: Auto-Scaling Workers Based on Queue Depth Instead of CPU

## Status
Accepted

## Context
Standard container auto-scaling configurations rely on CPU utilization (e.g., target 70% CPU) or Memory utilization. However, background workers consuming asynchronous queues (like email sending, PDF report generation, SIS data synchronization) frequently experience I/O-bound wait states (network requests, third-party APIs, database writes).

Under high queue backlog, worker CPU might hover at 20-30% while thousands of messages accumulate in RabbitMQ, causing unacceptable SLA degradation and delayed notifications for students and teachers.

## Decision Drivers
- **Consumer Lag Prevention:** Scale workers proportionally to pending customer demand.
- **Cost Minimization:** Avoid keeping excess workers alive when the queue is empty.
- **Accurate Metric Signal:** Metric must reflect actual work queued rather than container processor load.

## Considered Options
1. **CPU / Memory Target Tracking (Standard ECS scaling)**
   - *Pros:* Native CloudWatch metrics provided out-of-the-box.
   - *Cons:* I/O-bound workloads do not trigger scaling; high-latency external APIs cause queue starvation despite low CPU usage.
2. **Queue Depth Target Tracking Scaling (Custom CloudWatch Metric: `QueueDepth`)**
   - *Pros:* Directly couples worker capacity to queue backlog ($Target = \frac{\text{Queue Depth}}{\text{Desired Messages per Worker}}$); immediate scale-out when messages spike.
   - *Cons:* Requires publishing custom metrics to CloudWatch or using Prometheus Metric Exporter with CloudWatch Agent.

## Decision Outcome
We adopted **Target Tracking Auto-Scaling based on custom CloudWatch metric `QueueDepth`**.
- The API periodic sampler queries RabbitMQ queue depths and exports the metric to CloudWatch every 15 seconds.
- AWS Application Auto Scaling targets an average of 50-100 messages per worker task.
- When 1,000 messages arrive, ECS immediately calculates the need for 10 workers and provisions them concurrently.
- Scale-out cooldown is set to 30s for rapid response; scale-in cooldown is set to 300s to avoid flapping (thrashing).

## Consequences
### Positive
- Strict adherence to task processing SLAs regardless of whether tasks are CPU-bound or I/O-bound.
- Automated scale-down to minimum baseline (2 workers) when queues drain.
- Direct visibility in Grafana and CloudWatch alarms.

### Negative / Trade-offs
- CloudWatch `PutMetricData` API calls incur minor AWS costs, mitigated by batching metric publishing.
