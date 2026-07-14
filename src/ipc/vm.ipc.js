const { ipcMain } = require('electron');
const vm = require('../core/vm/lima');

function registerVmIpc() {
  ipcMain.handle('vm:status', () => vm.status());
  ipcMain.handle('vm:start', () => vm.start());
  ipcMain.handle('vm:stop', () => vm.stop());
  ipcMain.handle('vm:provision', () => vm.provision());
  ipcMain.handle('vm:getIp', () => vm.getIp());
  ipcMain.handle('vm:setResources', (_event, cpus, memory) => vm.setResources(cpus, memory));
}

module.exports = { registerVmIpc };
