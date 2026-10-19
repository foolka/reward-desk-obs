const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startupNotice } = require("../core/startup-notice.cjs");
const { createI18n } = require("../ui/i18n.js");

for (const language of ["ru", "uk", "en"]) {
  for (const obsPlugin of [false, true]) {
    test(`redirect notice is informational and actionable: ${language}, OBS=${obsPlugin}`, () => {
      const i18n = createI18n();
      i18n.register(require("../core/native-locales.cjs"));
      i18n.setLocale(language);
      const notice = startupNotice(Object.assign(Error("technical diagnostic"), {
        code: "PROFILE_REDIRECTED",
      }), { obsPlugin, tr: i18n.t });
      assert.equal(notice.type, "info");
      assert.equal(notice.title, obsPlugin ? "Reward Desk OBS" : "Reward Desk");
      assert.equal(notice.buttons.length, 1);
      assert.equal(notice.cancelId, 0);
      assert.doesNotMatch(notice.detail, /technical diagnostic/);
      assert.match(notice.detail, /Reward Desk/);
      if (obsPlugin) assert.match(notice.detail, /OBS/);
      else assert.doesNotMatch(notice.detail, /OBS/);
      if (language === "en") assert.doesNotMatch(JSON.stringify(notice), /[А-Яа-я]/);
      if (language !== "ru") assert.notEqual(notice.message, "Нужен обычный запуск");
    });
  }
}

test("only a typed redirection is informational; other failures stay errors", () => {
  for (const error of [
    Error("Windows перенаправляет профиль"),
    Object.assign(Error("Access denied"), { code: "EACCES" }),
    Error("Сохранённая база отсутствует или повреждена"),
    Error("Disk full"),
  ]) {
    const notice = startupNotice(error);
    assert.equal(notice.type, "error");
    assert.equal(notice.detail, error.message);
  }
});
