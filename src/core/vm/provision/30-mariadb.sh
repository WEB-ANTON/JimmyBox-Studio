#!/bin/bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get install -y mariadb-server
systemctl enable mariadb
systemctl start mariadb

if mysql -uroot -proot -e "SELECT 1" >/dev/null 2>&1; then
  MYSQL_ROOT=(mysql -uroot -proot)
else
  MYSQL_ROOT=(mysql --protocol=socket)
fi

"${MYSQL_ROOT[@]}" <<'SQL'
CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY 'root';
GRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION;
ALTER USER 'root'@'localhost' IDENTIFIED BY 'root';
FLUSH PRIVILEGES;
SQL
