const { ipcMain } = require('electron');
const hosts = require('../core/hosts/hosts-manager');

function registerHostsIpc() {
  ipcMain.handle('hosts:getModel', () => hosts.getModel());
  ipcMain.handle('hosts:apply', () => hosts.applyToSystem());

  ipcMain.handle('hosts:addGroup', (_event, name) => hosts.addGroup(name));
  ipcMain.handle('hosts:renameGroup', (_event, id, name) => hosts.renameGroup(id, name));
  ipcMain.handle('hosts:toggleGroup', (_event, id, enabled) => hosts.toggleGroup(id, enabled));
  ipcMain.handle('hosts:removeGroup', (_event, id) => hosts.removeGroup(id));

  ipcMain.handle('hosts:addEntry', (_event, groupId, ip, domain) => hosts.addEntry(groupId, ip, domain));
  ipcMain.handle('hosts:toggleEntry', (_event, id, enabled) => hosts.toggleEntry(id, enabled));
  ipcMain.handle('hosts:setProjectEntriesEnabled', (_event, domains, enabled, ip) => hosts.setProjectEntriesEnabled(domains, enabled, ip));
  ipcMain.handle('hosts:removeEntry', (_event, id) => hosts.removeEntry(id));

  ipcMain.handle('hosts:addRemote', (_event, name, url, refreshMinutes) => hosts.addRemote(name, url, refreshMinutes));
  ipcMain.handle('hosts:toggleRemote', (_event, id, enabled) => hosts.toggleRemote(id, enabled));
  ipcMain.handle('hosts:removeRemote', (_event, id) => hosts.removeRemote(id));
  ipcMain.handle('hosts:refreshRemote', (_event, id) => hosts.refreshRemote(id));
}

module.exports = { registerHostsIpc };
