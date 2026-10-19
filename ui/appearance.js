(() => {
  let current = { theme: "light", language: "ru", ...desk.uiPreferences };
  let saved = { ...current };
  let revision = 0;
  let pending = Promise.resolve();
  RewardI18n.register({
    en: {
      "Язык интерфейса": "Interface language",
      "Включить тёмную тему": "Switch to dark theme",
      "Включить светлую тему": "Switch to light theme",
      "Оформление": "Appearance",
      "Не удалось сохранить оформление": "Could not save appearance preferences",
    },
    uk: {
      "Язык интерфейса": "Мова інтерфейсу",
      "Включить тёмную тему": "Увімкнути темну тему",
      "Включить светлую тему": "Увімкнути світлу тему",
      "Оформление": "Оформлення",
      "Не удалось сохранить оформление": "Не вдалося зберегти налаштування оформлення",
    },
  });

  function pathFor(el) {
    if (!el || el === document.body) return "body";
    if (el.id) return `#${CSS.escape(el.id)}`;
    const index = [...el.parentElement.children].indexOf(el) + 1;
    return `${pathFor(el.parentElement)} > :nth-child(${index})`;
  }

  function refreshLanguage() {
    // Keep the raw form values too: an unfinished number is not yet in the draft model.
    const controls = [...document.querySelectorAll("input,textarea,select")].map((el) => ({
      path: pathFor(el),
      element: el,
      preserve: el.tagName === "TEXTAREA" || ["text", "search", "password", "number", "url", "email", "tel"].includes(el.type),
      value: el.value,
      checked: el.checked,
      disabled: el.disabled,
      start: el.selectionStart,
      end: el.selectionEnd,
    }));
    const focus = pathFor(document.activeElement);
    const scroll = [...document.querySelectorAll("main,aside,textarea,[popover],dialog,.table-wrap")]
      .map((el) => ({ path: pathFor(el), top: el.scrollTop, left: el.scrollLeft }));
    RewardI18n.apply();
    if (state) {
      renderList();
      renderEditor();
      renderStatus();
      renderJobs();
      renderSettings(true);
      renderChatStatus();
      renderUpdates(false);
      renderObsRecovery();
      if (typeof refreshShellLanguage === "function") refreshShellLanguage();
      else {
        renderChannel();
        renderChannelEditor();
      }
      if (dirty) {
        $("#save").innerHTML = icon("save") + tr("Сохранить *");
        draftStatus(tr("Локальный черновик"));
      } else draftStatus(tr("Сохранено"));
    }
    for (const saved of controls) {
      let el = document.querySelector(saved.path);
      if (!el || el.id === "language" || el.type === "file") continue;
      // Keep partial numeric input and existing handlers, not just .value.
      if (saved.preserve && el !== saved.element) {
        for (const attr of ["aria-label", "title", "placeholder"])
          if (el.hasAttribute(attr)) saved.element.setAttribute(attr, el.getAttribute(attr));
        el.replaceWith(saved.element);
        el = saved.element;
      }
      if (saved.preserve) {
        el.disabled = saved.disabled;
        continue;
      }
      if (el !== saved.element) el.value = saved.value;
      if (typeof saved.checked === "boolean") el.checked = saved.checked;
      el.disabled = saved.disabled;
      if (saved.start !== null && saved.start !== undefined)
        el.setSelectionRange(saved.start, saved.end);
    }
    document.querySelector(focus)?.focus({ preventScroll: true });
    for (const saved of scroll) {
      const el = document.querySelector(saved.path);
      if (el) { el.scrollTop = saved.top; el.scrollLeft = saved.left; }
    }
    RewardHelp.refreshLanguage?.();
    icons();
  }

  function paint(previousLanguage) {
    RewardI18n.setLocale(current.language);
    document.documentElement.lang = RewardI18n.locale;
    document.documentElement.dataset.theme = current.theme;
    if (previousLanguage !== current.language) refreshLanguage();
    const dark = current.theme === "dark";
    const label = tr(dark ? "Включить светлую тему" : "Включить тёмную тему");
    const button = $("#theme-toggle");
    button.innerHTML = icon(dark ? "sun" : "moon");
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(dark));
    $("#language").value = current.language;
    $("#language").setAttribute("aria-label", tr("Язык интерфейса"));
    icons();
  }

  function change(patch) {
    const previousLanguage = current.language;
    current = { ...current, ...patch };
    paint(previousLanguage);
    const requested = { ...current };
    const request = ++revision;
    pending = pending.then(async () => {
      try {
        saved = await desk.command("preferences", requested);
      } catch {
        if (request === revision) {
          const previous = current.language;
          current = { ...saved };
          paint(previous);
        }
        toast("Не удалось сохранить оформление");
      }
    });
  }

  $("#theme-toggle").addEventListener("click", () =>
    change({ theme: current.theme === "dark" ? "light" : "dark" }));
  $("#language").addEventListener("change", (event) =>
    change({ language: event.target.value }));
  const prepareExit = window.prepareExit;
  window.prepareExit = async () => {
    let saving;
    do {
      saving = pending;
      await saving;
    } while (saving !== pending);
    return prepareExit();
  };
  paint(current.language);
  RewardI18n.apply();
})();
