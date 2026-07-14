const { ipcMain } = require('electron');
const checkpoints = require('../core/projects/checkpoints');

function registerCheckpointsIpc() {
  ipcMain.handle('checkpoints:create', (_event, payload) => checkpoints.create(payload));
  ipcMain.handle('checkpoints:list', (_event, domain) => checkpoints.list(domain));
  ipcMain.handle('checkpoints:restore', (_event, domain, id, opts) => checkpoints.restore(domain, id, opts));
  ipcMain.handle('checkpoints:diff', (_event, domain, idA, idB) => checkpoints.diff(domain, idA, idB));
  ipcMain.handle('checkpoints:setPinned', (_event, domain, id, pinned) => checkpoints.setPinned(domain, id, pinned));
  ipcMain.handle('checkpoints:delete', (_event, domain, id) => checkpoints.delete(domain, id));
}

module.exports = { registerCheckpointsIpc };
