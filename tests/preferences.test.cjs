const test = require("node:test");
const assert = require("node:assert/strict");
const { preferences, savePreferences } = require("../core/preferences.cjs");
const { createI18n } = require("../ui/i18n.js");

function memoryStore(initial) {
  const data = new Map(Object.entries(initial || {}));
  return { data, meta: (key, fallback) => data.has(key) ? data.get(key) : fallback,
    setMeta: (key, value) => data.set(key, value) };
}
test("appearance changes only its own preference record, keeping independent options", () => {
  const store = memoryStore({ paused: true, overlayToken: "private-test", roulette: [1, 2, 3] });
  assert.deepEqual(preferences(store), { theme: "light", language: "ru" });
  savePreferences(store, { theme: "dark" });
  savePreferences(store, { language: "uk" });
  assert.deepEqual(preferences(store), { theme: "dark", language: "uk" });
  assert.deepEqual(Object.fromEntries(store.data), {
    paused: true, overlayToken: "private-test", roulette: [1, 2, 3],
    uiPreferences: { theme: "dark", language: "uk" },
  });
});
test("invalid preference updates cannot alter stored data", () => {
  const store = memoryStore();
  for (const patch of [null, [], { theme: "blue" }, { language: "xx" }, { token: "x" }])
    assert.throws(() => savePreferences(store, patch));
  assert.equal(store.data.size, 0);
  store.setMeta("uiPreferences", { theme: "unknown", language: "bad" });
  assert.deepEqual(preferences(store), { theme: "light", language: "ru" });
});
test("translation uses explicit sources, safe own placeholders and Russian fallback", () => {
  const i18n = createI18n();
  i18n.register({ en: { "Баллы": "Points", "Награда {name}": "Reward {name}" }, uk: { "Баллы": "Бали" } });
  i18n.setLocale("en");
  assert.equal(i18n.t("Баллы"), "Points");
  assert.equal(i18n.t("Награда {name}", { name: "<b>Баллы</b>" }), "Reward <b>Баллы</b>");
  assert.equal(i18n.t("Unknown {constructor}"), "Unknown {constructor}");
  i18n.setLocale("uk");
  assert.equal(i18n.t("Баллы"), "Бали");
  i18n.setLocale("bad");
  assert.equal(i18n.t("Баллы"), "Баллы");
});
