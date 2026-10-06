# ADR 003: Managed Database (AWS RDS MySQL) Instead of In-Cluster Database

## Status
Accepted

## Context
Educational task processing requires relational consistency, ACID transactions, and persistent audit history (tracking task attempts, timestamps, results, and failures). While running MySQL in a Docker container or Kubernetes pod is convenient for local development, production workloads demand enterprise-grade reliability, automated patching, Multi-AZ failover, and point-in-time recovery.

## Decision Drivers
- **Data Durability & High Availability:** Zero tolerance for database corruption or unrecoverable hardware failures.
- **Operational Overhead:** Engineering team should focus on business domain rather than replication lag, OS patching, and disk volume management.
- **Independent Scaling:** Database I/O, storage, and compute must scale independently from application container lifecycles.

## Considered Options
1. **Self-Managed MySQL on EC2 / ECS Containers**
   - *Pros:* Complete low-level operating system control, lower nominal license/instance fee.
   - *Cons:* High maintenance burden; manual replication setups; manual automated backups and failover testing; high disaster recovery risk.
2. **Managed AWS RDS for MySQL (Multi-AZ)**
   - *Pros:* Synchronous standby replica in separate Availability Zone; automatic failover under 60 seconds; automated daily snapshots and point-in-time restore; managed storage autoscaling; TLS encryption in transit and KMS encryption at rest.
   - *Cons:* Higher managed service cost compared to raw compute.

## Decision Outcome
We adopted **AWS RDS MySQL (Multi-AZ for Production)**.
- Local development utilizes Docker MySQL 8.0 for parity.
- Production and staging use Terraform-managed AWS RDS instances with SSL connection enforcement (`aws-ssl-profiles`).
- Connection pooling in Node.js is constrained (`min: 2, max: 10` per container) to protect database connection limits as workers scale horizontally.

## Consequences
### Positive
- 99.95% SLA backed by AWS Multi-AZ infrastructure.
- Zero-downtime automated maintenance windows.
- Decoupled application container redeployments from database lifecycle.

### Negative / Trade-offs
- Cloud costs are higher than running raw containers.
- Each ECS replica creates a connection pool; connection counts must be tracked via the `active_connections{resource="mysql"}` Prometheus metric.
