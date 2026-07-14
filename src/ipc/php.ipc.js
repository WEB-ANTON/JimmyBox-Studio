const { ipcMain } = require('electron');
const php = require('../core/php/php-manager');

function registerPhpIpc() {
  ipcMain.handle('php:list', () => php.listVersions());
  ipcMain.handle('php:install', (_event, version) => php.installVersion(version));
}

module.exports = { registerPhpIpc };
