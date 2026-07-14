#!/bin/bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y \
  apt-transport-https \
  ca-certificates \
  curl \
  gnupg \
  lsb-release \
  openssl \
  software-properties-common \
  unzip

systemctl enable redis-server >/dev/null 2>&1 || true
apt-get install -y redis-server
