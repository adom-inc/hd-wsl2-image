# Golden WSL2 rootfs for Hydrogen Desktop's WslDistroRuntime.
#
# Successor to hydrogen-desktop/wsl-thin: instead of a bare Ubuntu tarball
# plus an install-time bootstrap (apt + code-server from GitHub + wiki CLIs,
# all on the user's machine), everything install-time-flaky is baked here at
# BUILD time. `wsl --import` of the exported rootfs yields a workspace where
# code-server starts in seconds with the Adom CLIs already on PATH.
#
# Parity note: the apt baseline mirrors hydrogen-desktop/docker/Dockerfile
# (the cloud hydrogen-workspace image) — same Ubuntu 24.04 / glibc 2.39,
# same toolchain — so any binary built in the cloud container runs here.
#
# NOT baked (by design):
#   - gallia (private repo; changes daily) — first-run/update concern
#   - per-user state (Carbon API key, wiki token, agents) — per-machine
#   - host.docker.internal alias — written per boot by init-host-internal.sh

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ARG CODE_SERVER_VERSION=4.112.0
ARG GOLDEN_VERSION=dev
ARG WIKI_BASE=https://wiki-ufypy5dpx93o.adom.cloud

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    wget \
    git \
    jq \
    unzip \
    zip \
    tar \
    gnupg \
    openssh-client \
    sudo \
    locales \
    build-essential \
    cmake \
    pkg-config \
    libssl-dev \
    nodejs \
    npm \
    python3 \
    python3-pip \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       | gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && curl -fsSL "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server_${CODE_SERVER_VERSION}_$(dpkg --print-architecture).deb" \
       -o /tmp/code-server.deb \
    && dpkg -i /tmp/code-server.deb \
    && sed -i 's/# en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen \
    && locale-gen \
    && rm -f /tmp/code-server.deb \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

ENV LANG=en_US.UTF-8 \
    LC_ALL=en_US.UTF-8

# Mirror the cloud container's user/group IDs so any tool that hardcodes
# 1001:1001 behaves identically.
RUN groupadd -g 1001 adom \
    && useradd -m -u 1001 -g 1001 -s /bin/bash adom \
    && echo "adom ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers.d/adom \
    && chmod 0440 /etc/sudoers.d/adom \
    && mkdir -p /home/adom/project \
    && chown adom:adom /home/adom/project

# Adom CLIs from the public wiki static path — the same URLs install.mjs
# uses as its no-auth fallback. Baking them removes the wiki round-trips
# from first run; the bootstrap updater reconciles to latest afterwards.
RUN set -eux; \
    curl -fsSL "${WIKI_BASE}/static/skills/adom-cli/adom-cli" -o /usr/local/bin/adom-cli; \
    for b in adom-wiki adom-vscode adom-mouser adom-digikey adom-jlcpcb adom-parts-search adom-gchat; do \
        curl -fsSL "${WIKI_BASE}/static/apps/${b}/${b}" -o "/usr/local/bin/${b}"; \
    done; \
    chmod 0755 /usr/local/bin/adom-cli /usr/local/bin/adom-wiki /usr/local/bin/adom-vscode \
        /usr/local/bin/adom-mouser /usr/local/bin/adom-digikey /usr/local/bin/adom-jlcpcb \
        /usr/local/bin/adom-parts-search /usr/local/bin/adom-gchat

COPY wsl.conf /etc/wsl.conf
COPY init-host-internal.sh /etc/init-host-internal.sh
COPY bootstrap.sh /opt/adom/bootstrap.sh
RUN chmod +x /etc/init-host-internal.sh /opt/adom/bootstrap.sh \
    && chown -R adom:adom /opt/adom

# gallia + HD skills, staged into the build context by CI:
#   gallia/    — adom-inc/gallia working tree, .git ALREADY STRIPPED (the
#                public image must not carry the private remote or require
#                GitHub auth; scripts/build-rootfs.sh tars the local clone
#                with --exclude=.git instead)
#   hd-skills/ — hydrogen-desktop/skills/public-facing/{shared,wsl2}
COPY --chown=adom:adom gallia /home/adom/gallia
COPY hd-skills /tmp/hd-skills

# bake-hd-setup.sh pre-runs HD's setup cascade (gallia npm + install.mjs,
# claude CLI, Claude Code + adom-vscode extensions, VS Code settings +
# trusted domains, HD skills, adom-desktop CLI) — shared verbatim with
# scripts/build-rootfs.sh. public-scrub.sh then removes the gallia
# stale-detector hook (30-min git fetch against the private repo) and
# other GitHub-auth assumptions; updates arrive as new image versions,
# not git pulls.
USER root
COPY bake-hd-setup.sh /tmp/bake-hd-setup.sh
RUN bash /tmp/bake-hd-setup.sh && rm -f /tmp/bake-hd-setup.sh

COPY public-scrub.sh /tmp/public-scrub.sh
RUN bash /tmp/public-scrub.sh && rm -f /tmp/public-scrub.sh

# Phase A of the legacy bootstrap (apt baseline + code-server) is fully baked
# above — write its sentinel so any older bootstrap.sh that still checks it
# skips cleanly. /etc/adom-golden-version is for diagnostics + HD's tarball
# migration logic.
USER root
RUN mkdir -p /var/lib/adom-bootstrap \
    && date -Iseconds > /var/lib/adom-bootstrap/phase-a-done \
    && echo "${GOLDEN_VERSION}" > /etc/adom-golden-version

USER adom
WORKDIR /home/adom

EXPOSE 8080

# Never `docker run` in production — the rootfs is exported for `wsl --import`.
# The CMD documents the entrypoint HD starts inside the distro.
CMD ["code-server", "--bind-addr", "0.0.0.0:8080", "--auth", "none", \
     "--disable-telemetry", "--disable-update-check", "/home/adom/project"]
