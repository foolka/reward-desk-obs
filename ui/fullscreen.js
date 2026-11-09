(() => {
	let preview;

	// Opening another reward must not leave a local scare or its sound running.
	function stop() {
		preview?.stop();
		preview = null;
		const area = document.getElementById("fullscreen-preview");
		if (area) area.hidden = true;
	}

	// The mode belongs to the reward; all settings below it belong to the selected file.
	function markup() {
		return `
			<section class="editor-section b-fullscreen">
				<label class="check">
					<input id="fullscreen-enabled" type="checkbox" ${draft.video.fullscreen ? "checked" : ""}>
					${esc(tr("На весь экран"))}
				</label>
				<div class="field-note">${esc(tr("Для больших пугалок: видео или картинка заполняет источник OBS, без рамки и наклона. Растяните источник на весь холст OBS и разместите выше игры."))}</div>
				<div id="fullscreen-options" class="b-fullscreen__options" hidden>
					<label>${esc(tr("Элемент рулетки"))}<select id="fullscreen-item"></select></label>
					<div id="fullscreen-fields" class="b-fullscreen__fields"></div>
					<div id="fullscreen-preview" class="b-fullscreen__preview" hidden></div>
				</div>
			</section>`;
	}

	// Explicit option sets keep uploaded names and saved values out of markup structure.
	function selectField(key, label, values, value) {
		return `
			<label>${esc(label)}
				<select id="full-${key}" data-presentation="${key}">
					${values.map(([id, name]) => `<option value="${id}" ${id === value ? "selected" : ""}>${esc(name)}</option>`).join("\n")}
				</select>
			</label>`;
	}

	// Typing keeps the original input node; an empty numeric field is not forced to 1.
	function numberField(key, label, min, max, value, step = 1) {
		return `
			<label>${esc(label)}
				<input id="full-${key}" data-presentation="${key}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" required>
			</label>`;
	}

	// Rebuild only when the chosen item or fullscreen mode changes, never on typing.
	function refresh() {
		if (!draft || draft.kind !== "video" || !$("#fullscreen-enabled")) return;
		const full = draft.video.fullscreen === true;
		$("#fullscreen-options").hidden = !full;
		$("#position-mode").closest(".select-control")?.toggleAttribute("hidden", full);
		$("#position-mode").hidden = full;
		$(".video-controls").hidden = full;
		const select = $("#fullscreen-item");
		const item = previewItem();
		select.innerHTML = draft.items.map((entry) => `<option value="${esc(entry.id)}">${esc(state.media.find((m) => m.id === entry.id)?.name || tr("Файл отсутствует"))}</option>`).join("\n");
		select.value = item?.id || "";
		select.disabled = !item;
		const fields = $("#fullscreen-fields");
		fields.replaceChildren();
		if (!full || !item) { stop(); return; }
		const p = RewardPresentation.forItem(item);
		const m = state.media.find((m) => m.id === item.id);
		const motions = [["none", tr("Без анимации")], ["fade", tr("Проявление")], ["slide", tr("Выезд")], ["zoom", tr("Масштаб")], ["pop", tr("Прыжок")]];
		const directions = [["center", tr("Из центра")], ["left", tr("Слева")], ["right", tr("Справа")], ["top", tr("Сверху")], ["bottom", tr("Снизу")]];
		fields.innerHTML = `
			<div class="b-fullscreen__grid">
				${selectField("fit", tr("Заполнение экрана"), [["cover", tr("Заполнить с обрезкой")], ["contain", tr("Целиком с полями")]], p.fit)}
				${m?.kind === "image" ? numberField("imageSeconds", tr("Показ картинки, сек."), 0.1, 600, p.imageSeconds, 0.1) : ""}
				<div class="b-fullscreen__sound">
					<label class="b-fullscreen__sound-field">${esc(tr("Отдельный звук"))}
						<select id="full-soundId" data-presentation="soundId">
							<option value="">${esc(tr("Без отдельного звука"))}</option>
							${state.media.filter((media) => media.kind === "audio").map((media) => `<option value="${esc(media.id)}" ${media.id === p.soundId ? "selected" : ""}>${esc(media.name)}</option>`).join("\n")}
						</select>
					</label>
					<button id="full-add-sound" title="${esc(tr("Загрузить звук"))}" aria-label="${esc(tr("Загрузить звук"))}">${icon("upload")}</button>
					<button id="full-remove-sound" title="${esc(tr("Убрать отдельный звук"))}" aria-label="${esc(tr("Убрать отдельный звук"))}" ${p.soundId ? "" : "disabled"}>${icon("x")}</button>
				</div>
				<label>${esc(tr("Громкость отдельного звука"))}
					<div class="b-fullscreen__volume"><input id="full-soundVolume" data-presentation="soundVolume" type="range" min="0" max="100" value="${p.soundVolume}" ${p.soundId ? "" : "disabled"}><output id="full-volume-value">${p.soundVolume}%</output></div>
				</label>
			</div>
			<div class="field-note">${esc(tr("Пусто: у видео звучит его дорожка, у картинки тишина. Выбранный звук заменяет дорожку видео и останавливается вместе с показом."))}</div>
			<div class="b-fullscreen__motion">
				${selectField("enter", tr("Появление"), motions, p.enter)}
				${selectField("enterFrom", tr("Откуда появляется"), directions, p.enterFrom)}
				${numberField("enterMs", tr("Появление, мс"), 0, 5000, p.enterMs)}
				${selectField("exit", tr("Исчезновение"), motions, p.exit)}
				${selectField("exitTo", tr("Куда исчезает"), directions, p.exitTo)}
				${numberField("exitMs", tr("Исчезновение, мс"), 0, 5000, p.exitMs)}
			</div>
			<div class="button-row">
				<button id="full-preview-play">${icon("play")}${esc(tr("Предпросмотр эффекта"))}</button>
				<button id="full-preview-stop" title="${esc(tr("Остановить предпросмотр"))}" aria-label="${esc(tr("Остановить предпросмотр"))}">${icon("square")}</button>
			</div>`;
		fields.querySelectorAll("[data-presentation]").forEach((control) => control.addEventListener("input", () => {
			const target = previewItem();
			if (!target) return;
			target.presentation = RewardPresentation.forItem(target);
			target.presentation[control.dataset.presentation] = ["number", "range"].includes(control.type) ? Number(control.value) : control.value;
			stop(); markDirty(); syncControls(); updatePlacement();
		}));
		act($("#full-add-sound"), async () => {
			const id = item.id, rewardId = selected;
			const added = await command("import", { id: rewardId, purpose: "sound" });
			rememberMedia(added);
			const target = selected === rewardId && draft.items.find((entry) => entry.id === id);
			if (!target || !added.length) return;
			target.presentation = { ...RewardPresentation.forItem(target), soundId: added[0].id };
			markDirty(); refresh();
		});
		act($("#full-remove-sound"), () => {
			const target = previewItem();
			target.presentation = { ...RewardPresentation.forItem(target), soundId: "" };
			stop(); markDirty(); refresh();
		});
		act($("#full-preview-play"), playPreview);
		act($("#full-preview-stop"), stop);
		syncControls(); icons();
	}

	// Disabled direction fields retain their values for later animation changes.
	function syncControls() {
		const p = RewardPresentation.forItem(previewItem());
		for (const [key, direction] of [["enter", "enterFrom"], ["exit", "exitTo"]]) {
			$("#full-" + direction).disabled = ["none", "fade"].includes(p[key]);
			$("#full-" + key + "Ms").disabled = p[key] === "none";
		}
		$("#full-remove-sound").disabled = !p.soundId;
		$("#full-soundVolume").disabled = !p.soundId;
		$("#full-volume-value").value = p.soundVolume + "%";
	}

	// This preview is local: it does not redeem rewards, reserve roulette items or use OBS.
	function playPreview() {
		const item = previewItem();
		const m = state.media.find((media) => media.id === item?.id);
		if (!m) return;
		for (const input of $("#fullscreen-fields").querySelectorAll("input"))
			if (!input.checkValidity()) { input.reportValidity(); return; }
		stop();
		const p = RewardPresentation.forItem(item), area = $("#fullscreen-preview");
		area.hidden = false;
		preview = RewardPlayback.mount(area, {
			id: "local-preview", kind: "video", mediaKind: m.kind,
			url: state.overlay.url + "media/" + m.id, volume: item.volume,
			video: RewardCaption.forItem(draft.video, item), presentation: p,
			soundUrl: p.soundId ? state.overlay.url + "media/" + p.soundId : "",
		}, (type) => {
			stop();
			if (type === "error") toast("Не удалось показать файл. Проверьте формат медиа.");
		});
	}

	// Selectors share the active media item with text and positioning previews.
	function bind() {
		$("#fullscreen-enabled").addEventListener("change", (event) => {
			stop(); draft.video.fullscreen = event.target.checked;
			markDirty(); renderMedia(); updatePlacement();
		});
		$("#fullscreen-item").addEventListener("change", (event) => {
			stop(); previewItemId = event.target.value;
			refreshCaptionItems(); refresh(); updatePlacement();
		});
		refresh();
	}
	window.RewardFullscreenEditor = { markup, bind, refresh, stop };
})();
