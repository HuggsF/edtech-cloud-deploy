# ADR 004: Multi-Stage Docker Builds for Lean and Secure Container Images

## Status
Accepted

## Context
Deploying Node.js applications with TypeScript requires developer tooling, compilers, test runners, and type definitions (`typescript`, `ts-jest`, `@types/*`, `eslint`). Shipping these build-time dependencies into production container images creates significant drawbacks: bloated image sizes (often 800MB - 1.2GB), increased attack surfaces with unnecessary binaries, and slower ECS cold start pull times during auto-scaling events.

## Decision Drivers
- **Auto-Scaling Pull Latency:** Smaller images pull faster to Fargate nodes, accelerating scale-out responsiveness.
- **Security & Attack Surface Reduction:** Zero developer tooling, compilers, or test libraries in the production image.
- **Principle of Least Privilege:** Execution as non-root user `node`.

## Considered Options
1. **Single-Stage Docker Image**
   - *Pros:* Simple Dockerfile with a single `FROM` instruction.
   - *Cons:* Huge image size; `devDependencies` present in production; build tools and source TypeScript files left on disk; elevated CVE scan vulnerability count.
2. **Multi-Stage Docker Build (`builder` + `production` on Alpine Linux)**
   - *Pros:* Build stage installs all dependencies and compiles TypeScript to JavaScript in `/app/dist`; production stage starts from clean `node:22-alpine`, copies only compiled code and production dependencies pruned via `npm prune --omit=dev`.
   - *Cons:* Slightly longer initial build time; requires careful file copying across stages.

## Decision Outcome
We adopted **Multi-Stage Docker Builds on `node:22-alpine`**.
- **Stage 1 (`builder`):** Installs all dependencies via `npm ci`, compiles TypeScript via `npm run build`, and prunes devDependencies.
- **Stage 2 (`production`):** Copies `/app/dist` and pruned `/app/node_modules`, creates non-root execution context (`USER node`), configures healthcheck and default entrypoint.
- Resulting production image size is compressed down to ~120MB.

## Consequences
### Positive
- Image pull latency on ECS Fargate reduced from ~45 seconds to <8 seconds, drastically improving queue autoscaling speed.
- Passes security scanners (Trivy, AWS ECR Enhanced Scanning) with zero critical vulnerabilities from dev tools.
- Non-root execution prevents container breakout privileges.

### Negative / Trade-offs
- Docker layer caching must be structured properly (copying `package*.json` before source code) to ensure optimal caching during CI builds.
