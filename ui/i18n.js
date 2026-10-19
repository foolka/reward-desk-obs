(function (root) {
  function createI18n() {
    const catalogs = { en: Object.create(null), uk: Object.create(null) };
    let locale = "ru";
    const bindings = new WeakMap();
    const api = {
      get locale() { return locale; },
      register(translations) {
        for (const language of ["en", "uk"])
          Object.assign(catalogs[language], translations[language] || {});
      },
      setLocale(language) {
        locale = ["ru", "uk", "en"].includes(language) ? language : "ru";
      },
      t(source, values = {}) {
        const text = catalogs[locale]?.[source] ?? String(source ?? "");
        return text.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (token, key) =>
          Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : token);
      },
      text(element, source, values = {}) {
        bindings.set(element, { source, values });
        element.textContent = api.t(source, values);
      },
      apply(scope = document) {
        for (const el of scope.querySelectorAll("[data-i18n]"))
          el.textContent = api.t(el.dataset.i18n);
        for (const attr of ["title", "aria-label", "placeholder"])
          for (const el of scope.querySelectorAll(`[data-i18n-${attr}]`))
            el.setAttribute(attr, api.t(el.getAttribute(`data-i18n-${attr}`)));
        for (const el of scope.querySelectorAll("*")) {
          const binding = bindings.get(el);
          if (binding) el.textContent = api.t(binding.source, binding.values);
        }
      },
      catalogs,
    };
    return api;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createI18n };
  } else {
    root.RewardI18n = createI18n();
    root.tr = (source, values) => root.RewardI18n.t(source, values);
    const prefs = root.desk?.uiPreferences || { theme: "light", language: "ru" };
    root.RewardI18n.setLocale(prefs.language);
    document.documentElement.lang = root.RewardI18n.locale;
    document.documentElement.dataset.theme = prefs.theme === "dark" ? "dark" : "light";
  }
})(globalThis);
