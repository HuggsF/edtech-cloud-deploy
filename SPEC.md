# SPEC.md — edtech-cloud-deploy

## Overview

| Field | Value |
|---|---|
| **Project** | edtech-cloud-deploy |
| **Problem** | Deploy a containerized Node.js queue consumer with elastic auto-scaling on AWS |
| **Interview Question** | Q11 — DOT Digital Group Senior Backend Node.js |
| **Architecture** | Clean Architecture + DDD + TypeScript + IaC |

## Problem Statement

A containerized Node.js application consumes messages from RabbitMQ to process educational tasks. The system needs to scale elastically on AWS based on demand (queue depth), with:
1. Stateless containers for horizontal scaling
2. Auto-scaling based on queue depth metrics
3. Managed database (RDS) separate from application
4. Proper CI/CD pipeline
5. Monitoring and alerting

## Solution

Demonstrate a production-grade cloud-native architecture using Docker, Terraform (IaC), ECS/Fargate for container orchestration, RDS for MySQL, CloudWatch for auto-scaling, and GitHub Actions for CI/CD. Use LocalStack for local AWS simulation.

---

## Domain Model

### Entities

#### Task
```typescript
class Task {
  readonly id: string
  readonly type: TaskType
  readonly payload: TaskPayload
  readonly status: TaskStatus
  readonly attempts: number
  readonly result: string | null
  readonly error: string | null
  readonly createdAt: Date
  readonly processedAt: Date | null

  static create(props: TaskProps): Result<Task, DomainError>
  markAsProcessing(): Task
  markAsCompleted(result: string): Task
  markAsFailed(error: string): Task
}
```

### Value Objects
- **TaskType**: `'email_notification' | 'report_generation' | 'data_sync' | 'certificate_generation'`
- **TaskStatus**: `'pending' | 'processing' | 'completed' | 'failed'`
- **TaskPayload**: validated JSON object with type-specific schema

### Repository Interfaces

```typescript
interface TaskRepository {
  save(task: Task): Promise<void>
  findById(id: string): Promise<Task | null>
  updateStatus(id: string, status: TaskStatus, result?: string, error?: string): Promise<void>
  countByStatus(): Promise<Record<TaskStatus, number>>
}
```

### Application Interfaces

```typescript
interface MessageBroker {
  publish(queue: string, message: Buffer): Promise<void>
  consume(queue: string, handler: MessageHandler): Promise<void>
  ack(message: ConsumedMessage): void
  nack(message: ConsumedMessage, requeue: boolean): void
  getQueueDepth(queue: string): Promise<number>
}

interface MetricsExporter {
  exportGauge(name: string, value: number, labels?: Record<string, string>): void
  exportCounter(name: string, labels?: Record<string, string>): void
  exportHistogram(name: string, value: number, labels?: Record<string, string>): void
  getMetricsOutput(): string
}
```

---

## Application Layer

### Use Cases

#### ProcessTaskUseCase
Consumed by workers. Processes a single task from the queue.

#### EnqueueTaskUseCase
API endpoint that enqueues new tasks.

#### GetTaskStatusUseCase
Returns task status by ID.

#### GetSystemHealthUseCase
Returns health of all components (DB, Queue, API).

---

## Infrastructure Layer

### Application Code

#### Docker Multi-Stage Build
```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine AS production
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s CMD wget -q -O /dev/null http://localhost:3000/health
CMD ["node", "dist/index.js"]
```

#### Graceful Shutdown
```typescript
// Handle SIGTERM from ECS task stop
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, starting graceful shutdown')
  // 1. Stop accepting new messages
  await consumer.close()
  // 2. Wait for in-flight messages to complete (max 30s)
  await waitForInflight(30000)
  // 3. Close database connections
  await database.close()
  // 4. Exit
  process.exit(0)
})
```

#### Prometheus Metrics
- `task_processed_total` — counter by status
- `task_processing_duration_seconds` — histogram
- `queue_depth` — gauge
- `active_connections` — gauge

### Terraform (IaC)

#### Module Structure
```
infra/terraform/
├── modules/
│   ├── ecs/           # ECS cluster, task definitions, services
│   ├── rds/           # RDS MySQL instance (Multi-AZ)
│   ├── alb/           # Application Load Balancer
│   └── autoscaling/   # Auto-scaling policies + CloudWatch alarms
├── environments/
│   ├── dev/           # Dev environment variables
│   └── prod/          # Prod environment variables
├── main.tf            # Root module
├── variables.tf
└── outputs.tf
```

#### Auto-Scaling Policy
```hcl
resource "aws_appautoscaling_target" "workers" {
  max_capacity       = 10
  min_capacity       = 1
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.worker.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "queue_depth" {
  name               = "queue-depth-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.workers.resource_id
  scalable_dimension = aws_appautoscaling_target.workers.scalable_dimension
  service_namespace  = aws_appautoscaling_target.workers.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value = 100  # Target 100 messages per worker

    customized_metric_specification {
      metric_name = "QueueDepth"
      namespace   = "Custom/EdTech"
      statistic   = "Average"
    }
  }
}
```

### LocalStack
Docker Compose file for simulating AWS locally:
- ECS (limited), SQS (as queue substitute), RDS simulation
- Init script to create resources

### Monitoring
- **Prometheus** config to scrape app metrics
- **Grafana** dashboard JSON:
  - Panel 1: Queue depth over time
  - Panel 2: Tasks processed per second
  - Panel 3: Processing duration p50/p95/p99
  - Panel 4: Active workers count
  - Panel 5: Error rate

---

## CI/CD (GitHub Actions)

### ci.yml
```yaml
on: [push, pull_request]
jobs:
  lint-and-test:
    - Checkout
    - Setup Node 20
    - npm ci
    - npm run typecheck
    - npm run lint
    - npm run test:coverage
    - Upload coverage to Codecov
```

### deploy.yml
```yaml
on:
  push:
    branches: [main]
jobs:
  build-and-push:
    - Build Docker image
    - Push to ECR
  deploy:
    - Update ECS task definition
    - Deploy new ECS service revision
    - Wait for stabilization
```

---

## Presentation Layer

### HTTP API
```
POST /api/tasks              # Enqueue new task
GET  /api/tasks/:id          # Get task status
GET  /api/tasks/stats        # Count by status
GET  /metrics                # Prometheus metrics
GET  /health                 # Health check (DB + Queue)
```

---

## Docker Compose (Local Development)

```yaml
services:
  mysql:
    image: mysql:8
    ports: ["3306:3306"]
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: edtech

  rabbitmq:
    image: rabbitmq:3-management
    ports: ["5672:5672", "15672:15672"]

  prometheus:
    image: prom/prometheus
    ports: ["9090:9090"]
    volumes:
      - ./monitoring/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml

  grafana:
    image: grafana/grafana
    ports: ["3001:3000"]
    volumes:
      - ./monitoring/grafana/dashboards:/var/lib/grafana/dashboards

  api:
    build: .
    command: npm run dev:api
    ports: ["3000:3000"]
    depends_on: [mysql, rabbitmq]

  worker:
    build: .
    command: npm run dev:worker
    depends_on: [mysql, rabbitmq]
    deploy:
      replicas: 2
```

---

## Dependencies

### Production
- express, amqplib, mysql2, knex, pino, zod, dotenv, uuid, prom-client

### Development
- typescript, tsx, jest, ts-jest, supertest, @types/node, eslint, prettier, testcontainers

---

## ADR Documents

1. `docs/adr/001-stateless-containers.md` — Why containers must be stateless for horizontal scaling
2. `docs/adr/002-queue-based-autoscaling.md` — Why auto-scale on queue depth instead of CPU
3. `docs/adr/003-managed-database.md` — Why RDS instead of self-managed MySQL in containers
4. `docs/adr/004-multi-stage-docker.md` — Why multi-stage builds for smaller, safer images
5. `docs/adr/005-graceful-shutdown.md` — Why graceful shutdown is critical for queue consumers
