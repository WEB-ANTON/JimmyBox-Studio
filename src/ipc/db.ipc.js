const { dialog, ipcMain, shell } = require('electron');
const db = require('../core/db/db-manager');

function registerDbIpc() {
  ipcMain.handle('db:list', () => db.listDatabases());
  ipcMain.handle('db:listTables', (_event, dbName) => db.listTables(dbName));
  ipcMain.handle('db:create', (_event, name) => db.createDatabase(name));
  ipcMain.handle('db:drop', (_event, name) => db.dropDatabase(name));
  ipcMain.handle('db:export', async (_event, opts) => {
    const raw = opts || {};
    const safeName = String(raw.dbName || 'database').replace(/[^A-Za-z0-9_]/g, '_') || 'database';
    const gzip = Boolean(raw.gzip);
    const result = await dialog.showSaveDialog({
      title: 'Export Database',
      defaultPath: db.exportFileName(safeName, gzip),
      filters: gzip
        ? [{ name: 'Gzipped SQL', extensions: ['gz'] }]
        : [{ name: 'SQL', extensions: ['sql'] }]
    });

    if (result.canceled || !result.filePath) {
      return {
        success: true,
        message: 'Export canceled.'
      };
    }

    return db.exportDatabase({
      ...raw,
      destinationPath: result.filePath
    });
  });
  ipcMain.handle('db:import', async (_event, opts) => {
    const raw = opts || {};
    const result = await dialog.showOpenDialog({
      title: 'Import Database',
      properties: ['openFile'],
      filters: [
        { name: 'SQL Dumps', extensions: ['sql', 'gz'] }
      ]
    });

    if (result.canceled || !result.filePaths.length) {
      return {
        success: true,
        message: 'Import canceled.'
      };
    }

    return db.importDatabase({
      ...raw,
      sourcePath: result.filePaths[0]
    });
  });
  ipcMain.handle('db:query', (_event, dbName, sql) => db.query(dbName, sql));
  ipcMain.handle('db:phpMyAdminUrl', () => db.phpMyAdminUrl());
  ipcMain.handle('db:openPhpMyAdmin', async () => {
    const result = await db.phpMyAdminUrl();
    if (!result.success) return result;
    await shell.openExternal(result.url);
    return { ...result, message: 'phpMyAdmin opened.' };
  });
}

module.exports = { registerDbIpc };
