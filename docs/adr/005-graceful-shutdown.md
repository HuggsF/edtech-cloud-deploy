# ADR 005: Graceful Shutdown with In-Flight Message Draining

## Status
Accepted

## Context
When AWS Application Auto Scaling scales in (terminates worker tasks because the queue has emptied) or during zero-downtime rolling deployments, ECS sends a `SIGTERM` signal to the container, waits for the configured `stopTimeout` (e.g. 60 seconds), and subsequently issues `SIGKILL`.

If a message queue worker process terminates abruptly upon `SIGTERM`:
1. In-flight messages that were halfway through processing (e.g., generating a certificate, sending an email) are abruptly severed.
2. Database transactions might be left dangling or rolling back.
3. Unacknowledged messages in RabbitMQ will eventually be redelivered, causing duplicate processing, potential double-billing, or race conditions.

## Decision Drivers
- **At-Least-Once Delivery with Idempotency:** Prevent severed in-flight operations during autoscaling scale-in.
- **Ordered Teardown:** Stop accepting new messages immediately, finish currently active tasks within a deadline, then cleanly close network sockets.
- **Predictable Exit:** Guarantee container exits cleanly before ECS `stopTimeout` triggers `SIGKILL`.

## Considered Options
1. **Immediate Termination on SIGTERM (`process.exit(0)`)**
   - *Pros:* Simple to write.
   - *Cons:* Causes message corruption, unacknowledged redelivery storms, and interrupted network sockets.
2. **Coordinated Multi-Step Graceful Shutdown with In-Flight Tracker (`InFlightTracker`)**
   - *Pros:*
     - Step 1: Stop consuming (`channel.cancel`) so no new messages enter the worker.
     - Step 2: Mark HTTP readiness/health check as degraded (`503 Shutting Down`) so load balancers stop sending traffic.
     - Step 3: Wait for in-flight tasks to complete, bounded by `SHUTDOWN_DRAIN_TIMEOUT_MS` (e.g., 30s).
     - Step 4: Close message broker channels and connection (`broker.close()`). Any un-acked messages return cleanly to the queue.
     - Step 5: Close MySQL pool (`db.destroy()`).
     - Step 6: Clean exit with code 0.
   - *Cons:* Requires lifecycle coordination and in-flight tracking state machine.

## Decision Outcome
We adopted **Coordinated Multi-Step Graceful Shutdown**.
- Implemented `InFlightTracker` to register active tasks by ID and resolve once the count reaches 0.
- Implemented `WorkerRuntime` and `registerGracefulShutdown` listening to both `SIGTERM` and `SIGINT`.
- Hard shutdown deadline is set to `45,000ms`, safely below the ECS task definition `stopTimeout: 60s`.

## Consequences
### Positive
- Zero aborted tasks during ECS scale-in events.
- Zero duplicate certificate generations or partially written reports during autoscaling.
- Clean resource deallocation without leaking MySQL connection handles or RabbitMQ channels.

### Negative / Trade-offs
- Task processing per attempt must be designed to finish within the drain window (tasks exceeding 30s should be split into smaller idempotent chunks).
