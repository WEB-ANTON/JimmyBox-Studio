# MANAGED BY JIMMYBOX STUDIO
<VirtualHost *:80>
    ServerName ${DOMAIN}
${SERVER_ALIASES}
    DocumentRoot /var/www/sites/${PROJECT_DIR}/${DOCROOT}

    <Directory /var/www/sites/${PROJECT_DIR}/${DOCROOT}>
        Options Indexes FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    RewriteEngine On
    RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=302,L]

    ErrorLog ${APACHE_LOG_DIR}/${DOMAIN}-error.log
    CustomLog ${APACHE_LOG_DIR}/${DOMAIN}-access.log combined
</VirtualHost>

<VirtualHost *:443>
    ServerName ${DOMAIN}
${SERVER_ALIASES}
    DocumentRoot /var/www/sites/${PROJECT_DIR}/${DOCROOT}

    SSLEngine on
    SSLCertificateFile /var/www/sites/${PROJECT_DIR}/.jimmybox-studio/ssl/${DOMAIN}.crt
    SSLCertificateKeyFile /var/www/sites/${PROJECT_DIR}/.jimmybox-studio/ssl/${DOMAIN}.key

    <Directory /var/www/sites/${PROJECT_DIR}/${DOCROOT}>
        Options Indexes FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    <FilesMatch "\.php$">
        SetHandler "proxy:unix:${PHP_SOCK}|fcgi://localhost/"
    </FilesMatch>

    ErrorLog ${APACHE_LOG_DIR}/${DOMAIN}-ssl-error.log
    CustomLog ${APACHE_LOG_DIR}/${DOMAIN}-ssl-access.log combined
</VirtualHost>
