const { dialog } = require('electron');
const { ipcMain } = require('electron');
const settings = require('../core/settings/store');

function registerSettingsIpc() {
  ipcMain.handle('settings:get', () => settings.getSettings());
  ipcMain.handle('settings:save', (_event, payload) => settings.saveSettings(payload));
  ipcMain.handle('settings:pickDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    });

    if (result.canceled || !result.filePaths.length) {
      return { success: true, path: null };
    }

    return { success: true, path: result.filePaths[0] };
  });
}

module.exports = { registerSettingsIpc };
