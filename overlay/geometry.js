(function (scope) {
  function layout(v, ratio, random = Math.random) {
    if (!Number.isFinite(ratio) || ratio <= 0) ratio = 16 / 9;
    const rad = ((random() * 2 - 1) * v.angle * Math.PI) / 180;
    let border =
      v.borderStyle === "none"
        ? 0
        : Math.min(v.border, (Math.min(v.width, v.height) - 1) / 2);
    const contentWidth = Math.min(
      v.width - border * 2,
      (v.height - border * 2) * ratio,
    );
    let width = contentWidth + border * 2,
      height = contentWidth / ratio + border * 2;
    const c = Math.abs(Math.cos(rad)),
      s = Math.abs(Math.sin(rad));
    let bw = width * c + height * s,
      bh = width * s + height * c;
    const scale = Math.min(1, 1920 / bw, 1080 / bh);
    width *= scale;
    height *= scale;
    border *= scale;
    bw *= scale;
    bh *= scale;
    const cx =
      v.mode === "random"
        ? bw / 2 + random() * (1920 - bw)
        : Math.max(bw / 2, Math.min(1920 - bw / 2, v.x + v.width / 2));
    const cy =
      v.mode === "random"
        ? bh / 2 + random() * (1080 - bh)
        : Math.max(bh / 2, Math.min(1080 - bh / 2, v.y + v.height / 2));
    return {
      x: cx - width / 2,
      y: cy - height / 2,
      width,
      height,
      border,
      angle: (rad * 180) / Math.PI,
      bw,
      bh,
      cx,
      cy,
    };
  }
  if (typeof module !== "undefined") module.exports = { layout };
  else scope.RewardGeometry = { layout };
})(globalThis);
