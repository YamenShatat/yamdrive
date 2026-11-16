// yamDRIVE for Windows: the yamDRIVE website in its own window, as yamTV's Windows app. It opens
// the published site, so every new web build reaches the program by itself; Google allows the
// sign-in only from that address.
'use strict';
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SITE = 'https://yamenshatat.github.io/yamdrive/';

if (!app.requestSingleInstanceLock()) app.quit();

// Google refuses to sign in inside apps that say "Electron": look like Chrome. The mark at the
// end tells native.js it runs here (Exit closes the program).
app.userAgentFallback = app.userAgentFallback.replace(/ (Electron|yamdrive)\/\S+/gi, '') + ' yamDRIVE-desktop';

// Movies (high-quality files) were drawn by Windows on their own layer, over the player's
// controls, so moving the mouse showed nothing. Draw video with the page instead.
app.commandLine.appendSwitch('disable-direct-composition');

// Settings > Device: RAM, and the disk the program's data is on (C:).
ipcMain.handle('device', async () => {
  const s = await fs.promises.statfs(app.getPath('userData'));
  return { ramFree: os.freemem(), ramTotal: os.totalmem(), diskFree: s.bavail * s.bsize, diskTotal: s.blocks * s.bsize };
});

let win;
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1400, height: 860, minWidth: 900, minHeight: 560,
    backgroundColor: '#0b0f14', autoHideMenuBar: true, title: 'yamDRIVE',
    icon: path.join(__dirname, '..', 'icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.maximize();
  win.loadURL(SITE);
  // The Google sign-in window opens inside the program (it reports back to the page); other
  // sites open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://accounts.google.com/')) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 500, height: 680, autoHideMenuBar: true } };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
});
app.on('window-all-closed', () => app.quit());
