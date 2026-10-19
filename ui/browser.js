(() => {
  document.documentElement.classList.add("browser-editor");
  addEventListener("DOMContentLoaded", () => {
    document.title = "Reward Desk OBS";
    document.querySelector(".brand h1").textContent = "Reward Desk OBS";
  }, { once: true });
  const key = location.hash.slice(1) || sessionStorage.getItem("editor-key") || "";
  sessionStorage.setItem("editor-key", key);
  history.replaceState(null, "", location.pathname);
  const editor = crypto.randomUUID();
  const headers = { Authorization: `Bearer ${key}`, "X-Reward-Editor": editor };
  let state, lastDraft, leaving = false, blocked = false, listener;
  function sync(route, value) {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", route, false);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send(JSON.stringify(value));
    const body = JSON.parse(xhr.responseText || "{}");
    if (xhr.status !== 200) throw Error(body.error || "Reward Desk недоступен");
    return body;
  }
  function failure(message) {
    blocked = true;
    const render = () => {
      let panel = document.querySelector("#browser-disconnected");
      if (!panel) {
        panel = document.createElement("div");
        panel.id = "browser-disconnected";
        panel.setAttribute("role", "alert");
        document.body.append(panel);
      }
      panel.textContent = message;
      for (const el of document.body.children) if (el !== panel && el.tagName !== "SCRIPT") el.inert = true;
    };
    if (document.body) render(); else addEventListener("DOMContentLoaded", render, { once: true });
  }
  async function request(route, value, extra = {}) {
    if (blocked) throw Error("Откройте редактор заново из панели OBS");
    const response = await fetch(route, { method: value === undefined ? "GET" : "POST",
      headers: { ...headers, ...(value === undefined ? {} : { "Content-Type": "application/json" }) },
      body: value === undefined ? undefined : JSON.stringify(value), ...extra });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "Reward Desk недоступен");
    return result;
  }
  function chooseFiles() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file"; input.multiple = true;
      input.accept = ".mp4,.webm,.mp3,.wav,.ogg,.m4a,.flac";
      input.addEventListener("change", () => resolve([...input.files]), { once: true });
      input.addEventListener("cancel", () => resolve([]), { once: true });
      input.click();
    });
  }
  try { state = sync("/api/claim", {}); }
  catch (e) { failure(e.message + " Откройте редактор кнопкой в панели Reward Desk в OBS."); }
  window.desk = {
    browser: true,
    uiPreferences: state?.preferences || {},
    filePath: (file) => file,
    stashDraft(value) {
      lastDraft = value;
      if (leaving) return { ok: true };
      try { return sync("/api/draft", value); }
      catch (e) { failure(e.message); return { error: e.message }; }
    },
    onState(callback) { listener = callback; },
    async command(command, arg) {
      if (command === "state") { state = await request("/api/state"); return state; }
      if (command === "copy-url") return navigator.clipboard.writeText(state.overlay.url);
      if (command === "copy-code") return navigator.clipboard.writeText(state.auth.pending?.code || "");
      if (command === "preview") return window.open(state.overlay.url, "_blank", "noopener");
      if (command === "recover-profile") window.flushLocalDraft();
      if (["minimize", "maximize", "quit", "tray"].includes(command)) return;
      if (command === "import") {
        const files = arg.paths || await chooseFiles();
        if (files.length > 200) throw Error("Не больше 200 файлов");
        const added = [];
        for (const file of files) {
          if (!(file instanceof File) || file.size > 512 * 1024 * 1024) throw Error("Файл больше 512 МБ");
          added.push(await request(`/api/upload?id=${encodeURIComponent(arg.id)}&name=${encodeURIComponent(file.name)}`, undefined,
            { method: "POST", body: file, headers }));
        }
        state = await request("/api/state"); listener?.(state);
        return added;
      }
      let confirmed = false;
      if (["remove", "logout"].includes(command)) {
        const reward = state.rewards.find((r) => r.id === arg);
        confirmed = await window.confirmAction(command === "remove" ? tr(reward?.remoteId ? "Удалить «{title}» и её награду в Twitch?" : "Удалить «{title}»?", { title: reward?.title || "" }) : tr("Выйти из Twitch?"));
        if (!confirmed) return state;
      }
      const result = await request("/api/command", { command, arg, confirmed });
      if (["save", "remove"].includes(command)) lastDraft = null;
      if (result?.rewards) state = result;
      return result;
    },
  };
  addEventListener("beforeunload", () => { leaving = true; }, { capture: true });
  addEventListener("pagehide", () => {
    if (blocked) return;
    navigator.sendBeacon("/api/leave", new Blob([JSON.stringify({ token: key, editor, draft: lastDraft })], { type: "application/json" }));
  });
  setInterval(async () => {
    if (blocked || leaving) return;
    try { state = await request("/api/state"); listener?.(state); }
    catch (e) { failure(e.message + " Откройте редактор заново из панели OBS."); }
  }, 3000);
})();
