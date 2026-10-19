const { test } = require("node:test"),
  assert = require("node:assert/strict");
const {
  initialReward,
  normalizeReward,
  normalizeCaption,
  normalizeDuration,
} = require("../core/model.cjs");
const {
  defaults,
  durationDefaults,
  formatDuration,
  anchors,
  placement,
  forItem,
} = require("../overlay/caption.js");
test("legacy video has no text and duration stays opt-in", () => {
  const r = initialReward("video");
  delete r.video.caption;
  delete r.video.duration;
  const saved = normalizeReward(r);
  assert.deepEqual(saved.video.caption, defaults);
  assert.deepEqual(saved.video.duration, durationDefaults);
});
test("caption and duration styles validate separately and survive settings round trips", () => {
  const r = initialReward("video");
  r.video.caption = {
    ...defaults,
    text: "Текст\nна видео",
    x: -30,
    y: -100,
    size: 64,
    color: "#fedcba",
    font: "Impact",
  };
  r.video.duration = {
    ...durationDefaults,
    enabled: true,
    color: "#123456",
    size: 28,
  };
  assert.deepEqual(normalizeReward(r).video, r.video);
  for (const patch of [
    { text: "a".repeat(301) },
    { size: 0 },
    { color: "red" },
    { font: "Arial; background:url(test)" },
    { x: Infinity },
    { y: -1081 },
    { anchor: "outside" },
  ])
    assert.throws(() => normalizeCaption({ ...defaults, ...patch }));
  assert.throws(() =>
    normalizeDuration({ ...durationDefaults, enabled: "true" }),
  );
});
test("nine anchors preserve old placement and scale offsets inside the frame", () => {
  const legacy = { ...defaults };
  delete legacy.anchor;
  assert.equal(normalizeCaption(legacy).anchor, "bottom-center");
  for (const [i, anchor] of anchors.entries()) {
    assert.equal(normalizeCaption({ ...defaults, anchor }).anchor, anchor);
    assert.equal(
      normalizeDuration({ ...durationDefaults, anchor }).anchor,
      anchor,
    );
    const value = { ...defaults, anchor };
    const p = placement(value, 600, 340, 100, 40);
    assert.equal(p.left, 12 + (476 * (i % 3)) / 2);
    assert.equal(p.top, 12 + (276 * Math.floor(i / 3)) / 2);
    const scaled = placement(value, 300, 170, 50, 20, 0.5);
    assert.equal(scaled.left, p.left / 2);
    assert.equal(scaled.top, p.top / 2);
    for (const offset of [-10000, 10000]) {
      const edge = placement(
        { ...value, x: offset, y: offset },
        600,
        340,
        100,
        40,
      );
      assert.ok(edge.left >= 12 && edge.left <= 488);
      assert.ok(edge.top >= 12 && edge.top <= 288);
    }
  }
});
test("per-file captions preserve legacy text without overriding explicit blank text", () => {
  const reward = initialReward("video");
  reward.video.caption.text = "Старый общий текст";
  reward.items = [
    { id: "a", volume: 80, weight: 1 },
    { id: "b", volume: 80, weight: 1, captionText: "Второй ролик" },
    { id: "c", volume: 80, weight: 1, captionText: "" },
  ];
  const normalized = normalizeReward(reward);
  assert.deepEqual(
    normalized.items.map((item) => item.captionText),
    ["Старый общий текст", "Второй ролик", ""],
  );
  assert.deepEqual(
    reward.items.map((item) => forItem(reward.video, item).caption.text),
    normalized.items.map((item) => item.captionText),
  );
  assert.equal(
    Object.hasOwn(reward.items[0], "captionText"),
    false,
    "Read-only fallback does not mutate legacy data",
  );
  const omitted = structuredClone(normalized);
  delete omitted.items[1].captionText;
  assert.equal(
    normalizeReward(omitted, normalized).items[1].captionText,
    "Второй ролик",
  );
  for (const text of [false, 123, "x".repeat(301)]) {
    const bad = structuredClone(reward);
    bad.items[0].captionText = text;
    assert.throws(() => normalizeReward(bad));
  }
  assert.equal(
    normalizeReward({ ...reward, kind: "audio" }).items.some((i) =>
      Object.hasOwn(i, "captionText"),
    ),
    false,
  );
});
test("duration uses metadata minutes and seconds, not elapsed or viewer text", () => {
  assert.equal(formatDuration(24.9), "0:24");
  assert.equal(formatDuration(60), "1:00");
  assert.equal(formatDuration(600), "10:00");
  assert.equal(formatDuration(Infinity), "");
  assert.equal(formatDuration(NaN), "");
});
