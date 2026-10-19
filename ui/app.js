const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icon = (name) => `<i data-lucide="${name}"></i>`;
const icons = () => {
  RewardHelp.enhance();
  $$("select:not([multiple]):not([size])").forEach((select) => {
    if (select.parentElement.classList.contains("select-control")) return;
    const wrapper = document.createElement("span");
    wrapper.className = "select-control";
    if (select.style.width) {
      wrapper.style.width = select.style.width;
      select.style.width = "100%";
    }
    select.before(wrapper);
    wrapper.append(select);
    wrapper.insertAdjacentHTML(
      "beforeend",
      '<i data-lucide="chevron-down" aria-hidden="true"></i>',
    );
  });
  lucide.createIcons();
};
let state,
  selected = "",
  rewardKind = "audio",
  selectedByKind = {},
  previewItemId = "",
  draft,
  dirty = false,
  draftTimer,
  draftRevision = 0,
  exiting = false,
  toastTimer,
  saving = false,
  previewObserver;
function toast(message, values) {
  RewardI18n.text($("#toast"), message, values);
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 6500);
}
async function command(name, arg) {
  try {
    const result = await desk.command(name, arg);
    if (result?.rewards) accept(result);
    return result;
  } catch (e) {
    toast(
      e.message.replace(/^Error invoking remote method 'command': Error: /, ""),
    );
    throw e;
  }
}
function act(el, fn) {
  if (el)
    el.addEventListener("click", () =>
      Promise.resolve()
        .then(fn)
        .catch(() => {}),
    );
}
function confirmAction(message) {
  const dialog = $("#confirm-dialog");
  if (dialog.open) return Promise.resolve(false);
  $("#confirm-message").textContent = message;
  dialog.returnValue = "cancel";
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => resolve(dialog.returnValue === "accept"),
      { once: true },
    );
    dialog.showModal();
  });
}
function accept(value) {
  state = value;
  renderList();
  renderStatus();
  renderJobs();
  renderSettings();
  renderUpdates();
  renderObsRecovery();
  renderChatStatus();
  channelAccountChanged();
  if (selected && !dirty && !saving) {
    const latest = state.rewards.find((r) => r.id === selected);
    if (JSON.stringify(draft) !== JSON.stringify(latest)) {
      draft = structuredClone(latest);
      if (!draft) selected = "";
      renderEditor();
    }
  }
}
function renderList() {
  const rewards = state.rewards.filter((r) => r.kind === rewardKind);
  $("#reward-count").textContent = rewards.length;
  $$("[data-kind-tab]").forEach((button) => {
    const active = button.dataset.kindTab === rewardKind;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  const term = $("#search").value.toLowerCase();
  const filtered = rewards.filter((r) => r.title.toLowerCase().includes(term));
  const sections = [
    ...(state.groups || []),
    {
      id: "",
      name: tr("Без группы"),
      members: filtered
        .filter(
          (r) => !(state.groups || []).some((g) => g.members.includes(r.id)),
        )
        .map((r) => r.id),
    },
  ];
  $("#reward-list").innerHTML = sections
    .map((group) => {
      const items = filtered.filter((r) => group.members.includes(r.id));
      if (!items.length) return "";
      return (
        `${state.groups?.length ? `<div class="reward-group-heading"><span>${esc(group.name)}</span><span>${items.length}</span></div>` : ""}` +
        items
          .map(
            (r) =>
              `<button class="reward-item ${r.id === selected ? "active" : ""}" data-id="${r.id}"><span class="reward-swatch" style="background:${esc(r.background)}"></span>${icon(r.kind === "video" ? "film" : "audio-lines")}<div><strong>${esc(r.title)}</strong><small>${esc(tr("{points} баллов · {files} файлов · {status}", { points: r.cost.toLocaleString(RewardI18n.locale), files: r.items.length.toLocaleString(RewardI18n.locale), status: r.remoteId ? tr("Twitch") : tr("Черновик") }))}</small></div></button>`,
          )
          .join("")
      );
    })
    .join("");
  $$(".reward-item").forEach((el) => act(el, () => select(el.dataset.id)));
  icons();
}
function select(id) {
  if (saving) return;
  flushLocalDraft();
  selected = id;
  if (id) {
    rewardKind = state.rewards.find((r) => r.id === id)?.kind || rewardKind;
    selectedByKind[rewardKind] = id;
  }
  dirty = !!state.drafts?.[id];
  draft = structuredClone(
    state.drafts?.[id]?.value || state.rewards.find((r) => r.id === id),
  );
  renderEditor();
  renderList();
  draftStatus(dirty ? tr("Локальный черновик восстановлен") : tr("Сохранено"));
}
function num(key, label, min, max, step = 1, value = draft) {
  return `<label>${esc(tr(label))}<input data-field="${key}" type="number" min="${min}" max="${max}" step="${step}" value="${esc(value[key])}"></label>`;
}
function vnum(key, label, min, max) {
  return `<label>${esc(tr(label))}<input data-video="${key}" type="number" min="${min}" max="${max}" value="${esc(draft.video[key])}"></label>`;
}
function check(key, label, value = draft) {
  return `<label class="check"><input data-field="${key}" type="checkbox" ${value[key] ? "checked" : ""}>${esc(tr(label))}</label>`;
}
function limit(key, label, max, value = draft) {
  return `<label>${esc(tr(label))}<div class="limit-line"><input type="checkbox" data-limit="${key}" ${value[key] ? "checked" : ""} aria-label="${esc(tr("Включить {label}", { label: tr(label) }))}"><input data-field="${key}" type="number" min="0" max="${max}" value="${esc(value[key] || 0)}" ${value[key] ? "" : "disabled"} aria-label="${esc(tr(label))}"></div></label>`;
}
function settingsMarkup(value) {
  return `<div class="form-grid"><label>${esc(tr("Название"))}<input data-field="title" maxlength="45" value="${esc(value.title)}"></label>${num("cost", "Баллы", 1, 1000000000, 1, value)}<label>${esc(tr("Цвет"))}<input data-field="background" type="color" value="${esc(value.background)}"></label><label class="wide">${esc(tr("Описание"))}<textarea data-field="prompt" maxlength="200">${esc(value.prompt)}</textarea></label></div>
  <div class="switches">${check("enabled", "Доступна в Twitch", value)}${check("paused", "На паузе", value)}${check("input", "Сообщение зрителя", value)}</div>
  <div class="limits">${limit("streamLimit", "Лимит за эфир", 1000000000, value)}${limit("userLimit", "На одного зрителя", 1000000000, value)}${limit("cooldown", "Перезарядка, сек.", 604800, value)}</div>
  <div class="switches">${check("skipQueue", "Сразу завершать покупку в Twitch", value)}</div><div data-skip-warning class="notice" ${value.skipQueue ? "" : "hidden"}>${esc(tr("При мгновенном завершении Twitch не позволяет вернуть баллы. Покупки во время отключения приложения могут быть пропущены."))}</div>`;
}
function bindSettings(root, getValue, changed) {
  root.querySelectorAll("[data-field]").forEach((el) =>
    el.addEventListener("input", () => {
      const value = getValue();
      const scope = el.closest("#editor, #channel-form") || root;
      const toggle = scope.querySelector(`[data-limit="${el.dataset.field}"]`);
      if (toggle && !toggle.checked) {
        value[el.dataset.field] = 0;
        el.value = 0;
        return;
      }
      value[el.dataset.field] =
        el.type === "checkbox"
          ? el.checked
          : el.type === "number"
            ? Number(el.value)
            : el.value;
      if (el.dataset.field === "skipQueue")
        scope.querySelector("[data-skip-warning]").hidden = !el.checked;
      changed();
    }),
  );
  root.querySelectorAll("[data-limit]").forEach((el) =>
    el.addEventListener("change", () => {
      const value = getValue();
      const field = root.querySelector(`[data-field="${el.dataset.limit}"]`);
      field.disabled = !el.checked;
      value[el.dataset.limit] = el.checked
        ? Math.max(1, Number(field.value))
        : 0;
      field.value = value[el.dataset.limit];
      field.min = el.checked ? 1 : 0;
      changed();
    }),
  );
}
function renderEditor() {
  previewObserver?.disconnect();
  if (!draft) {
    $("#editor").innerHTML =
      `<div class="empty">${icon("gift")}<h2>${esc(tr("Выберите или создайте награду"))}</h2></div>`;
    icons();
    return;
  }
  const video = draft.kind === "video";
  const chat = draft.chat || {
    enabled: false,
    command: "",
    users: [],
    cooldown: 5,
  };
  $("#editor").innerHTML =
    `<div class="editor-head"><div class="title"><h2>${esc(draft.title)}</h2><small>${esc(draft.remoteId ? tr("Связана с Twitch") : tr("Локальный черновик"))}${draft.sync === "pending" ? " · " + esc(tr("изменения не отправлены")) : ""}</small></div><div class="button-row"><button id="test-reward">${icon("play")}${esc(tr("Тест"))}</button><button id="remove-reward" class="danger" title="${esc(tr("Удалить награду"))}">${icon("trash-2")}</button></div></div>
  ${settingsMarkup(draft)}
  <section class="editor-section chat-section"><div class="section-head"><h3>${esc(tr("Запуск через чат"))}</h3><span id="chat-status" class="muted"></span></div>
  <label class="check"><input id="chat-enabled" type="checkbox" ${chat.enabled ? "checked" : ""}>${esc(tr("Разрешить команду чата"))}</label>
  <div class="chat-fields"><label>${esc(tr("Команда"))}<input id="chat-command" maxlength="33" placeholder="${esc(tr("!video"))}" value="${esc(chat.command)}" spellcheck="false"></label><label>${esc(tr("Пауза, сек."))}<input id="chat-cooldown" type="number" min="0" max="3600" value="${chat.cooldown}"></label><label class="wide">${esc(tr("Разрешённые Twitch-ники"))}<textarea id="chat-users" rows="2" maxlength="5400" placeholder="${esc(tr("nickname1, nickname2"))}" spellcheck="false">${esc(Array.isArray(chat.users) ? chat.users.join(", ") : chat.users)}</textarea></label></div>
  <div id="chat-access" class="notice" hidden><span id="chat-access-text"></span><button id="chat-open-settings">${icon("log-in")}${esc(tr("Подключение Twitch"))}</button></div></section>
  <section class="editor-section"><div class="section-head"><h3>${esc(video ? tr("Видео") : tr("Звуки"))} <span class="muted" id="media-count"></span></h3><span class="muted" id="media-mode"></span></div><div class="roulette-options"><label class="check"><input id="allow-repeats" type="checkbox" ${draft.allowRepeats === true ? "checked" : ""} aria-describedby="roulette-help">${esc(tr("Полный рандом с повторениями"))}</label><div id="roulette-help" class="field-note"></div></div><div class="media-head" aria-hidden="true"><span>${esc(tr("Файл"))}</span><span>${esc(tr("Громкость"))}</span><span>${esc(tr("Вес"))}</span><span id="chance-heading"></span><span></span><span></span></div><div id="media-list" class="media-list"></div><div id="drop-zone" class="drop-zone"><button id="add-files">${icon("upload")}${esc(tr("Добавить файлы"))}</button><span class="formats">${esc(video ? tr("MP4 · WebM") : tr("MP3 · WAV · OGG · M4A · FLAC"))}</span></div></section>
  ${video ? `<section class="editor-section"><div class="section-head"><h3>${esc(tr("Размещение видео"))}</h3><select id="position-mode" aria-label="${esc(tr("Размещение"))}" style="width:190px"><option value="fixed">${esc(tr("Фиксированная область"))}</option><option value="random">${esc(tr("Случайное место"))}</option></select></div><div class="preview-layout"><div><div id="stage" class="stage"><div id="placement" class="placement">${icon("move")}</div></div><div class="stage-caption"><span>1920 × 1080</span><span id="coordinates"></span></div></div><div class="video-controls">${vnum("width", "Макс. ширина", 40, 1920)}${vnum("height", "Макс. высота", 40, 1080)}${vnum("x", "X", 0, 1920)}${vnum("y", "Y", 0, 1080)}${vnum("border", "Толщина рамки", 0, 40)}<label>${esc(tr("Стиль рамки"))}<select id="border-style"><option value="solid">${esc(tr("Сплошная"))}</option><option value="dashed">${esc(tr("Пунктир"))}</option><option value="dotted">${esc(tr("Точки"))}</option><option value="double">${esc(tr("Двойная"))}</option><option value="none">${esc(tr("Без рамки"))}</option></select></label>${vnum("radius", "Скругление", 0, 200)}<label>${esc(tr("Цвет рамки"))}<input type="color" id="border-color" value="${draft.video.color}"></label><label class="check wide"><input type="checkbox" id="tilt" ${draft.video.angle ? "checked" : ""}>${esc(tr("Случайный наклон"))}</label><label class="wide">${esc(tr("Максимальный угол, ±°"))}<input id="angle" type="range" min="0" max="45" value="${draft.video.angle}"><output id="angle-value">${draft.video.angle}°</output></label></div></div></section>` : ""}
  ${video ? captionMarkup() : ""}
  <div class="save-footer"><button id="save" class="primary">${icon("save")}${esc(tr("Сохранить"))}</button><button id="publish">${icon("cloud-upload")}${esc(draft.remoteId ? tr("Синхронизировать") : tr("Создать в Twitch"))}</button><button id="reward-history" title="${esc(tr("История сохранённых версий"))}" aria-label="${esc(tr("История сохранённых версий"))}">${icon("history")}</button><span id="draft-status" class="field-note" role="status"></span></div>`;
  act($("#reward-history"), showRewardHistory);
  bindSettings($("#editor"), () => draft, markDirty);
  for (const [id, key] of Object.entries({
    "chat-enabled": "enabled",
    "chat-command": "command",
    "chat-users": "users",
    "chat-cooldown": "cooldown",
  })) {
    $("#" + id).addEventListener("input", (event) => {
      draft.chat ||= { enabled: false, command: "", users: [], cooldown: 5 };
      const el = event.target;
      draft.chat[key] =
        el.type === "checkbox"
          ? el.checked
          : el.type === "number"
            ? Number(el.value)
            : el.value;
      markDirty();
      renderChatStatus();
    });
  }
  act($("#chat-open-settings"), () => $("[data-tab=settings]").click());
  renderChatStatus();
  $("#allow-repeats").addEventListener("change", (event) => {
    draft.allowRepeats = event.target.checked;
    markDirty();
    percentages();
  });
  act($("#save"), save);
  act($("#publish"), async () => {
    if (draft.sync !== "creating") await save();
    await command("publish", selected);
    select(selected);
    toast("Награда синхронизирована");
  });
  act($("#remove-reward"), async () => {
    flushLocalDraft();
    await command("remove", selected);
    if (!state.rewards.some((r) => r.id === selected)) {
      selected = "";
      draft = null;
      dirty = false;
      renderEditor();
    }
  });
  act($("#test-reward"), async () => {
    await save();
    await command("test", { id: selected });
    toast("Добавлено в очередь OBS");
  });
  act($("#add-files"), () => addFiles());
  const drop = $("#drop-zone");
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("drag");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("drag");
    void addFiles([...e.dataTransfer.files].map((f) => desk.filePath(f))).catch(
      () => {},
    );
  });
  if (video) bindVideo();
  renderMedia();
  icons();
}
function renderChatStatus() {
  if (!$("#chat-status") || !draft) return;
  const enabled = !!draft.chat?.enabled;
  $(".chat-fields").hidden = !enabled;
  $("#chat-status").textContent = enabled
    ? tr(state.chat?.status || "Чат не подключён")
    : tr("Выключено");
  for (const id of ["chat-command", "chat-users", "chat-cooldown"])
    $("#" + id).disabled = !enabled;
  const otherAccount =
    draft.chatAccount &&
    (draft.chatAccount !== state.auth.user?.id ||
      draft.chatClientId !== state.authClientId);
  $("#chat-access").hidden =
    !enabled ||
    (!!state.auth.user && !state.chat?.reauthRequired && !otherAccount);
  $("#chat-access-text").textContent = otherAccount
    ? tr("Команда привязана к другому аккаунту Twitch или Client ID. Войдите в исходный аккаунт.")
    : state.auth.user
      ? tr("Для команд нужен повторный вход с разрешением на чтение чата. Награды за баллы продолжают работать.")
      : tr("Для запуска из чата войдите в аккаунт своего канала.");
}
function markDirty() {
  dirty = true;
  draftRevision++;
  clearTimeout(draftTimer);
  draftStatus(tr("Сохранение черновика…"));
  draftTimer = setTimeout(() => {
    try {
      flushLocalDraft();
    } catch (error) {
      toast(error.message);
    }
  }, 250);
  if ($("#save")) $("#save").innerHTML = icon("save") + esc(tr("Сохранить *"));
  icons();
}
function draftStatus(text) {
  if ($("#draft-status")) $("#draft-status").textContent = text;
}
function flushLocalDraft() {
  clearTimeout(draftTimer);
  if (!draft || !dirty) return;
  const result = desk.stashDraft(draft);
  if (!result?.ok) {
    draftStatus(tr("Черновик не сохранён"));
    throw Error(tr(result?.error || "Не удалось сохранить локальный черновик"));
  }
  state.drafts ||= {};
  state.drafts[draft.id] = {
    value: structuredClone(draft),
    savedAt: Date.now(),
  };
  draftStatus(tr("Черновик сохранён на этом ПК"));
}
window.flushLocalDraft = flushLocalDraft;
window.releaseEditor = () => {
  flushLocalDraft();
  dirty = false;
  draft = null;
  selected = "";
  renderEditor();
};
window.prepareExit = () => {
  flushLocalDraft();
  exiting = true;
};
addEventListener("beforeunload", () => {
  if (!exiting) flushLocalDraft();
});
async function showRewardHistory() {
  flushLocalDraft();
  const id = selected;
  const versions = await command("versions", id);
  const modal = $("#history-dialog");
  $("#history-list").innerHTML = versions.length
    ? versions
        .map(
          (v) =>
            `<div class="version-row"><div><strong>${esc(v.value.title)}</strong><div class="field-note">${esc(tr("{date} · {files} файлов", { date: new Date(v.stamp).toLocaleString(RewardI18n.locale), files: v.value.items.length.toLocaleString(RewardI18n.locale) }))}</div></div><button data-version="${v.id}" title="${esc(tr("Открыть эту версию как черновик"))}">${icon("rotate-ccw")}${esc(tr("Восстановить"))}</button></div>`,
        )
        .join("")
    : `<div class="empty">${esc(tr("Предыдущих сохранений пока нет"))}</div>`;
  $$("[data-version]").forEach((el) =>
    act(el, async () => {
      flushLocalDraft();
      dirty = false;
      await command("restore-draft", {
        id,
        version: Number(el.dataset.version),
      });
      select(id);
      modal.close();
      toast("Версия открыта как черновик. Twitch не изменён.");
    }),
  );
  icons();
  modal.showModal();
}
async function save() {
  if (!draft || saving) return;
  flushLocalDraft();
  const revision = draftRevision;
  saving = true;
  try {
    const result = await command("save", structuredClone(draft));
    if (revision !== draftRevision) {
      flushLocalDraft();
      return;
    }
    dirty = false;
    draft = structuredClone(result.rewards.find((r) => r.id === selected));
    $(".editor-head h2").textContent = draft.title;
    $("#save").innerHTML = icon("save") + esc(tr("Сохранить"));
    draftStatus(tr("Сохранено"));
    icons();
  } finally {
    saving = false;
    if (dirty) flushLocalDraft();
  }
}
async function addFiles(paths) {
  const added = await command("import", { id: selected, paths });
  for (const m of added)
    draft.items.push({
      id: m.id,
      volume: 80,
      weight: 1,
      ...(draft.kind === "video" ? { captionText: "" } : {}),
    });
  markDirty();
  renderMedia();
  updatePlacement();
}
function renderMedia() {
  $("#media-mode").textContent =
    draft.items.length > 1
      ? tr("Рулетка")
      : draft.items.length
        ? tr("Один файл")
        : tr("Нет файлов");
  $("#media-count").textContent = draft.items.length
    ? "· " + draft.items.length
    : "";
  $("#media-list").innerHTML = draft.items
    .map((i) => {
      const m = state.media.find((m) => m.id === i.id);
      return `<div class="media-row" data-item="${i.id}"><div class="media-file"><div class="media-name">${esc(m?.name || tr("Файл отсутствует"))}<small>${esc(tr("{size} МБ", { size: ((m?.size || 0) / 1024 / 1024).toLocaleString(RewardI18n.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }))}</small></div>${draft.kind === "video" ? `<button data-caption-edit title="${esc(tr("Текст этого ролика"))}" aria-label="${esc(tr("Текст ролика {name}", { name: m?.name || "" }))}">${icon("captions")}</button>` : ""}</div><div class="media-volume"><input data-volume type="range" min="0" max="100" value="${i.volume}" aria-label="${esc(tr("Громкость {name}", { name: m?.name || "" }))}"><output class="volume-value">${i.volume}%</output></div><input data-weight type="number" min="0" max="10000" step="1" value="${i.weight}" aria-label="${esc(tr("Вес {name}", { name: m?.name || "" }))}"><span class="chance"></span><button data-play title="${esc(tr("Тест файла в OBS"))}">${icon("play")}</button><button data-remove class="danger" title="${esc(tr("Убрать файл"))}">${icon("x")}</button></div>`;
    })
    .join("");
  $$(".media-row").forEach((row) => {
    const i = draft.items.find((i) => i.id === row.dataset.item);
    if (draft.kind === "video")
      act(row.querySelector("[data-caption-edit]"), () => {
        previewItemId = i.id;
        refreshCaptionItems();
        updatePlacement();
        $("#caption-text").focus();
      });
    row.querySelector("[data-volume]").addEventListener("input", (e) => {
      const item = draft.items.find((item) => item.id === row.dataset.item);
      item.volume = Number(e.target.value);
      row.querySelector(".volume-value").textContent = item.volume + "%";
      markDirty();
    });
    row.querySelector("[data-weight]").addEventListener("input", (e) => {
      draft.items.find((item) => item.id === row.dataset.item).weight = Number(
        e.target.value,
      );
      markDirty();
      percentages();
    });
    act(row.querySelector("[data-play]"), async () => {
      await save();
      await command("test", { id: selected, itemId: i.id });
      toast("Файл добавлен в очередь OBS");
    });
    act(row.querySelector("[data-remove]"), () => {
      draft.items = draft.items.filter((x) => x.id !== i.id);
      markDirty();
      renderMedia();
      updatePlacement();
    });
  });
  percentages();
  refreshCaptionItems();
  icons();
}
function previewItem() {
  const item =
    draft.items.find((item) => item.id === previewItemId) || draft.items[0];
  previewItemId = item?.id || "";
  return item;
}
function refreshCaptionItems() {
  if (draft.kind !== "video" || !$("#caption-item")) return;
  const item = previewItem();
  $("#caption-item").innerHTML = draft.items.length
    ? draft.items
        .map(
          (i) =>
            `<option value="${esc(i.id)}">${esc(state.media.find((m) => m.id === i.id)?.name || tr("Файл отсутствует"))}</option>`,
        )
        .join("")
    : `<option value="">${esc(tr("Нет видео"))}</option>`;
  $("#caption-item").value = previewItemId;
  $("#caption-item").disabled = !item;
  $("#caption-text").value = item
    ? RewardCaption.forItem(draft.video, item).caption.text
    : "";
  $("#caption-text").disabled = !item;
}
function percentages() {
  const heading = $("#chance-heading");
  if (heading.firstChild?.nodeType !== Node.TEXT_NODE)
    heading.prepend(document.createTextNode(""));
  heading.firstChild.textContent = draft.allowRepeats ? tr("Шанс") : tr("Доля");
  $("#roulette-help").textContent = draft.allowRepeats
    ? tr("Включено: каждый запуск выбирает из всех файлов с учётом веса. Один файл может выпасть несколько раз подряд.")
    : tr("Выключено: каждый файл с весом больше нуля показывается один раз за цикл. Отменённые до показа возвращаются в выбор; остановленный после начала ролик уже учтён. Цикл общий для зрителей и сохраняется после перезапуска.");
  const total = draft.items.reduce((n, i) => n + i.weight, 0);
  $$(".media-row").forEach((row) => {
    const i = draft.items.find((i) => i.id === row.dataset.item);
    row.querySelector(".chance").textContent =
      (total > 0 ? (i.weight / total) * 100 : 0).toFixed(1) + "%";
  });
}
function bindVideo() {
  $("#caption-item").addEventListener("change", (event) => {
    previewItemId = event.target.value;
    refreshCaptionItems();
    updatePlacement();
  });
  $("#caption-text").addEventListener("input", (event) => {
    const item = previewItem();
    if (!item) return;
    item.captionText = event.target.value;
    markDirty();
    updatePlacement();
  });
  for (const button of $$("[data-text-anchor]"))
    button.addEventListener("click", () => {
      const kind = button.dataset.textKind;
      draft.video[kind] ||= {
        ...(kind === "caption"
          ? RewardCaption.defaults
          : RewardCaption.durationDefaults),
      };
      Object.assign(draft.video[kind], {
        anchor: button.dataset.textAnchor,
        x: 0,
        y: 0,
      });
      for (const option of $$(`[data-text-kind="${kind}"]`))
        option.setAttribute("aria-pressed", String(option === button));
      $(`#${kind}-x`).value = 0;
      $(`#${kind}-y`).value = 0;
      markDirty();
      updatePlacement();
    });
  for (const el of $$("[data-caption]"))
    el.addEventListener("input", () => {
      draft.video.caption ||= { ...RewardCaption.defaults };
      draft.video.caption[el.dataset.caption] =
        el.type === "number" ? Number(el.value) : el.value;
      markDirty();
      updatePlacement();
    });
  for (const el of $$("[data-duration]"))
    el.addEventListener("input", () => {
      draft.video.duration ||= { ...RewardCaption.durationDefaults };
      draft.video.duration[el.dataset.duration] =
        el.type === "checkbox"
          ? el.checked
          : el.type === "number"
            ? Number(el.value)
            : el.value;
      for (const input of $$("[data-duration]:not([type=checkbox])"))
        input.disabled = !draft.video.duration.enabled;
      for (const button of $$('[data-text-kind="duration"]'))
        button.disabled = !draft.video.duration.enabled;
      markDirty();
      updatePlacement();
    });
  $("#position-mode").value = draft.video.mode;
  $("#border-style").value = draft.video.borderStyle;
  $$("[data-video]").forEach((el) =>
    el.addEventListener("input", () => {
      draft.video[el.dataset.video] = Number(el.value);
      constrain();
      markDirty();
      updatePlacement();
    }),
  );
  $("#position-mode").addEventListener("change", (e) => {
    draft.video.mode = e.target.value;
    markDirty();
    updatePlacement();
  });
  $("#border-style").addEventListener("change", (e) => {
    draft.video.borderStyle = e.target.value;
    markDirty();
    updatePlacement();
  });
  $("#border-color").addEventListener("input", (e) => {
    draft.video.color = e.target.value;
    markDirty();
    updatePlacement();
  });
  $("#tilt").addEventListener("change", (e) => {
    draft.video.angle = e.target.checked ? 12 : 0;
    $("#angle").value = draft.video.angle;
    $("#angle-value").value = draft.video.angle + "°";
    markDirty();
  });
  $("#angle").addEventListener("input", (e) => {
    draft.video.angle = Number(e.target.value);
    $("#tilt").checked = draft.video.angle > 0;
    $("#angle-value").value = draft.video.angle + "°";
    markDirty();
  });
  const el = $("#placement");
  let drag;
  el.addEventListener("pointerdown", (e) => {
    if (draft.video.mode === "random") return;
    drag = { x: e.clientX, y: e.clientY, px: draft.video.x, py: draft.video.y };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const scale = $("#stage").getBoundingClientRect().width / 1920;
    draft.video.x = Math.round(drag.px + (e.clientX - drag.x) / scale);
    draft.video.y = Math.round(drag.py + (e.clientY - drag.y) / scale);
    constrain();
    updatePlacement(true);
    markDirty();
  });
  el.addEventListener("pointerup", () => (drag = null));
  el.addEventListener("pointercancel", () => (drag = null));
  previewObserver = new ResizeObserver(updatePlacement);
  previewObserver.observe($("#stage"));
  updatePlacement();
}
function constrain() {
  const v = draft.video;
  v.x = Math.max(0, Math.min(1920 - v.width, v.x));
  v.y = Math.max(0, Math.min(1080 - v.height, v.y));
}
function updatePlacement(syncCoordinates = false) {
  if (!draft || draft.kind !== "video" || !$("#placement")) return;
  const v = draft.video,
    p = $("#placement"),
    scale = $("#stage").getBoundingClientRect().width / 1920;
  const item = previewItem();
  const first = item?.id || "";
  if (p.dataset.media !== first) {
    p.querySelector("video")?.remove();
    p.dataset.media = first;
    if (first) {
      const video = document.createElement("video");
      video.muted = true;
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        if (!p.isConnected) return;
        updatePlacement();
        if (Number.isFinite(video.duration) && video.duration > 0)
          video.currentTime = Math.min(0.05, video.duration / 2);
      };
      video.src = state.overlay.url + "media/" + first;
      p.prepend(video);
    }
  }
  const video = p.querySelector("video");
  const ratio =
    video?.videoWidth && video.videoHeight
      ? video.videoWidth / video.videoHeight
      : v.width / v.height;
  const frame = RewardGeometry.layout({ ...v, mode: "fixed", angle: 0 }, ratio);
  Object.assign(p.style, {
    left: frame.x / 19.2 + "%",
    top: frame.y / 10.8 + "%",
    width: frame.width / 19.2 + "%",
    height: frame.height / 10.8 + "%",
    border: `${frame.border * scale}px ${v.borderStyle} ${v.color}`,
    borderRadius: v.radius * scale + "px",
  });
  RewardCaption.renderAll(
    p,
    RewardCaption.forItem(draft.video, item),
    video?.duration,
    scale,
  );
  $("#coordinates").textContent =
    `${Math.round(frame.x)}, ${Math.round(frame.y)} · ${Math.round(frame.width)} × ${Math.round(frame.height)}`;
  for (const key of ["x", "y"]) {
    const field = $(`[data-video="${key}"]`);
    if (syncCoordinates === true ||
        (document.activeElement !== field && field.value !== "" && !field.validity.badInput))
      field.value = v[key];
  }
}
function textPlacementMarkup(kind, value, disabled = false) {
  const labels = [
    tr("Сверху слева"),
    tr("Сверху по центру"),
    tr("Сверху справа"),
    tr("По центру слева"),
    tr("По центру"),
    tr("По центру справа"),
    tr("Снизу слева"),
    tr("Снизу по центру"),
    tr("Снизу справа"),
  ];
  const symbols = [
    "arrow-up-left",
    "arrow-up",
    "arrow-up-right",
    "arrow-left",
    "dot",
    "arrow-right",
    "arrow-down-left",
    "arrow-down",
    "arrow-down-right",
  ];
  return `<div class="text-placement"><div><div class="anchor-label">${esc(tr("Положение"))}<button type="button" class="option-help" data-help="captionAnchor" aria-label="${esc(tr("О положении текста"))}">${icon("circle-help")}</button></div><div class="text-anchor-grid" role="group" aria-label="${esc(kind === "caption" ? tr("Положение подписи") : tr("Положение длительности"))}">${RewardCaption.anchors.map((anchor, i) => `<button type="button" data-text-kind="${kind}" data-text-anchor="${anchor}" aria-label="${esc(labels[i])}" title="${esc(labels[i])}" aria-pressed="${(value.anchor || RewardCaption.defaults.anchor) === anchor}" ${disabled ? "disabled" : ""}>${icon(symbols[i])}</button>`).join("")}</div></div><label>${esc(tr("Смещение X"))}<input id="${kind}-x" data-${kind}="x" type="number" min="-1920" max="1920" value="${value.x}" ${disabled ? "disabled" : ""}></label><label>${esc(tr("Смещение Y"))}<input id="${kind}-y" data-${kind}="y" type="number" min="-1080" max="1080" value="${value.y}" ${disabled ? "disabled" : ""}></label></div>`;
}
function captionMarkup() {
  const c = draft.video.caption || RewardCaption.defaults;
  const d = draft.video.duration || RewardCaption.durationDefaults;
  return `<section class="editor-section"><div class="section-head"><h3>${esc(tr("Текст на видео"))}</h3></div><div class="caption-fields">
  <label class="wide">${esc(tr("Ролик"))}<select id="caption-item"></select></label>
  <label class="wide">${esc(tr("Текст ролика"))}<textarea id="caption-text" maxlength="300" rows="2" placeholder="${esc(tr("Без надписи"))}"></textarea></label>
  <label>${esc(tr("Шрифт"))}<select id="caption-font" data-caption="font">${RewardCaption.fonts.map((font) => `<option ${font === c.font ? "selected" : ""}>${esc(font)}</option>`).join("")}</select></label>
  <label>${esc(tr("Размер, px"))}<input id="caption-size" data-caption="size" type="number" min="8" max="200" value="${c.size}"></label>
  <label>${esc(tr("Цвет"))}<input id="caption-color" data-caption="color" type="color" value="${esc(c.color)}"></label>
  </div>${textPlacementMarkup("caption", c)}<div class="duration-options"><label class="check"><input id="duration-enabled" data-duration="enabled" type="checkbox" ${d.enabled ? "checked" : ""}>${esc(tr("Показывать длительность видео"))}</label><div class="caption-fields">
  <label>${esc(tr("Шрифт"))}<select id="duration-font" data-duration="font" ${d.enabled ? "" : "disabled"}>${RewardCaption.fonts.map((font) => `<option ${font === d.font ? "selected" : ""}>${esc(font)}</option>`).join("")}</select></label>
  <label>${esc(tr("Размер, px"))}<input id="duration-size" data-duration="size" type="number" min="8" max="200" value="${d.size}" ${d.enabled ? "" : "disabled"}></label>
  <label>${esc(tr("Цвет"))}<input id="duration-color" data-duration="color" type="color" value="${esc(d.color)}" ${d.enabled ? "" : "disabled"}></label>
  </div>${textPlacementMarkup("duration", d, !d.enabled)}</div></section>`;
}
function renderStatus() {
  $(".version").textContent = `v${state.version}`;
  $("#connection-text").textContent = state.auth.user
    ? `${state.auth.user.login} · ${tr(state.twitch)}`
    : tr("Twitch не подключён");
  $("#connection-dot").classList.toggle("ready", state.auth.status === "ready");
  $("#pause").classList.toggle("active", state.paused);
  $("#pause").title = state.paused ? tr("Продолжить очередь") : tr("Пауза очереди");
  $("#pause").innerHTML = icon(state.paused ? "play" : "pause");
  const pending = state.jobs.filter((j) =>
    ["queued", "playing", "attention", "settling"].includes(j.state),
  ).length;
  $("#queue-count").textContent = pending;
  $("#queue-status").textContent = state.overlay.clients
    ? tr("OBS подключён · {count} в обработке", { count: pending.toLocaleString(RewardI18n.locale) })
    : tr("OBS не подключён");
  icons();
}
const states = {
  queued: "В очереди",
  playing: "Проигрывается",
  attention: "Требует решения",
  settling: "Подтверждение Twitch",
  done: "Готово",
  refunded: "Баллы возвращены",
  failed: "Ошибка / отмена",
  external: "Изменено в Twitch",
};
function renderJobs() {
  $("#jobs").innerHTML = state.jobs
    .map(
      (j) =>
        `<tr><td>${esc(new Date(j.createdAt).toLocaleString(RewardI18n.locale))}</td><td>${esc(j.user)}<small>${esc(j.rewardTitle)}</small>${j.source === "chat" ? `<small>${esc(tr("Чат · {command}", { command: j.command }))}</small>` : ""}</td><td>${esc(j.item?.name || "")}</td><td><span class="status ${j.state}">${esc(states[j.state] ? tr(states[j.state]) : j.state)}</span>${j.detail ? `<small>${esc(j.detail)}</small>` : ""}</td><td><div class="button-row">${j.state === "attention" ? `<button data-retry="${esc(j.id)}" title="${esc(tr("Повторить тот же файл"))}">${icon("rotate-ccw")}</button>` : ""}${["attention", "queued"].includes(j.state) ? `<button data-cancel="${esc(j.id)}" title="${esc(j.refundable ? tr("Отменить и вернуть баллы") : tr("Отменить"))}">${icon("x")}</button>` : ""}</div></td></tr>`,
    )
    .join("");
  $$("[data-retry]").forEach((el) =>
    act(el, () => command("retry", el.dataset.retry)),
  );
  $$("[data-cancel]").forEach((el) =>
    act(el, () => command("cancel", el.dataset.cancel)),
  );
  icons();
}
function renderSettings(preserveInputs = false) {
  $("#profile-path").textContent = state.dataPath || "";
  $("#chat-connection-state").textContent =
    tr(state.chat?.status || "Чат не подключён");
  $("#auth-state").textContent =
    (state.auth.message && tr(state.auth.message)) ||
    (state.auth.user
      ? tr("Выполнен вход: {login}", { login: state.auth.user.login })
      : tr("Нет аккаунта"));
  if (!preserveInputs && document.activeElement !== $("#client-id"))
    $("#client-id").value = state.clientId;
  $("#overlay-url").value = state.overlay.url;
  $("#obs-status").textContent = tr("Подключений: {count}", { count: state.overlay.clients.toLocaleString(RewardI18n.locale) });
  $("#overlay-error").textContent = tr(state.overlay.error);
  $("#overlay-error").hidden = !state.overlay.error;
  if (!preserveInputs && document.activeElement !== $("#port"))
    $("#port").value = state.overlay.port;
  $("#login-pending").hidden = !state.auth.pending;
  $("#login-code").textContent = state.auth.pending?.code || "";
  $("#logout").disabled = !state.auth.user;
  $("#login").disabled = !!state.auth.pending;
  $("#logs").textContent =
    state.logs
      .map((l) => new Date(l.stamp).toLocaleString(RewardI18n.locale) + "  " + l.message)
      .join("\n") || tr("Событий пока нет");
}
$$("[data-tab]").forEach((el) =>
  act(el, async () => {
    if (el.classList.contains("active")) return;
    if (saving || channelBusy) return;
    if (
      channelDirty &&
      !(await confirmAction(
        tr("Есть несохранённые изменения. Перейти без сохранения?"),
      ))
    )
      return;
    flushLocalDraft();
    channelDirty = false;
    $$("[data-tab]").forEach((b) => b.classList.toggle("active", b === el));
    for (const name of ["rewards", "channel", "queue", "settings"])
      $("#tab-" + name).hidden = name !== el.dataset.tab;
    $("main").scrollTop = 0;
    updatePlacement();
    if (el.dataset.tab === "channel") await loadChannel();
  }),
);
for (const button of $$("[data-kind-tab]")) {
  act(button, () => {
    if (saving) return;
    const kind = button.dataset.kindTab;
    const next =
      state.rewards.find(
        (r) => r.id === selectedByKind[kind] && r.kind === kind,
      ) || state.rewards.find((r) => r.kind === kind);
    rewardKind = kind;
    select(next?.id || "");
  });
  button.addEventListener("keydown", (e) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const kind =
        e.key === "Home"
          ? "audio"
          : e.key === "End"
            ? "video"
            : rewardKind === "audio"
              ? "video"
              : "audio";
      const next = $(`#kind-${kind}`);
      next.click();
      next.focus();
    }
  });
}
act($("#new-reward"), async () => {
  const result = await command("new", rewardKind);
  select(result.rewards.at(-1).id);
});
act($("#first-create"), async () => {
  const result = await command("new", "audio");
  select(result.rewards.at(-1).id);
});
$("#search").addEventListener("input", renderList);
for (const name of ["tray", "minimize", "maximize", "quit"])
  act($("#window-" + name), () => command(name));
act($("#pause"), () => command("pause", !state.paused));
act($("#stop"), async () => {
  if (
    await confirmAction(
      tr("Остановить воспроизведение? Незавершённая покупка будет отменена с возвратом баллов."),
    )
  )
    return command("stop");
});
for (const name of [
  "copy-url",
  "preview",
  "reconnect",
  "folder",
  "recover-profile",
  "logout",
  "cancel-login",
  "copy-code",
])
  act($("#" + name), () => command(name));
act($("#login"), () => command("login", $("#client-id").value));
act($("#save-port"), () => command("port", Number($("#port").value)));
addEventListener("resize", updatePlacement);
desk.onState(accept);
addEventListener("DOMContentLoaded", () =>
  command("state")
    .then(() => {
      if (state.rewards.length) select(state.rewards[0].id);
    })
    .catch(() => {}),
);
icons();
