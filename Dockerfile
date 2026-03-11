FROM node:22-slim

RUN apt-get update && apt-get install -y curl git \
    && rm -rf /var/lib/apt/lists/*

# sandbox-agent: universal HTTP/SSE adapter
RUN curl -L https://sandbox-agent.dev/install | sh

# Coding harness backends — selection via AGENTS.md config
RUN npm install -g opencode-ai@latest
RUN npm install -g @anthropic-ai/claude-code@latest
RUN npm install -g skills@latest

# Python data layer (for sandbox dataset operations)
RUN apt-get update && apt-get install -y python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m pip install --break-system-packages \
    datasets huggingface_hub pandas pyarrow requests

WORKDIR /workspace
EXPOSE 8080
EXPOSE 4096
