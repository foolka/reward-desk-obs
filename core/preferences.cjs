const defaults = Object.freeze({ theme: "light", language: "ru" });
const themes = ["light", "dark"];
const languages = ["ru", "uk", "en"];

function preferences(store) {
  const value = store.meta("uiPreferences", defaults);
  return {
    theme: themes.includes(value?.theme) ? value.theme : defaults.theme,
    language: languages.includes(value?.language) ? value.language : defaults.language,
  };
}

function savePreferences(store, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw Error("Invalid appearance preferences");
  if (Object.keys(patch).some((key) => !["theme", "language"].includes(key)))
    throw Error("Unknown appearance preference");
  if (("theme" in patch && !themes.includes(patch.theme)) ||
      ("language" in patch && !languages.includes(patch.language)))
    throw Error("Unsupported theme or language");
  const value = { ...preferences(store), ...patch };
  store.setMeta("uiPreferences", value);
  return value;
}

module.exports = { defaults, preferences, savePreferences };
