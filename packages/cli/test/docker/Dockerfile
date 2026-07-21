FROM node:20-alpine

# Install git, bash, and pnpm for test scripts, plus the native build toolchain
# node-gyp needs to compile node-pty (no musl/alpine prebuilds are published for it)
RUN apk add --no-cache git bash python3 make g++
RUN corepack enable && corepack prepare pnpm@latest --activate

# Create testuser with specific UID/GID for consistency
RUN addgroup -g 1001 testuser && \
    adduser -u 1001 -G testuser -h /home/testuser -D testuser

# Set up application directory (monorepo root)
WORKDIR /monorepo

# Copy package files first for dependency caching
COPY --chown=testuser:testuser package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=testuser:testuser packages/core/package.json ./packages/core/
COPY --chown=testuser:testuser packages/cli/package.json ./packages/cli/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code and built artifacts
COPY --chown=testuser:testuser packages/core/dist ./packages/core/dist
COPY --chown=testuser:testuser packages/core/src ./packages/core/src
COPY --chown=testuser:testuser packages/cli/dist ./packages/cli/dist
COPY --chown=testuser:testuser packages/cli/src ./packages/cli/src
COPY --chown=testuser:testuser packages/cli/test/docker ./packages/cli/test/docker
COPY --chown=testuser:testuser packages/cli/templates ./packages/cli/templates

# Switch to non-root user
USER testuser

# Set home directory environment variable
ENV HOME=/home/testuser

# Set working directory to CLI package
WORKDIR /monorepo/packages/cli

# Default command
CMD ["bash"]
