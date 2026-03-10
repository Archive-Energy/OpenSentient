FROM node:22-slim

RUN apt-get update && apt-get install -y curl git \
    && rm -rf /var/lib/apt/lists/*

# sandbox-agent: universal HTTP/SSE adapter
RUN curl -L https://sandbox-agent.dev/install | sh

# Coding harness backends — selection via AGENTS.md config
RUN npm install -g opencode-ai@latest
RUN npm install -g @anthropic-ai/claude-code@latest
RUN npm install -g skills@latest

WORKDIR /workspace
EXPOSE 8080
EXPOSE 4096
