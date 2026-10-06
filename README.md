# ☁️ edtech-cloud-deploy

> Production-grade cloud-native architecture for containerized Node.js workers with elastic auto-scaling.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Multi--Stage-blue?logo=docker)](https://docs.docker.com/build/building/multi-stage/)
[![Terraform](https://img.shields.io/badge/Terraform-IaC-purple?logo=terraform)](https://www.terraform.io/)
[![AWS](https://img.shields.io/badge/AWS-ECS%20%7C%20RDS-orange?logo=amazonaws)](https://aws.amazon.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

---

## 🎯 The Problem

How do you deploy a containerized Node.js application that consumes message queues with **elastic scalability** on AWS?

| Approach | Scaling | Resilience | Cost | Maturity |
|---|---|---|---|---|
| Single EC2 + docker-compose | Manual (Scale Up) | ❌ SPOF | Fixed | Low |
| MySQL in same container | None | ❌ Data loss risk | - | Anti-pattern |
| **ECS + Auto-scaling + RDS** | Automatic (Scale Out) | ✅ Multi-AZ | Pay-per-use | Production |

## 💡 The Solution

```
┌──────────────────────────────────────────────┐
│                    AWS                        │
│                                              │
│  ALB ──► ECS Cluster                         │
│          ├── API Task (2+ replicas)          │
│          └── Worker Task (auto-scaled)       │
│                    │                         │
│          CloudWatch Alarms                   │
│          (queue depth → scale workers)       │
│                    │                         │
│  RabbitMQ ◄───────┘                         │
│  RDS MySQL (Multi-AZ, managed)              │
│  Prometheus + Grafana (monitoring)          │
└──────────────────────────────────────────────┘
```

## 🏗️ Architecture

**Clean Architecture + DDD + TypeScript + Infrastructure as Code**

```
app/                    # Node.js application
├── src/
│   ├── domain/        # Task entity, ports
│   ├── application/   # ProcessTask, EnqueueTask use cases
│   ├── infrastructure/# RabbitMQ, MySQL, Prometheus metrics
│   └── presentation/  # Express API, Worker process

infra/                  # Terraform modules
├── terraform/
│   ├── modules/       # ECS, RDS, ALB, Auto-scaling
│   └── environments/  # dev, prod configs

monitoring/             # Observability
├── prometheus/        # Scrape config
└── grafana/           # Dashboard JSON
```

### Key Technical Decisions

| Decision | Rationale | ADR |
|---|---|---|
| Stateless containers | Can scale horizontally. No local state to lose | [ADR-001](docs/adr/001-stateless-containers.md) |
| Queue-depth auto-scaling | Scale workers based on actual demand, not CPU | [ADR-002](docs/adr/002-queue-based-autoscaling.md) |
| RDS over containerized MySQL | Managed backups, failover, replicas. DB and app scale independently | [ADR-003](docs/adr/003-managed-database.md) |
| Multi-stage Docker | Smaller image (alpine), no dev deps in prod | [ADR-004](docs/adr/004-multi-stage-docker.md) |
| Graceful shutdown | Drain in-flight messages before container stops | [ADR-005](docs/adr/005-graceful-shutdown.md) |

## 🚀 Quick Start (Local)

```bash
# Start everything locally
docker-compose up -d

# Install + migrate
npm install && npm run migrate

# Start API + Worker
npm run dev:api    # Port 3000
npm run dev:worker # Consumes queue

# Monitoring
open http://localhost:9090    # Prometheus
open http://localhost:3001    # Grafana
open http://localhost:15672   # RabbitMQ Management
```

## ☁️ Deploy to AWS

```bash
cd infra/terraform/environments/dev
terraform init
terraform plan
terraform apply
```

Or use LocalStack for local AWS simulation:
```bash
docker-compose -f docker-compose.localstack.yml up -d
```

## 📊 Monitoring

Grafana dashboard includes:
- Queue depth over time
- Tasks processed per second
- Processing duration (p50/p95/p99)
- Active worker count
- Error rate

## 📚 Tech Stack

| Technology | Role |
|---|---|
| **Docker** | Multi-stage containerization |
| **Terraform** | Infrastructure as Code |
| **ECS/Fargate** | Container orchestration |
| **RDS** | Managed MySQL |
| **CloudWatch** | Metrics + auto-scaling |
| **Prometheus** | App metrics collection |
| **Grafana** | Metrics visualization |
| **GitHub Actions** | CI/CD pipeline |

## 📄 License

MIT
