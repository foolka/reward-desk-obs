let groupSelected = "",
  groupResultSource = "",
  groupResultErrors = [];
function renderGroupResult() {
  $("#group-result").textContent = groupResultErrors.length
    ? groupResultErrors.map((e) => `${e.title}: ${tr(e.message)}`).join("\n")
    : tr(groupResultSource);
}
function refreshGroupsLanguage() {
  if (!$("#groups-dialog").open) return;
  const option = $("#group-select option[value='']");
  if (option) option.textContent = tr("Новая группа");
  renderGroupResult();
}
function showGroup(id = "") {
  groupSelected = id;
  const group = state.groups?.find((g) => g.id === id);
  $("#group-select").innerHTML =
    `<option value="">${esc(tr("Новая группа"))}</option>` +
    (state.groups || [])
      .map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`)
      .join("");
  $("#group-select").value = id;
  $("#group-name").value = group?.name || "";
  $("#group-color").value = group?.color || "#239d89";
  $("#group-delete").disabled = !group;
  groupResultSource = "";
  groupResultErrors = group?.errors || [];
  renderGroupResult();
  $("#group-members").innerHTML = state.rewards
    .map(
      (r) =>
        `<label class="check group-member"><input type="checkbox" value="${esc(r.id)}" ${group?.members.includes(r.id) ? "checked" : ""}>${icon(r.kind === "video" ? "film" : "audio-lines")}<span>${esc(r.title)}</span></label>`,
    )
    .join("");
  icons();
}
act($("#manage-groups"), () => {
  flushLocalDraft();
  showGroup(state.groups?.[0]?.id);
  $("#groups-dialog").showModal();
});
act($("#group-new"), () => showGroup());
$("#group-select").addEventListener("change", (e) => showGroup(e.target.value));
act($("#group-save"), async () => {
  const dialog = $("#groups-dialog");
  const controls = [...dialog.querySelectorAll("input,select,button")];
  const input = {
    id: groupSelected,
    name: $("#group-name").value,
    color: $("#group-color").value,
    members: $$("#group-members input:checked").map((el) => el.value),
  };
  controls.forEach((el) => (el.disabled = true));
  groupResultSource = "Применение цвета…";
  groupResultErrors = [];
  renderGroupResult();
  try {
    const result = await command("group-save", input);
    await command("state");
    if (selected) {
      dirty = false;
      select(selected);
    }
    showGroup(result.id);
    groupResultSource = "Сохранено. Цвет применён.";
    groupResultErrors = result.errors;
    renderGroupResult();
  } finally {
    controls.forEach((el) => (el.disabled = false));
    $("#group-delete").disabled = !groupSelected;
  }
});
act($("#group-delete"), async () => {
  await command("group-remove", groupSelected);
  showGroup();
});
