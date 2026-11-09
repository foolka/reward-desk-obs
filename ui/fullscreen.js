(() => {
	// Preserve old records for Dudos import without offering fullscreen playback here.
	function retired() {
		if (!draft?.video?.fullscreen) return false;
		$("#editor").innerHTML = `
			<div class="editor-head"><h2>${esc(draft.title)}</h2></div>
			<section class="editor-section">
				<h3>${esc(tr("Полноэкранные пугалки перенесены в Dudos Lite"))}</h3>
				<div class="field-note">${esc(tr("Эта награда больше не запускается в Reward Desk. Файлы и настройки сохранены. В Dudos Desk нажмите «Перенести из Reward Desk»: элементы попадут в обычную рулетку, новая награда Twitch не создаётся."))}</div>
				<ul>${draft.items.map(item => `<li>${esc(state.media.find(m => m.id === item.id)?.name || tr("Файл отсутствует"))}</li>`).join("")}</ul>
			</section>`;
		icons();
		return true;
	}
	window.RewardFullscreenEditor = { markup: () => "", bind() {}, refresh() {}, stop() {}, retired };
})();
