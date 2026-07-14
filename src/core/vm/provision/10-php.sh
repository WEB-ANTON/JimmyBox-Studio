#!/bin/bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

if ! grep -R "ppa.launchpadcontent.net/ondrej/php" /etc/apt/sources.list /etc/apt/sources.list.d >/dev/null 2>&1; then
  add-apt-repository -y ppa:ondrej/php
fi

apt-get update

for version in 8.3 8.2 8.1 8.0 7.4; do
  apt-get install -y \
    "php${version}" \
    "php${version}-cli" \
    "php${version}-bcmath" \
    "php${version}-common" \
    "php${version}-curl" \
    "php${version}-fpm" \
    "php${version}-gd" \
    "php${version}-intl" \
    "php${version}-mbstring" \
    "php${version}-mysql" \
    "php${version}-opcache" \
    "php${version}-soap" \
    "php${version}-xml" \
    "php${version}-zip"

  systemctl enable "php${version}-fpm"
  systemctl restart "php${version}-fpm"
done

apt-get install -y composer
