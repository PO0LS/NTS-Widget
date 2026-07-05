const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nts", {
  openUrl: (url) => ipcRenderer.invoke("open-url", url),
  setTrayTitle: (title) => ipcRenderer.send("set-tray-title", title),
  onTogglePlayShortcut: (callback) => ipcRenderer.on("toggle-play-shortcut", callback),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  setPinnedToDesktop: (state) => ipcRenderer.send("set-pinned-to-desktop", state),
  setLaunchAtLogin: (state) => ipcRenderer.send("set-launch-at-login", state),
  setShowInDock: (state) => ipcRenderer.send("set-show-in-dock", state),
  onSettingsChanged: (callback) => ipcRenderer.on("settings-changed", (event, settings) => callback(settings)),
  quitApp: () => ipcRenderer.send("quit-app"),
  onPlayChannel: (callback) => ipcRenderer.on("play-channel", (event, channel) => callback(channel)),
  onOpenSettings: (callback) => ipcRenderer.on("open-settings", callback),
  setPlayingChannel: (channel) => ipcRenderer.send("playing-channel-changed", channel),
});
