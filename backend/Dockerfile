FROM python:3.13-slim

# Create a non-root user because claude-code causes permission issues when using bypassPermissions mode
# see https://github.com/anthropics/claude-code-sdk-python/issues/30
RUN groupadd -r appuser && useradd -r -g appuser -m -d /home/appuser appuser

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libpq-dev curl git wget gnupg \
    chromium chromium-sandbox chromium-driver \
    fonts-liberation ca-certificates \
    gosu docker-cli \
    xvfb x11vnc websockify x11-xserver-utils xdotool \
    libnss3 libxss1 libasound2 \
    rsync unzip zip build-essential \
    sudo openssh-client jq htop tmux vim nano iproute2 && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt-get update && \
    apt-get install -y gh && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code@2.1.44 @gongrzhe/server-gmail-autoauth-mcp @openai/codex @playwright/mcp@latest

# Install uv package manager
RUN curl -LsSf https://astral.sh/uv/install.sh | bash

COPY backend/requirements.lock .

RUN /root/.local/bin/uv pip install --system --no-cache -r requirements.lock

COPY backend/ /app/

RUN cp /app/permission_server.py /usr/local/bin/permission_server.py && \
    chmod +x /usr/local/bin/permission_server.py && \
    cp /app/start-vnc.sh /usr/local/bin/start-vnc.sh && \
    chmod +x /usr/local/bin/start-vnc.sh

RUN chown -R appuser:appuser /app && \
    chmod -R 755 /app && \
    chmod +x /app/entrypoint.sh

ENV HOME=/home/appuser
ENV CLAUDE_CONFIG_DIR=/app/storage/claude-data
ENV CLAUDE_HOME=/app/storage/claude-data
ENV CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
ENV PYTHONUNBUFFERED=1
ENV DISPLAY=:99
ENV OPENVSCODE_PORT=8765
ENV TERM=xterm-256color

RUN OPENVSCODE_VERSION="1.105.1" && \
    ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then \
        ARCH_SUFFIX="arm64"; \
    else \
        ARCH_SUFFIX="x64"; \
    fi && \
    curl -fsSL "https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v${OPENVSCODE_VERSION}/openvscode-server-v${OPENVSCODE_VERSION}-linux-${ARCH_SUFFIX}.tar.gz" | \
    tar -xz -C /tmp && \
    mv /tmp/openvscode-server-v${OPENVSCODE_VERSION}-linux-${ARCH_SUFFIX} /opt/openvscode-server && \
    ln -s /opt/openvscode-server/bin/openvscode-server /usr/local/bin/openvscode-server

RUN mkdir -p /app/storage/claude-data /app/storage/images /app/storage/pdfs /app/storage/xlsx /app/storage/chrome-profile

EXPOSE 8080 5900 6080 8765

ENTRYPOINT ["/app/entrypoint.sh"]
CMD []
