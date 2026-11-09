(function (scope) {
	// One playback owns every timer, animation and audio element, including force-stop.
	function mount(container, job, finished) {
		const full = job.kind === "video" && job.video?.fullscreen === true;
		const image = job.mediaKind === "image";
		const visual = job.kind === "video";
		const p = RewardPresentation.forItem({ presentation: job.presentation });
		const el = document.createElement(image ? "img" : visual ? "video" : "audio");
		const frame = visual ? document.createElement("div") : el;
		const sound = full && job.soundUrl ? document.createElement("audio") : null;
		const timers = new Set();
		let stopped = false, settled = false, started = false, animation;
		let mediaReady = false, soundReady = !sound;
		let loadTimer, playTimer;
		const later = (callback, ms) => {
			const id = setTimeout(() => { timers.delete(id); callback(); }, ms);
			timers.add(id);
			return id;
		};
		const clear = (id) => { clearTimeout(id); timers.delete(id); };
		if (visual) {
			frame.className = full ? "clip-frame fullscreen-frame" : "clip-frame";
			el.className = "clip";
			frame.append(el);
			if (full) el.style.objectFit = p.fit;
		}
		if (image) el.alt = "";
		else {
			el.volume = job.volume / 100;
			el.muted = !!sound;
			el.preload = "auto";
			el.playsInline = true;
		}
		if (sound) {
			sound.preload = "auto";
			sound.volume = p.soundVolume / 100;
			frame.append(sound);
		}

		// Fullscreen fills the actual source; regular rewards retain the 1920x1080 stage.
		function layout() {
			if (!visual || stopped) return;
			if (!full) {
				const ratio = image ? el.naturalWidth / el.naturalHeight : el.videoWidth / el.videoHeight;
				const v = job.video, pos = RewardGeometry.layout(v, ratio);
				Object.assign(frame.style, {
					left: pos.x + "px", top: pos.y + "px", width: pos.width + "px", height: pos.height + "px",
					transform: `rotate(${pos.angle}deg)`, border: `${pos.border}px ${v.borderStyle} ${v.color}`,
					borderRadius: v.radius + "px",
				});
			}
			const scale = full ? container.clientWidth / 1920 : 1;
			RewardCaption.renderAll(frame, job.video, image ? p.imageSeconds : el.duration, scale);
		}

		// Immediate teardown also cancels a pending exit, so it cannot finish a later job.
		function stop() {
			if (stopped) return;
			stopped = true;
			for (const timer of timers) clearTimeout(timer);
			timers.clear();
			animation?.cancel();
			for (const media of [el, sound].filter(Boolean)) {
				media.onload = media.onerror = media.onloadedmetadata = media.onended = null;
				if (media !== el || !image) media.pause();
				media.removeAttribute("src");
				if (media !== el || !image) media.load();
			}
			frame.remove();
		}

		// Respect reduced motion while leaving the duration of the reward unchanged.
		function animate(leaving) {
			animation?.cancel();
			let name = leaving ? p.exit : p.enter;
			let ms = leaving ? p.exitMs : p.enterMs;
			if (name === "none") ms = 0;
			if (scope.matchMedia?.("(prefers-reduced-motion: reduce)").matches && ms) {
				name = "fade";
				ms = Math.min(ms, 150);
			}
			if (ms) animation = frame.animate(
				RewardPresentation.frames(name, leaving ? p.exitTo : p.enterFrom, leaving),
				{ duration: ms, easing: leaving ? "ease-in" : "ease-out", fill: "both" },
			);
			return ms;
		}

		// Only a completed primary video/image finishes the reward, never its extra sound.
		function finish(type) {
			if (stopped || settled) return;
			settled = true;
			clear(loadTimer); clear(playTimer);
			let delay = 0;
			if (type === "ended") {
				if (full) delay = animate(true);
				else { frame.classList.add("leaving"); delay = 180; }
			}
			later(() => { if (!stopped) { stop(); finished(type); } }, delay);
		}

		// Start primary media and replacement audio together, after both metadata loads.
		function start() {
			if (stopped || settled || started || !mediaReady || !soundReady) return;
			started = true;
			clear(loadTimer);
			layout();
			frame.style.visibility = "visible";
			const duration = image ? p.imageSeconds : el.duration;
			const entering = full ? animate(false) : 0;
			const plays = [];
			if (!image) plays.push(el.play());
			if (sound) plays.push(sound.play());
			Promise.all(plays).then(() => {
				if (stopped || settled) return;
				playTimer = later(() => finish(image ? "ended" : "error"),
					image ? duration * 1000 + entering : duration * 1000 + 15000);
			}).catch(() => finish("error"));
		}
		el.onerror = () => finish("error");
		if (image) el.onload = () => {
			if (!el.naturalWidth || !el.naturalHeight) return finish("error");
			mediaReady = true; start();
		};
		else {
			el.onended = () => finish("ended");
			el.onloadedmetadata = () => {
				if (!Number.isFinite(el.duration) || el.duration <= 0 || el.duration > 600) return finish("error");
				mediaReady = true; start();
			};
		}
		if (sound) {
			sound.onerror = () => finish("error");
			sound.onloadedmetadata = () => {
				if (!Number.isFinite(sound.duration) || sound.duration <= 0 || sound.duration > 600) return finish("error");
				soundReady = true; start();
			};
		}
		frame.style.visibility = "hidden";
		container.append(frame);
		loadTimer = later(() => finish("error"), 20000);
		el.src = job.url;
		if (sound) sound.src = job.soundUrl;
		return { id: job.id, el, frame, sound, stop, layout };
	}
	const api = { mount };
	if (typeof module !== "undefined") module.exports = api;
	else scope.RewardPlayback = api;
})(globalThis);
