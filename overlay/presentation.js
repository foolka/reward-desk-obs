(function (scope) {
	const animations = ["none", "fade", "slide", "zoom", "pop"];
	const directions = ["center", "left", "right", "top", "bottom"];
	const defaults = {
		imageSeconds: 5,
		fit: "cover",
		soundId: "",
		soundVolume: 80,
		enter: "pop",
		enterMs: 250,
		enterFrom: "center",
		exit: "fade",
		exitMs: 250,
		exitTo: "center",
	};

	// Settings are independent for every roulette item, including old items.
	function forItem(item) {
		return { ...defaults, ...item?.presentation };
	}

	// Both OBS and the editor use the same motion, without generated CSS strings.
	function frames(animation, direction, leaving = false) {
		const offset = {
			center: "translate(0, 0)",
			left: "translateX(-110%)",
			right: "translateX(110%)",
			top: "translateY(-110%)",
			bottom: "translateY(110%)",
		}[direction] || "translate(0, 0)";
		const rest = { opacity: 1, transform: "translate(0, 0) scale(1)" };
		let first = { opacity: 0, transform: "translate(0, 0) scale(1)" };
		if (animation === "slide")
			first = { opacity: 1, transform: direction === "center" ? "scale(0)" : offset };
		if (animation === "zoom" || animation === "pop")
			first = { opacity: 0, transform: `${offset} scale(0.05)` };
		const result = animation === "none" ? [rest, rest]
			: animation === "pop" ? [first, { opacity: 1, transform: "scale(1.06)", offset: 0.75 }, rest]
				: [first, rest];
		return leaving ? result.reverse().map(({ offset: unused, ...frame }) => frame) : result;
	}
	const api = { defaults, animations, directions, forItem, frames };
	if (typeof module !== "undefined") module.exports = api;
	else scope.RewardPresentation = api;
})(globalThis);
