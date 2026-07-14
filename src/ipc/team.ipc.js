const { ipcMain } = require('electron');
const team = require('../core/team/team-client');
const sync = require('../core/team/team-sync');
const tunnel = require('../core/team/ssh-tunnel');

function registerTeamIpc() {
  ipcMain.handle('team:status', () => team.status());
  ipcMain.handle('team:listProjects', () => team.listProjects());
  ipcMain.handle('team:listUsers', () => team.listUsers());
  ipcMain.handle('team:createUser', (_event, payload) => team.createUser(payload));
  ipcMain.handle('team:deleteHubProject', (_event, domain) => team.deleteHubProject(domain));
  ipcMain.handle('team:disableUser', (_event, userId) => team.disableUser(userId));
  ipcMain.handle('team:enableUser', (_event, userId) => team.enableUser(userId));
  ipcMain.handle('team:rotateUserToken', (_event, userId) => team.rotateUserToken(userId));
  ipcMain.handle('team:deleteUser', (_event, userId) => team.deleteUser(userId));
  ipcMain.handle('team:getProject', (_event, domain) => team.getProject(domain));
  ipcMain.handle('team:setProjectMembers', (_event, domain, members) => team.setProjectMembers(domain, members));
  ipcMain.handle('team:handoverProject', (_event, domain, toUserId) => team.handoverProject(domain, toUserId));
  ipcMain.handle('team:reserve', (_event, domain, opts) => team.reserveProject(domain, opts));
  ipcMain.handle('team:heartbeat', (_event, domain, ttlMinutes) => team.heartbeatProject(domain, ttlMinutes));
  ipcMain.handle('team:previewCapabilities', () => team.previewCapabilities());
  ipcMain.handle('team:previewSlots', () => team.previewSlots());
  ipcMain.handle('team:createPreview', (_event, domain, opts) => team.createPreview(domain, opts));
  ipcMain.handle('team:listPreviews', (_event, domain) => team.listPreviews(domain));
  ipcMain.handle('team:rotatePreviewPassword', (_event, domain, slot) => team.rotatePreviewPassword(domain, slot));
  ipcMain.handle('team:deletePreview', (_event, domain, slot) => team.deletePreview(domain, slot));
  ipcMain.handle('team:importPreview', (_event, domain, slot) => team.importPreview(domain, slot));
  ipcMain.handle('team:release', (_event, domain) => sync.releaseProject(domain));
  ipcMain.handle('team:sync', (_event, domain) => sync.syncProject(domain));
  ipcMain.handle('team:syncLocalCheckpoints', (_event, domain) => sync.syncLocalCheckpoints(domain));
  ipcMain.handle('team:checkout', (_event, domain, opts) => sync.checkoutProject(domain, opts));
  ipcMain.handle('team:pushProject', (_event, domain) => sync.pushLocalProject(domain));
  ipcMain.handle('team:pullDatabase', (_event, domain) => sync.pullDatabase(domain));
  ipcMain.handle('team:pushDatabase', (_event, domain) => sync.pushDatabase(domain));
  ipcMain.handle('team:pullMedia', (_event, domain) => sync.pullMedia(domain));
  ipcMain.handle('team:pushMedia', (_event, domain) => sync.pushMedia(domain));
  ipcMain.handle('team:tunnelStatus', () => tunnel.status());
  ipcMain.handle('team:startTunnel', () => tunnel.startTunnel());
  ipcMain.handle('team:stopTunnel', () => tunnel.stopTunnel());
}

module.exports = { registerTeamIpc };
