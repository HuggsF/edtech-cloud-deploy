# ADR 001: Stateless Containers for Elastic Horizontal Scaling

## Status
Accepted

## Context
In an educational technology platform (EdTech), asynchronous workloads vary drastically throughout the academic calendar. During enrollment deadlines, exam result publications, and bulk report exports, workload spikes can exceed normal volume by 10x to 50x.

To handle these spikes reliably without overprovisioning infrastructure, our containerized workers must be able to scale horizontally (from 2 up to 50+ replicas) on AWS ECS/Fargate within minutes.

## Decision Drivers
- **Horizontal Elasticity:** Workers must start and stop independently without data loss or coordination overhead.
- **Fault Tolerance:** If a worker node or container crashes unexpectedly, another worker must seamlessly resume work.
- **Resource Efficiency:** Containers should consume minimal idle resources.

## Considered Options
1. **Stateful Containers with Local Storage (Volume Mounts / Local SQLite / In-Memory State)**
   - *Pros:* Fast local reads, simpler state tracking per node.
   - *Cons:* Containers cannot scale dynamically across AZs; loss of container implies loss of in-flight work or complex volume re-attachment; prevents Fargate spot usage.
2. **Stateless Containers with Centralized Broker (RabbitMQ) and Managed Database (RDS MySQL)**
   - *Pros:* Perfect horizontal scale-out; containers can be destroyed at will; zero local persistence dependence; fully compatible with ECS Fargate and multi-AZ deployments.
   - *Cons:* Network hop for database and message broker calls.

## Decision Outcome
We adopted **Stateless Containers**.
- Worker containers store **no persistent state** in the local file system or process memory between message cycles.
- Every task's canonical state is persisted in MySQL (via RDS).
- Message distribution and delivery guarantees are handled by RabbitMQ with manual acknowledgments (`ack`/`nack`).

## Consequences
### Positive
- Containers can be scaled out or in dynamically by AWS Application Auto Scaling with zero state synchronization risk.
- ECS tasks can be deployed on AWS Fargate across multiple Availability Zones.
- Spot instances and automated restarts are fully resilient.

### Negative / Trade-offs
- The application relies on network connectivity to RabbitMQ and MySQL. Connection pooling and retries with exponential backoff are required.
