(function (root) {
  const fonts = [
    "Arial",
    "Segoe UI",
    "Verdana",
    "Tahoma",
    "Trebuchet MS",
    "Georgia",
    "Impact",
  ];
  const defaults = {
    text: "",
    anchor: "bottom-center",
    x: 0,
    y: 0,
    size: 48,
    color: "#ffffff",
    font: "Arial",
  };
  const durationDefaults = {
    enabled: false,
    anchor: "bottom-center",
    x: 0,
    y: -64,
    size: 32,
    color: "#ffffff",
    font: "Arial",
  };
  const anchors = [
    "top-left",
    "top-center",
    "top-right",
    "middle-left",
    "middle-center",
    "middle-right",
    "bottom-left",
    "bottom-center",
    "bottom-right",
  ];
  function placement(value, width, height, textWidth, textHeight, scale = 1) {
    const anchor = anchors.includes(value.anchor)
      ? value.anchor
      : defaults.anchor;
    const index = anchors.indexOf(anchor);
    const inset = Math.min(12 * scale, width / 4, height / 4);
    const roomX = Math.max(0, width - 2 * inset - textWidth);
    const roomY = Math.max(0, height - 2 * inset - textHeight);
    const clamp = (offset, room) => Math.max(0, Math.min(room, offset));
    return {
      left:
        inset +
        clamp((roomX * (index % 3)) / 2 + (value.x || 0) * scale, roomX),
      top:
        inset +
        clamp(
          (roomY * Math.floor(index / 3)) / 2 + (value.y || 0) * scale,
          roomY,
        ),
      align: ["left", "center", "right"][index % 3],
    };
  }
  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "";
    const total = Math.floor(seconds),
      minutes = Math.floor(total / 60);
    return `${minutes}:${String(total % 60).padStart(2, "0")}`;
  }
  function forItem(video, item) {
    return {
      ...video,
      caption: {
        ...defaults,
        ...video?.caption,
        text: item?.captionText ?? video?.caption?.text ?? "",
      },
    };
  }
  function render(
    container,
    value = defaults,
    scale = 1,
    kind = "caption",
    heightLimit = Infinity,
  ) {
    let el = container.querySelector(
      `:scope > .video-caption[data-kind="${kind}"]`,
    );
    if (!value.text?.trim()) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement("div");
      el.className = "video-caption";
      el.dataset.kind = kind;
      container.append(el);
    }
    const width = container.clientWidth,
      height = container.clientHeight;
    if (!width || !height) return;
    const inset = Math.min(12 * scale, width / 4, height / 4);
    el.textContent = value.text;
    Object.assign(el.style, {
      maxWidth: Math.max(1, width - 2 * inset) + "px",
      fontFamily: `"${fonts.includes(value.font) ? value.font : defaults.font}", sans-serif`,
      color: value.color || defaults.color,
      textShadow: `0 ${2 * scale}px ${4 * scale}px #000, 0 0 ${2 * scale}px #000`,
    });
    let size = (value.size || defaults.size) * scale;
    el.style.fontSize = size + "px";
    // Fit long captions without changing video geometry or cutting off glyphs.
    while (
      (el.scrollHeight > Math.min(height, heightLimit) - 2 * inset ||
        el.scrollWidth > width - 2 * inset) &&
      size > 2 * scale
    ) {
      size = Math.max(2 * scale, size - scale);
      el.style.fontSize = size + "px";
    }
    const pos = placement(
      value,
      width,
      height,
      el.offsetWidth,
      el.offsetHeight,
      scale,
    );
    el.style.left = pos.left + "px";
    el.style.top = pos.top + "px";
    el.style.textAlign = pos.align;
    return el;
  }
  function renderAll(container, video, seconds, scale = 1) {
    const d = video.duration || durationDefaults;
    const duration = render(
      container,
      { ...d, text: d.enabled ? formatDuration(seconds) : "" },
      scale,
      "duration",
    );
    const autoStack =
      duration &&
      d.x === durationDefaults.x &&
      d.y === durationDefaults.y &&
      (d.anchor || defaults.anchor) === defaults.anchor &&
      (video.caption?.anchor || defaults.anchor) === defaults.anchor;
    const caption = render(
      container,
      video.caption,
      scale,
      "caption",
      autoStack
        ? container.clientHeight - duration.offsetHeight - 12 * scale
        : Infinity,
    );
    if (autoStack && caption) {
      duration.style.top =
        Math.max(
          4 * scale,
          caption.offsetTop - duration.offsetHeight - 8 * scale,
        ) + "px";
    }
  }
  const api = {
    fonts,
    anchors,
    placement,
    defaults,
    durationDefaults,
    formatDuration,
    forItem,
    render,
    renderAll,
  };
  if (typeof module === "object") module.exports = api;
  else root.RewardCaption = api;
})(globalThis);
