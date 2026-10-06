# CLAUDE.md — edtech-cloud-deploy

## Project Context
This project demonstrates a production-grade cloud-native deployment for a containerized Node.js worker that consumes message queues. It showcases stateless containers, auto-scaling based on queue depth, managed database, Infrastructure as Code (Terraform), CI/CD, and monitoring.

## Key Constraints
- MUST use multi-stage Docker builds (builder + production)
- MUST implement graceful shutdown (SIGTERM handling)
- MUST create Terraform modules for ECS, RDS, ALB, Auto-scaling
- MUST include Prometheus metrics export (prom-client)
- MUST include Grafana dashboard JSON
- MUST include GitHub Actions CI/CD pipeline
- MUST have separate entry points for API and Worker
- MUST use docker-compose for local development with all services
- Worker containers MUST be stateless
- Auto-scaling MUST be based on queue depth, not CPU

## Implementation Order
1. Domain: Task entity, value objects, repository interface
2. Application: ProcessTaskUseCase, EnqueueTaskUseCase
3. Infrastructure: RabbitMQ adapter, MySQL repository
4. Infrastructure: Prometheus metrics exporter (prom-client)
5. Infrastructure: Config with zod, Logger with pino
6. Presentation: Express API (POST /tasks, GET /tasks/:id, GET /metrics, GET /health)
7. Presentation: Worker process with graceful shutdown
8. Docker: Multi-stage Dockerfile + Dockerfile.dev
9. Docker Compose: Full local environment (MySQL, RabbitMQ, Prometheus, Grafana, API, Workers)
10. Monitoring: prometheus.yml + Grafana dashboard JSON
11. Terraform: ECS module, RDS module, ALB module, Auto-scaling module
12. CI/CD: GitHub Actions (ci.yml + deploy.yml)
13. ADR documents
14. Tests: unit -> integration
15. Docker Compose LocalStack variant

## Project-Specific Dependencies
- express, amqplib, mysql2, knex, prom-client, uuid
- supertest (dev)

## Database Schema
```sql
CREATE TABLE tasks (
  id VARCHAR(36) PRIMARY KEY,
  type ENUM('email_notification','report_generation','data_sync','certificate_generation') NOT NULL,
  payload JSON NOT NULL,
  status ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  result TEXT NULL,
  error TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,
  INDEX idx_status (status),
  INDEX idx_type (type)
);
```
