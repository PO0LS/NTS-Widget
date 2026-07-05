const { app, BrowserWindow, Tray, Menu, screen, ipcMain, shell, globalShortcut, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");

let win, tray, trayIcon, emptyIcon;

const settingsPath = path.join(app.getPath("userData"), "settings.json");

function loadPersistedSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    return {};
  }
}

function savePersistedSettings() {
  fs.writeFileSync(settingsPath, JSON.stringify({ pinnedToDesktop, showInDock }));
}

const persisted = loadPersistedSettings();

// "desktop" window level sits below the Finder desktop-icon click layer, so
// it can't be dragged or resized there — default to a normal floating
// window (fully interactive); "Pin to Desktop" trades that away for sitting
// behind other windows.
let pinnedToDesktop = persisted.pinnedToDesktop || false;
// Mirrored from the renderer so the tray menu can checkmark the right station.
let playingChannel = null;
let showInDock = persisted.showInDock !== undefined ? persisted.showInDock : true;

function createWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: 480,
    height: 556,
    minWidth: 360,
    minHeight: 360,
    x: width - 520,
    y: 40,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setResizable(!pinnedToDesktop);
  win.setMovable(!pinnedToDesktop);
  win.setAlwaysOnTop(true, pinnedToDesktop ? "desktop" : "floating");

  win.loadFile("renderer/index.html");
}

function getSettings() {
  return {
    pinnedToDesktop,
    launchAtLogin: app.getLoginItemSettings().openAtLogin,
    // In dev (unpackaged) mode, setLoginItemSettings registers the generic
    // Electron.app binary rather than this app — meaningless/harmful outside
    // a real packaged build, so the toggle is disabled until packaged.
    launchAtLoginAvailable: app.isPackaged,
    showInDock,
  };
}

function broadcastSettings() {
  if (win) win.webContents.send("settings-changed", getSettings());
  if (rebuildMenu) rebuildMenu();
}

function setPinnedToDesktop(state) {
  pinnedToDesktop = state;
  win.setResizable(!state);
  win.setMovable(!state);
  win.setAlwaysOnTop(true, state ? "desktop" : "floating");
  savePersistedSettings();
  broadcastSettings();
}

function setLaunchAtLogin(state) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: state });
  broadcastSettings();
}

function setShowInDock(state) {
  showInDock = state;
  if (state) app.dock.show();
  else app.dock.hide();
  savePersistedSettings();
  broadcastSettings();
}

let rebuildMenu;

ipcMain.handle("open-url", (event, url) => shell.openExternal(url));
ipcMain.on("set-tray-title", (event, title) => {
  if (!tray) return;
  // fontType: "monospaced" is the closest macOS's Tray API gets to matching
  // the app's own mono aesthetic — no custom font, size, or opacity control
  // is exposed for menu bar text (a system-wide restriction on all tray icons).
  tray.setTitle(title || "", { fontType: "monospaced" });
  // Hide the logo while the station title is showing so it's just text;
  // restore it when nothing's playing so there's still something to click.
  tray.setImage(title ? emptyIcon : trayIcon);
});
ipcMain.handle("get-settings", () => getSettings());
ipcMain.on("set-pinned-to-desktop", (event, state) => setPinnedToDesktop(state));
ipcMain.on("set-launch-at-login", (event, state) => setLaunchAtLogin(state));
ipcMain.on("set-show-in-dock", (event, state) => setShowInDock(state));
ipcMain.on("quit-app", () => app.quit());
ipcMain.on("playing-channel-changed", (event, channel) => {
  playingChannel = channel;
  if (rebuildMenu) rebuildMenu();
});

app.whenReady().then(() => {
  createWindow();
  if (!showInDock) app.dock.hide();

  trayIcon = nativeImage.createFromPath(path.join(__dirname, "menubar-icon.png"));
  trayIcon.setTemplateImage(true);
  emptyIcon = nativeImage.createEmpty();
  tray = new Tray(trayIcon);

  rebuildMenu = () => {
    const menu = Menu.buildFromTemplate([
      { label: "Show/Hide", click: () => (win.isVisible() ? win.hide() : win.show()) },
      { type: "separator" },
      {
        label: "NTS 1",
        type: "checkbox",
        checked: playingChannel === "1",
        click: () => win.webContents.send("play-channel", "1"),
      },
      {
        label: "NTS 2",
        type: "checkbox",
        checked: playingChannel === "2",
        click: () => win.webContents.send("play-channel", "2"),
      },
      { type: "separator" },
      {
        label: "Settings...",
        click: () => {
          win.show();
          win.webContents.send("open-settings");
        },
      },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]);
    tray.setContextMenu(menu);
  };
  rebuildMenu();

  // Media-key play/pause toggles playback in the renderer without needing
  // the widget focused.
  globalShortcut.register("MediaPlayPause", () => {
    win.webContents.send("toggle-play-shortcut");
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", (e) => e.preventDefault());
