const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createI18n } = require("../ui/i18n.js");
const ui = path.join(__dirname, "../ui");

function catalog() {
  const i18n = createI18n();
  for (const name of ["locales-editor.js", "locales-shell.js"])
    vm.runInNewContext(fs.readFileSync(path.join(ui, name), "utf8"), { RewardI18n: i18n });
  return i18n;
}
const placeholders = (text) => [...new Set(text.match(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g) || [])].sort();
test("all registered translations have both languages and identical placeholders", () => {
  const i18n = catalog();
  const { en, uk } = i18n.catalogs;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(uk).sort());
  assert.ok(Object.keys(en).length > 200);
  for (const locale of ["en", "uk"])
    for (const [source, translation] of Object.entries(i18n.catalogs[locale])) {
      assert.equal(typeof translation, "string", source);
      assert.ok(translation.length, source);
      assert.deepEqual(placeholders(translation), placeholders(source), `${locale}: ${source}`);
    }
});
test("annotated shell markup has translations and never targets form values", () => {
  const i18n = catalog();
  const html = fs.readFileSync(path.join(ui, "index.html"), "utf8");
  for (const [, source] of html.matchAll(/data-i18n(?:-title|-aria-label|-placeholder)?="([^"]*)"/g))
    for (const locale of ["en", "uk"])
      assert.ok(i18n.catalogs[locale][source] || source === "Язык интерфейса", `${locale}: ${source}`);
  assert.doesNotMatch(html, /<(?:input|textarea|select)\b[^>]*\sdata-i18n=/i);
});
test("literal translation calls in UI modules are covered", () => {
  const i18n = catalog();
  for (const file of ["app.js", "channel.js", "obs.js", "groups.js", "updates.js", "help.js"])
    for (const [, literal] of fs.readFileSync(path.join(ui, file), "utf8").matchAll(/\btr\(\s*("(?:\\.|[^"\\])*")/g)) {
      const source = JSON.parse(literal);
      for (const locale of ["en", "uk"])
        assert.ok(i18n.catalogs[locale][source], `${file}/${locale}: ${source}`);
    }
});
test("every option help description is translated", () => {
  const i18n = catalog();
  const source = fs.readFileSync(path.join(ui, "help.js"), "utf8");
  const block = source.slice(source.indexOf("const descriptions =") + "const descriptions =".length,
    source.indexOf("const tooltip"));
  const descriptions = vm.runInNewContext(`(${block.trim().replace(/;$/, "")})`);
  for (const [key, value] of Object.entries(descriptions))
    for (const locale of ["en", "uk"])
      assert.ok(i18n.catalogs[locale][value], `${locale} help: ${key}`);
});
