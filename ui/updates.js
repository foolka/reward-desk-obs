let promptedUpdate = "";
function renderUpdates(prompt = true) {
  const update = state.updates || {};
  const busy = ["checking", "downloading", "installing"].includes(
    update.status,
  );
  const installing = ["downloading", "installing"].includes(update.status);
  $("#auto-updates").checked = update.enabled !== false;
  $("#check-updates").disabled = busy;
  $("#update-status").textContent =
    shellStatusText(update.message || "Проверка ещё не выполнена");
  $("#show-update").hidden = !update.release;
  $("#update-message").textContent = shellStatusText(update.message || "");
  $("#update-title").textContent = update.release
    ? tr("Доступна версия {version}", { version: update.release.version })
    : tr("Обновление Reward Desk");
  $("#update-notes").textContent = update.release?.notes || "";
  $("#update-progress").hidden = !installing;
  $("#update-progress").value = update.progress || 0;
  $("#install-update").disabled =
    update.status !== "available" || !update.installable;
  $("#update-later").disabled = installing;
  if (
    prompt &&
    update.status === "available" &&
    update.release &&
    promptedUpdate !== update.release.version
  ) {
    promptedUpdate = update.release.version;
    $("#update-dialog").showModal();
  }
}
act($("#check-updates"), () => command("check-updates"));
$("#auto-updates").addEventListener("change", () => {
  void command("auto-updates", $("#auto-updates").checked).catch(() => {});
});
act($("#show-update"), () => $("#update-dialog").showModal());
act($("#update-later"), () => $("#update-dialog").close());
$("#update-dialog").addEventListener("cancel", (event) => {
  if (["downloading", "installing"].includes(state.updates?.status))
    event.preventDefault();
});
act($("#install-update"), async () => {
  flushLocalDraft();
  await command("install-update");
});
