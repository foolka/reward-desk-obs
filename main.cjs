const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  safeStorage,
  clipboard,
  Tray,
  Menu,
  nativeImage,
  nativeTheme,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { Store, importMedia } = require("./core/store.cjs");
const { preferences, savePreferences } = require("./core/preferences.cjs");
const { createI18n } = require("./ui/i18n.js");
const nativeI18n = createI18n();
nativeI18n.register(require("./core/native-locales.cjs"));
const tr = (source, values) => nativeI18n.t(source, values);
const { initialReward, integer, twitchFields } = require("./core/model.cjs");
const { Engine } = require("./core/engine.cjs");
const { Overlay } = require("./core/overlay.cjs");
const { Control } = require("./core/control.cjs");
const { TwitchAuth, safeError } = require("./core/twitch-auth.cjs");
const { Twitch } = require("./core/twitch.cjs");
const { ChannelRewards } = require("./core/channel-rewards.cjs");
const { RewardGroups } = require("./core/groups.cjs");
const { ObsRecovery } = require("./core/obs-control.cjs");
const { prepareObs } = require("./core/obs-setup.cjs");
const { Updates, launchInstaller } = require("./core/updates.cjs");
const {
  selectProfile,
  assertProfileLocation,
  assertProfileDatabase,
  rememberProfile,
  recordStartup,
} = require("./core/profile.cjs");
const { readRecovery, restoreMissing } = require("./core/profile-recovery.cjs");
const { startupNotice } = require("./core/startup-notice.cjs");
const test = process.argv.includes("--test-mode");
const product = require("./core/product.cjs");
const { obsPlugin, profileName } = product;
const obsParent = Number(process.argv[process.argv.indexOf("--obs-parent") + 1]);
let profileError;
try {
  if (test) selectProfile(path.join(app.getPath("appData"), obsPlugin ? "RewardDesk" : "RewardDeskOBS"), true, process.env.REWARD_DESK_TEST_DATA);
  app.setPath(
    "userData",
    selectProfile(
      path.join(app.getPath("appData"), profileName),
      test,
      process.env.REWARD_DESK_TEST_DATA,
    ),
  );
} catch (error) {
  profileError = error;
}
app.setAppUserModelId(product.appUserModelId);
const primary = profileError ? true : app.requestSingleInstanceLock();
if (!primary) app.quit();
let win,
  tray,
  store,
  engine,
  overlay,
  auth,
  twitch,
  channelRewards,
  groups,
  obsRecovery,
  updates,
  control,
  pendingUpdate,
  closing = false,
  flushing = false,
  serial = Promise.resolve();
const root = app.getPath("userData");
function privateSave(name, value) {
  if (!safeStorage.isEncryptionAvailable())
    throw Error("Защищённое хранилище Windows недоступно");
  const file = path.join(root, name);
  const data = safeStorage.encryptString(JSON.stringify(value));
  fs.writeFileSync(file + ".tmp", data);
  fs.renameSync(file + ".tmp", file);
}
function privateLoad(name) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
  } catch {
    throw Error(
      "Не удалось открыть сохранённый вход. Файл не изменён: " + name,
    );
  }
}
function snapshot() {
  return {
    version: app.getVersion(),
    preferences: preferences(store),
    rewards: store.rewards(),
    groups: groups?.list() || [],
    drafts: store.drafts(),
    media: store.all("media"),
    jobs: store
      .jobs()
      .slice(-500)
      .reverse()
      .map(({ selection, ...job }) => job),
    logs: store.logs(),
    auth: auth.view(),
    authClientId: auth.saved?.clientId || "",
    clientId: store.meta("clientId", require("./twitch-client.json").clientId),
    twitch: twitch.status,
    chat: twitch.chat.view(),
    overlay: overlay.view(),
    obsRecovery: obsRecovery?.view() || {},
    paused: store.meta("paused", false),
    dataPath: root,
    test,
    obsPlugin,
    updates: {
      ...updates?.state,
      enabled: store.meta("checkUpdates", true),
      installable: app.isPackaged && !test && !obsPlugin,
    },
  };
}
function changed() {
  if (!obsPlugin && win && !win.isDestroyed() && !closing)
    win.webContents.send("state", snapshot());
}
function show() {
  if (obsPlugin && control) { void control.openEditor(control.editorUrl()); return; }
  try { control?.assertDesktop(); }
  catch (e) { dialog.showErrorBox("Reward Desk", e.message); return; }
  win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}
function applyPreferences() {
  const value = preferences(store);
  nativeI18n.setLocale(value.language);
  nativeTheme.themeSource = value.theme;
  if (win && !win.isDestroyed())
    win.setBackgroundColor(value.theme === "dark" ? "#191c1c" : "#f5f7f7");
  if (tray)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: tr("Открыть Reward Desk"), click: show },
      { label: tr("Выход"), click: () => app.quit() },
    ]));
  return value;
}
app.on("second-instance", (_, argv) => {
  if (win && !argv.includes("--obs-plugin")) show();
});
app
  .whenReady()
  .then(async () => {
    if (!primary) return;
    if (profileError) throw profileError;
    fs.mkdirSync(root, { recursive: true });
    assertProfileLocation(root);
    assertProfileDatabase(root);
    store = new Store(root);
    applyPreferences();
    rememberProfile(root, store);
    recordStartup(root, {
      version: app.getVersion(),
      executable: process.execPath,
      store,
    });
    updates = new Updates({ current: app.getVersion(), changed });
    const { backup } = require("node:sqlite");
    const backups = path.join(root, "backups");
    fs.mkdirSync(backups, { recursive: true });
    await backup(store.db, path.join(backups, `startup-${Date.now()}.sqlite`));
    engine = new Engine(store, changed);
    auth = new TwitchAuth({
      saved: privateLoad("auth.bin"),
      save: (v) => privateSave("auth.bin", v),
      pending: privateLoad("auth-pending.bin"),
      savePending: (v) => privateSave("auth-pending.bin", v),
    });
    twitch = new Twitch({ auth, store, engine, changed });
    channelRewards = new ChannelRewards(twitch);
    groups = new RewardGroups(store, twitch);
    overlay = new Overlay({
      store,
      engine,
      account: () => auth.saved?.user.id || "",
      changed,
    });
    const port = test
      ? Number(process.env.REWARD_DESK_TEST_PORT || 0)
      : store.meta("port", product.port);
    overlay.port = port;
    try {
      await overlay.start(port);
    } catch (e) {
      overlay.error = `Порт ${port} недоступен (${e.code}). Освободите его или измените порт в подключении.`;
      store.log(overlay.error);
    }
    auth.on("change", changed);
    let obsConfig = null;
    if (!test) {
      try {
        obsConfig = privateLoad("obs-control.bin");
      } catch {
        store.log(
          "Не удалось прочитать настройки защиты OBS. Настройте подключение повторно; сохранённый файл не изменён.",
        );
      }
    }
    obsRecovery = new ObsRecovery({
      overlay,
      engine,
      store,
      changed,
      config: obsConfig,
    });
    if (!test) obsRecovery.start();
    auth.on("authorized", () => {
      if (!test) void twitch.connect();
    });
    auth.on("expired", () => {
      twitch.stop();
      changed();
    });
    const icon = path.join(__dirname, "assets/icon.png");
    win = new BrowserWindow({
      show: !obsPlugin,
      width: 1240,
      height: 860,
      minWidth: 760,
      minHeight: 560,
      title: obsPlugin ? "Reward Desk OBS" : "Reward Desk",
      frame: false,
      backgroundColor: preferences(store).theme === "dark" ? "#191c1c" : "#f5f7f7",
      icon: fs.existsSync(icon) ? icon : undefined,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        autoplayPolicy: "no-user-gesture-required",
      },
    });
    win.setMenu(null);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (e) => e.preventDefault());
    if (fs.existsSync(icon)) {
      tray = new Tray(
        nativeImage.createFromPath(icon).resize({ width: 24, height: 24 }),
      );
      tray.setToolTip(obsPlugin ? "Reward Desk OBS" : "Reward Desk");
      applyPreferences();
      tray.on("double-click", show);
    }
    win.on("close", (event) => {
      if (!closing) {
        event.preventDefault();
        app.quit();
      }
    });
    ipcMain.on("ui-preferences", (event) => {
      if (event.sender === win.webContents &&
          event.senderFrame === win.webContents.mainFrame)
        event.returnValue = preferences(store);
      else event.returnValue = null;
    });
    ipcMain.handle("command", (event, command, arg) => {
      if (
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame
      )
        throw Error("Недопустимый источник команды");
      if (command === "state") return snapshot();
      if (!["pause", "stop", "check-updates", "minimize", "tray", "quit"].includes(command))
        control?.assertDesktop();
      const pending = serial.then(() => execute(command, arg));
      serial = pending.catch(() => {});
      return pending;
    });
    ipcMain.on("stash-draft", (event, value) => {
      try {
        if (
          closing ||
          event.sender !== win.webContents ||
          event.senderFrame !== win.webContents.mainFrame
        )
          throw Error("Недопустимый источник");
        control?.assertDesktop();
        store.stashDraft(value);
        event.returnValue = { ok: true };
      } catch (error) {
        event.returnValue = { error: error.message };
      }
    });
    await win.loadFile(path.join(__dirname, obsPlugin ? "ui/service.html" : "ui/index.html"));
    if (obsPlugin) control = new Control({
      root, snapshot,
      desktopVisible: () => win.isVisible(),
      execute: (command, arg, context) => {
        const next = serial.then(() => execute(command, arg, context));
        serial = next.catch(() => {});
        return next;
      },
      stash: (value) => store.stashDraft(value),
      upload: async (id, file) => {
        const next = serial.then(() => {
          const reward = store.reward(id);
          if (!reward) throw Error("Награда не найдена");
          const media = importMedia(store, file, reward.kind);
          changed();
          return media;
        });
        serial = next.catch(() => {});
        return next;
      },
      openEditor: async (url) => {
        if (!control.editorActive()) {
          await win.webContents.executeJavaScript("window.releaseEditor()");
          win.hide();
        }
        if (!test) await shell.openExternal(url);
      },
    });
    if (control) await control.start();
    if (obsPlugin && Number.isSafeInteger(obsParent) && obsParent > 0) {
      setInterval(() => {
        try { process.kill(obsParent, 0); }
        catch (e) { if (e.code === "ESRCH") app.quit(); }
      }, 5000).unref();
    }
    if (!test) {
      auth.resume();
      void twitch.connect();
      if (store.meta("checkUpdates", true))
        setTimeout(() => {
          if (!closing) void updates.check();
        }, 3500).unref();
    }
    setInterval(changed, 3000).unref();
  })
  .catch((error) => {
    // Never open a redirected profile, even after the informational notice closes.
    try {
      if (!store) nativeI18n.setLocale(app.getLocale().split("-")[0]);
      dialog.showMessageBoxSync(startupNotice(error, { obsPlugin, tr }));
    } finally {
      app.exit(1);
    }
  });
async function execute(command, arg, context = {}) {
  if (pendingUpdate && command !== "state")
    throw Error("Приложение готовится к обновлению");
  switch (command) {
    case "preferences":
      savePreferences(store, arg);
      return applyPreferences();
    case "minimize":
      win.minimize();
      return;
    case "maximize":
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      return;
    case "tray":
      if (!tray) throw Error("Значок в трее недоступен");
      await win.webContents.executeJavaScript("window.flushLocalDraft()");
      win.hide();
      return;
    case "recover-profile": {
      await win.webContents.executeJavaScript("window.flushLocalDraft()");
      const choice = await dialog.showOpenDialog(win, {
        title: tr("Папка резервной копии Reward Desk"),
        properties: ["openDirectory"],
      });
      if (choice.canceled) return;
      const source = readRecovery(choice.filePaths[0]);
      const missing = source.rewards.filter((r) => !store.reward(r.id));
      const answer = await dialog.showMessageBox(win, {
        type: "question",
        message: tr("Восстановить локальные награды: {count}?", { count: missing.length }),
        detail:
          tr("Добавляются только отсутствующие локальные награды и их файлы. Текущие записи, вход Twitch и ссылка OBS не заменяются. Ничего не публикуется в Twitch.") + "\n\n" +
          missing.map((r) => r.title).join("\n"),
        buttons: [tr("Отмена"), tr("Восстановить")],
        defaultId: 0,
        cancelId: 0,
      });
      if (answer.response === 1) await restoreMissing(store, source);
      break;
    }
    case "check-updates":
      await updates.check();
      break;
    case "auto-updates":
      store.setMeta("checkUpdates", !!arg);
      break;
    case "install-update": {
      if (obsPlugin) throw Error("Обновление плагина устанавливается отдельным установщиком после закрытия OBS.");
      if (test || !app.isPackaged)
        throw Error("Обновление доступно только в установленной программе");
      const busy = () =>
        store
          .jobs()
          .some((j) =>
            ["queued", "playing", "attention", "settling"].includes(j.state),
          );
      if (busy())
        throw Error(
          "Сначала завершите или отмените незавершённые награды в очереди",
        );
      await win.webContents.executeJavaScript("window.flushLocalDraft()");
      const download = await updates.download(
        path.join(app.getPath("temp"), "RewardDeskUpdates"),
      );
      if (busy()) {
        updates.set({
          status: "available",
          release: updates.state.release,
          message:
            "Появились награды в очереди. Завершите их и повторите обновление.",
        });
        throw Error("Обновление отложено: очередь не пуста");
      }
      try {
        await launchInstaller(download, {
          profile: root,
          executable: process.execPath,
          pid: process.pid,
          backupRoot: path.join(
            process.env.LOCALAPPDATA,
            "RewardDeskBackups",
            "updates",
          ),
        });
        pendingUpdate = download;
        twitch.stop();
        setTimeout(() => app.quit(), 100);
      } catch (error) {
        updates.set({
          status: "available",
          release: updates.state.release,
          message: error.message,
        });
        throw error;
      }
      break;
    }
    case "channel-list":
      if (test) throw Error("Twitch отключён в тестовом режиме");
      return channelRewards.list();
    case "group-save": {
      const result = await groups.save(arg);
      changed();
      return result;
    }
    case "group-remove":
      groups.remove(arg);
      break;
    case "obs-connect": {
      if (test)
        throw Error("Подключение к настоящему OBS отключено в тестовом режиме");
      let config,
        prepared = false;
      if (arg.local) {
        const file = path.join(
          app.getPath("appData"),
          "obs-studio/plugin_config/obs-websocket/config.json",
        );
        const result = prepareObs(file, {
          running: () => {
            const { execFileSync } = require("node:child_process");
            const output = execFileSync(
              "tasklist.exe",
              ["/FI", "IMAGENAME eq obs64.exe", "/FO", "CSV", "/NH"],
              { encoding: "utf8", windowsHide: true },
            );
            return /^"obs64\.exe"/im.test(output);
          },
          backup: (raw) =>
            privateSave(`obs-before-setup-${Date.now()}.bin`, { file, raw }),
        });
        ({ config, prepared } = result);
      } else config = { port: Number(arg.port), password: arg.password };
      if (!prepared) await obsRecovery.configure(config);
      privateSave("obs-control.bin", config);
      if (prepared) obsRecovery.usePrepared(config);
      store.setMeta("obsAutoRecover", true);
      break;
    }
    case "obs-auto":
      if (arg && !obsRecovery.config)
        throw Error("Сначала подключите OBS WebSocket");
      store.setMeta("obsAutoRecover", !!arg);
      break;
    case "channel-save":
      if (test) throw Error("Twitch отключён в тестовом режиме");
      return channelRewards.save(arg);
    case "channel-dashboard": {
      const login = auth.saved?.user.login;
      if (!login || !/^[a-z0-9_]+$/i.test(login))
        throw Error("Сначала войдите через Twitch");
      await shell.openExternal(
        `https://dashboard.twitch.tv/u/${login}/viewer-rewards/channel-points/rewards`,
      );
      return;
    }
    case "new":
      store.putReward({
        ...initialReward(arg === "video" ? "video" : "audio"),
        title: tr(arg === "video" ? "Видео-награда" : "Звуковая награда"),
        createdAt: Date.now(),
      });
      break;
    case "save": {
      const prior = store.reward(arg.id);
      if (prior?.sync === "creating")
        throw Error("Сначала восстановите связь с Twitch кнопкой создания");
      if (prior?.remoteId && !test) twitch.assertOwner(prior);
      const r = twitch.chat.saveReward(arg);
      store.clearDraft(r.id);
      if (
        r.remoteId &&
        (r.sync === "pending" ||
          JSON.stringify(twitchFields(prior)) !==
            JSON.stringify(twitchFields(r)))
      ) {
        store.putReward({ ...r, sync: "pending" });
        if (!test) await twitch.publish(r.id);
      }
      break;
    }
    case "versions":
      return store.versions(arg);
    case "restore-draft": {
      store.restoreDraft(arg.id, arg.version);
      break;
    }
    case "publish":
      if (test) throw Error("Twitch отключён в тестовом режиме");
      await twitch.publish(arg);
      break;
    case "remove": {
      const r = store.reward(arg);
      if (!r) break;
      const answer = context.browser ? { response: context.confirmed ? 1 : 0 } : await dialog.showMessageBox(win, {
        type: "warning",
        message: tr(r.remoteId ? "Удалить «{title}» и её награду в Twitch?" : "Удалить «{title}»?", { title: r.title }),
        detail: tr("История и копии медиа сохранятся."),
        buttons: [tr("Отмена"), tr("Удалить")],
        defaultId: 0,
        cancelId: 0,
      });
      if (answer.response === 1) await twitch.remove(arg);
      break;
    }
    case "import": {
      const r = store.reward(arg.id);
      if (!r) throw Error("Выберите награду");
      let files = arg.paths;
      if (!files) {
        const pick = await dialog.showOpenDialog(win, {
          properties: ["openFile", "multiSelections"],
          filters: [
            {
              name: tr(r.kind === "video" ? "Видео" : "Аудио"),
              extensions:
                r.kind === "video"
                  ? ["mp4", "webm"]
                  : ["mp3", "wav", "ogg", "m4a", "flac"],
            },
          ],
        });
        files = pick.canceled ? [] : pick.filePaths;
      }
      if (!Array.isArray(files) || files.length > 200)
        throw Error("Не больше 200 файлов");
      const imported = [];
      for (const file of files) imported.push(importMedia(store, file, r.kind));
      changed();
      return imported;
    }
    case "test": {
      const r = store.reward(arg.id);
      if (!r) throw Error("Награда не найдена");
      engine.enqueue(r, null, arg.itemId || null);
      break;
    }
    case "pause":
      store.setMeta("paused", !!arg);
      break;
    case "stop": {
      const j = engine.playing();
      if (j) {
        overlay.stopPlayback();
        engine.finish(j.id, false, "Остановлено вручную");
      }
      break;
    }
    case "retry":
      engine.retry(arg);
      break;
    case "cancel":
      engine.cancel(arg);
      break;
    case "copy-url":
      clipboard.writeText(overlay.url());
      return;
    case "preview": {
      const p = new BrowserWindow({
        width: 960,
        height: 580,
        title: "Reward Desk · OBS",
        backgroundColor: "#d8dddd",
        parent: win,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          autoplayPolicy: "no-user-gesture-required",
        },
      });
      p.setMenu(null);
      p.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      p.webContents.on("will-navigate", (e) => e.preventDefault());
      await p.loadURL(overlay.url());
      return;
    }
    case "port": {
      const port = integer(arg, 1024, 65535, "Порт");
      if (port === overlay.port && !overlay.error) break;
      if (engine.playing()) throw Error("Дождитесь завершения воспроизведения");
      const next = new Overlay({
        store,
        engine,
        account: () => auth.saved?.user.id || "",
        changed,
      });
      await next.start(port);
      overlay.close();
      overlay = next;
      store.setMeta("port", port);
      break;
    }
    case "login": {
      if (test) throw Error("Twitch отключён в тестовом режиме");
      if (engine.playing()) throw Error("Дождитесь конца воспроизведения");
      twitch.stop();
      store.setMeta("clientId", arg);
      await auth.start(arg);
      if (auth.pending) await shell.openExternal(auth.pending.url);
      break;
    }
    case "cancel-login":
      auth.cancel();
      break;
    case "copy-code":
      if (auth.pending) clipboard.writeText(auth.pending.userCode);
      return;
    case "logout": {
      if (engine.playing()) throw Error("Дождитесь конца воспроизведения");
      const answer = context.browser ? { response: context.confirmed ? 1 : 0 } : await dialog.showMessageBox(win, {
        message: tr("Выйти из Twitch?"),
        detail: tr("Награды и файлы останутся в приложении."),
        buttons: [tr("Отмена"), tr("Выйти")],
        defaultId: 0,
        cancelId: 0,
      });
      if (answer.response === 1) {
        twitch.stop();
        auth.logout();
      }
      break;
    }
    case "reconnect":
      if (!test) void twitch.connect();
      break;
    case "folder":
      await shell.openPath(root);
      return;
    case "quit":
      app.quit();
      return;
    default:
      throw Error("Неизвестная команда");
  }
  changed();
  return snapshot();
}
app.on("before-quit", (event) => {
  if (closing) return;
  if (win && !win.isDestroyed() && !flushing) {
    event.preventDefault();
    flushing = true;
    serial
      .then(() => win.webContents.executeJavaScript("window.prepareExit?.()"))
      .then(() => {
        if (pendingUpdate)
          fs.writeFileSync(
            path.join(pendingUpdate.folder, "commit"),
            "install",
            { flag: "wx" },
          );
        closing = true;
        cleanup();
        app.quit();
      })
      .catch(() => {
        if (closing) {
          dialog.showErrorBox(
            "Reward Desk",
            tr("Ошибка завершения приложения. Данные профиля не заменялись. Проверьте журнал обновления."),
          );
          app.exit(1);
          return;
        }
        flushing = false;
        if (pendingUpdate) {
          pendingUpdate = null;
          updates.set({
            status: "available",
            release: updates.state.release,
            message: "Обновление отложено: не удалось сохранить черновик",
          });
          if (!test) void twitch.connect();
        }
        dialog.showErrorBox(
          "Reward Desk",
          tr("Не удалось сохранить черновик. Закрытие отменено. Нажмите «Сохранить» и повторите выход."),
        );
      });
    return;
  }
  if (flushing) {
    event.preventDefault();
    return;
  }
  closing = true;
  cleanup();
});
function cleanup() {
  control?.close();
  obsRecovery?.close();
  twitch?.close();
  auth?.dispose();
  overlay?.close();
  tray?.destroy();
  store?.close();
}
app.on("window-all-closed", () => {
  if (!tray) app.quit();
});
