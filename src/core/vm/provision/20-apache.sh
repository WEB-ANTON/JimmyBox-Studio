#!/bin/bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get install -y apache2

a2enmod rewrite ssl proxy proxy_fcgi setenvif headers

for version in 8.3 8.2 8.1 8.0 7.4; do
  if [ -f "/etc/apache2/conf-available/php${version}-fpm.conf" ]; then
    a2enconf "php${version}-fpm" || true
  fi
done

mkdir -p /var/www/_default
cat >/etc/apache2/sites-available/000-jimmybox-studio-default.conf <<'APACHE'
<VirtualHost *:80>
    ServerName jimmybox-studio.localhost
    DocumentRoot /var/www

    <Directory /var/www>
        Options Indexes FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>
</VirtualHost>
APACHE

a2dissite 000-default.conf >/dev/null 2>&1 || true
a2ensite 000-jimmybox-studio-default.conf
systemctl enable apache2
systemctl restart apache2
