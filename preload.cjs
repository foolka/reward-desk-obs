const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("desk", {
  uiPreferences: ipcRenderer.sendSync("ui-preferences"),
  command: (name, arg) => ipcRenderer.invoke("command", name, arg),
  stashDraft: (value) => ipcRenderer.sendSync("stash-draft", value),
  onState: (callback) =>
    ipcRenderer.on("state", (_event, state) => callback(state)),
  filePath: (file) => webUtils.getPathForFile(file),
});
