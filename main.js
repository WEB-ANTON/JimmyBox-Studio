const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Tray, ipcMain, nativeImage, screen, dialog, Notification } = require('electron');

const { registerVmIpc } = require('./src/ipc/vm.ipc');
const { registerProjectsIpc } = require('./src/ipc/projects.ipc');
const { registerDbIpc } = require('./src/ipc/db.ipc');
const { registerHostsIpc } = require('./src/ipc/hosts.ipc');
const { registerSettingsIpc } = require('./src/ipc/settings.ipc');
const { registerPhpIpc } = require('./src/ipc/php.ipc');
const { registerCheckpointsIpc } = require('./src/ipc/checkpoints.ipc');
const projects = require('./src/core/projects/project-manager');
const hosts = require('./src/core/hosts/hosts-manager');
const vm = require('./src/core/vm/lima');
const domainAliases = require('./src/core/projects/domain-aliases');

app.setName('JimmyBox Studio');

let mainWindow = null;
let hostsTray = null;
let hostsTrayWindow = null;
let hostsTrayWindowReady = null;
let fatalMainErrorHandled = false;

const HOSTS_TRAY_WIDTH = 300;
const HOSTS_TRAY_HEIGHT = 520;

function logMain(message, error = null) {
  const line = `[${new Date().toISOString()}] ${message}${error ? `\n${error.stack || error.message || error}` : ''}\n`;
  try {
    const logPath = path.join(app.getPath('userData'), 'main.log');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, line);
  } catch (_logError) {
    // Logging must never prevent the app from starting.
  }
  console.error(line.trim());
}

process.on('uncaughtException', (error) => {
  handleFatalMainError('Uncaught exception in main process', error);
});

process.on('unhandledRejection', (reason) => {
  handleFatalMainError('Unhandled rejection in main process', reason);
});

function formatFatalMessage(error) {
  const message = error && error.message ? error.message : String(error || 'Unknown error');
  return [
    'JimmyBox Studio has hit a fatal main-process error and will close.',
    '',
    message,
    '',
    'Details were written to the main.log file.'
  ].join('\n');
}

function handleFatalMainError(label, error) {
  logMain(label, error);
  if (fatalMainErrorHandled) return;
  fatalMainErrorHandled = true;

  try {
    dialog.showErrorBox('JimmyBox Studio', formatFatalMessage(error));
  } catch (_dialogError) {
    // Logging above is the reliable fallback when a dialog cannot be shown.
  }

  setTimeout(() => {
    app.exit(1);
  }, 250);
}

function createWindow() {
  logMain('Creating main window');
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    title: 'JimmyBox Studio',
    backgroundColor: '#1a1a1c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logMain(`Renderer process gone: ${JSON.stringify(details)}`);
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logMain(`Window failed to load ${validatedURL}: ${errorCode} ${errorDescription}`);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    logMain('Main window loaded');
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      logMain(`Renderer console level ${level}: ${message} (${sourceId}:${line})`);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html')).catch((error) => {
    logMain('Could not load renderer HTML', error);
  });
}

function focusMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function notifyHostsChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('hosts:changed');
  }
}

function registerAppIpc() {
  ipcMain.handle('app:notify', (_event, payload = {}) => {
    try {
      if (!Notification.isSupported()) {
        return { success: false, message: 'System notifications are not supported.' };
      }
      const title = String(payload.title || 'JimmyBox Studio').trim() || 'JimmyBox Studio';
      const body = String(payload.body || '').trim();
      const notification = new Notification({
        title,
        body,
        silent: false
      });
      notification.show();
      return { success: true };
    } catch (error) {
      return { success: false, message: error.message };
    }
  });
}

function createTrayImage() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="18" viewBox="0 0 1 18">
    <rect width="1" height="18" fill="transparent"/>
  </svg>`;
  let image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  if (image.isEmpty()) {
    image = nativeImage.createEmpty();
  }
  image.setTemplateImage(true);
  return image;
}

async function setProjectHost(domain, enabled) {
  try {
    let ip = '127.0.0.1';
    if (enabled) {
      const ipResult = await vm.getIp();
      if (!ipResult.success) {
        return { success: false, message: ipResult.message || 'VM IP unavailable. Start the VM first.' };
      }
      ip = ipResult.ip;
    }

    const result = await hosts.setProjectEntriesEnabled(domainAliases.projectAliases(domain), enabled, ip);
    if (result.success) notifyHostsChanged();
    return result;
  } catch (error) {
    return { success: false, message: error.message };
  }
}

function createHostsTrayWindow() {
  if (hostsTrayWindow) return;

  hostsTrayWindow = new BrowserWindow({
    width: HOSTS_TRAY_WIDTH,
    height: HOSTS_TRAY_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: 'JimmyBox Hosts',
    webPreferences: {
      preload: path.join(__dirname, 'tray-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  hostsTrayWindow.on('blur', () => {
    if (hostsTrayWindow && !hostsTrayWindow.webContents.isDevToolsOpened()) {
      hostsTrayWindow.hide();
    }
  });

  hostsTrayWindow.on('closed', () => {
    hostsTrayWindow = null;
    hostsTrayWindowReady = null;
  });

  hostsTrayWindowReady = hostsTrayWindow.loadFile(path.join(__dirname, 'src', 'tray.html')).catch((error) => {
    logMain('Could not load hosts tray window', error);
  });
}

function positionHostsTrayWindow() {
  if (!hostsTray || !hostsTrayWindow) return;
  const trayBounds = hostsTray.getBounds();
  const display = screen.getDisplayNearestPoint({
    x: Math.round(trayBounds.x + trayBounds.width / 2),
    y: Math.round(trayBounds.y + trayBounds.height / 2)
  });
  const work = display.workArea;
  const x = Math.round(Math.min(
    Math.max(trayBounds.x + trayBounds.width / 2 - HOSTS_TRAY_WIDTH / 2, work.x + 8),
    work.x + work.width - HOSTS_TRAY_WIDTH - 8
  ));
  const y = Math.round(Math.min(
    Math.max(trayBounds.y + trayBounds.height + 6, work.y + 6),
    work.y + work.height - HOSTS_TRAY_HEIGHT - 8
  ));
  hostsTrayWindow.setBounds({ x, y, width: HOSTS_TRAY_WIDTH, height: HOSTS_TRAY_HEIGHT }, false);
}

async function toggleHostsTrayWindow() {
  if (!hostsTrayWindow) createHostsTrayWindow();
  if (!hostsTrayWindow) return;

  if (hostsTrayWindow.isVisible() && hostsTrayWindow.isFocused()) {
    hostsTrayWindow.hide();
    return;
  }

  await hostsTrayWindowReady;
  positionHostsTrayWindow();
  hostsTrayWindow.show();
  hostsTrayWindow.focus();
  hostsTrayWindow.webContents.send('tray:show');
}

function createHostsTray() {
  hostsTray = new Tray(createTrayImage());
  if (process.platform === 'darwin') {
    hostsTray.setTitle('JB');
  }
  hostsTray.setToolTip('JimmyBox Studio Hosts');
  hostsTray.on('click', () => toggleHostsTrayWindow());
  hostsTray.on('right-click', () => toggleHostsTrayWindow());
  createHostsTrayWindow();
  logMain('Hosts menu bar item ready (custom popover)');
}

function registerIpc() {
  registerAppIpc();
  registerVmIpc();
  registerProjectsIpc();
  registerDbIpc();
  registerHostsIpc();
  registerSettingsIpc();
  registerPhpIpc();
  registerCheckpointsIpc();
  ipcMain.handle('tray:listHostProjects', () => projects.listProjects());
  ipcMain.handle('tray:setProjectHost', (_event, domain, enabled) => setProjectHost(domain, Boolean(enabled)));
  ipcMain.handle('tray:openStudio', () => {
    focusMainWindow();
    return { success: true };
  });
  ipcMain.handle('tray:hide', () => {
    if (hostsTrayWindow) hostsTrayWindow.hide();
    return { success: true };
  });
}

app.whenReady().then(() => {
  logMain(`App ready from ${__dirname}`);
  registerIpc();
  createHostsTray();
  createWindow();

  app.on('activate', () => {
    if (!mainWindow) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
