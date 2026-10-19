const { randomInt, randomUUID } = require("node:crypto");
const {
  fonts: captionFonts,
  anchors: captionAnchors,
  defaults: captionDefaults,
  durationDefaults,
} = require("../overlay/caption.js");
function number(value, min, max, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max)
    throw Error(`${label}: от ${min} до ${max}`);
  return n;
}
function integer(value, min, max, label) {
  const n = number(value, min, max, label);
  if (!Number.isSafeInteger(n)) throw Error(`${label}: целое число`);
  return n;
}
function text(value, max, label, required = false) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw Error(`${label}: ${required ? "1–" : "до "}${max} символов`);
  return value.trim();
}
function color(value) {
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw Error("Неверный цвет");
  return value;
}
function initialReward(kind = "audio") {
  return {
    id: randomUUID(),
    kind,
    title: kind === "video" ? "Видео-награда" : "Звуковая награда",
    prompt: "",
    cost: 100,
    enabled: true,
    paused: false,
    input: false,
    background: "#239d89",
    streamLimit: 0,
    userLimit: 0,
    cooldown: 0,
    skipQueue: false,
    allowRepeats: false,
    chat: { enabled: false, command: "", users: [], cooldown: 5 },
    chatAccount: "",
    chatClientId: "",
    items: [],
    video: {
      mode: "fixed",
      x: 660,
      y: 370,
      width: 600,
      height: 340,
      border: 4,
      borderStyle: "solid",
      color: "#ffffff",
      radius: 16,
      angle: 0,
      caption: { ...captionDefaults },
      duration: { ...durationDefaults },
    },
    remoteId: "",
    account: "",
    clientId: "",
    sync: "draft",
  };
}
function normalizeSettings(input) {
  const r = {
    title: text(input.title, 45, "Название", true),
    prompt: text(input.prompt || "", 200, "Описание"),
    cost: integer(input.cost, 1, 1000000000, "Стоимость"),
    background: color(input.background),
    streamLimit: integer(input.streamLimit, 0, 1000000000, "Лимит за эфир"),
    userLimit: integer(input.userLimit, 0, 1000000000, "Лимит на зрителя"),
    cooldown: integer(input.cooldown, 0, 604800, "Перезарядка"),
  };
  for (const key of ["enabled", "paused", "input", "skipQueue"]) {
    if (typeof input[key] !== "boolean")
      throw Error("Неверный переключатель: " + key);
    r[key] = input[key];
  }
  return r;
}
function fromTwitch(r) {
  return normalizeSettings({
    title: r.title,
    prompt: r.prompt,
    cost: r.cost,
    background: r.background_color,
    enabled: r.is_enabled,
    paused: r.is_paused,
    input: r.is_user_input_required,
    skipQueue: r.should_redemptions_skip_request_queue,
    streamLimit: r.max_per_stream_setting?.is_enabled
      ? r.max_per_stream_setting.max_per_stream
      : 0,
    userLimit: r.max_per_user_per_stream_setting?.is_enabled
      ? r.max_per_user_per_stream_setting.max_per_user_per_stream
      : 0,
    cooldown: r.global_cooldown_setting?.is_enabled
      ? r.global_cooldown_setting.global_cooldown_seconds
      : 0,
  });
}
function normalizeReward(input, prior) {
  if (!input || !["audio", "video"].includes(input.kind))
    throw Error("Выберите звук или видео");
  const r = { ...initialReward(input.kind), ...normalizeSettings(input) },
    v = input.video || r.video;
  r.allowRepeats = input.allowRepeats ?? prior?.allowRepeats ?? false;
  if (typeof r.allowRepeats !== "boolean")
    throw Error("Неверный режим рулетки");
  r.chat = normalizeChat(input.chat ?? prior?.chat ?? r.chat);
  if (
    !["fixed", "random"].includes(v.mode) ||
    !["solid", "dashed", "dotted", "double", "none"].includes(v.borderStyle)
  )
    throw Error("Неверный стиль видео");
  r.video = {
    mode: v.mode,
    x: number(v.x, 0, 1920, "X"),
    y: number(v.y, 0, 1080, "Y"),
    width: number(v.width, 40, 1920, "Ширина"),
    height: number(v.height, 40, 1080, "Высота"),
    border: number(v.border, 0, 40, "Рамка"),
    radius: number(v.radius, 0, 200, "Скругление"),
    angle: number(v.angle, 0, 45, "Наклон"),
    color: color(v.color),
    borderStyle: v.borderStyle,
    caption: normalizeCaption(
      v.caption ?? prior?.video?.caption ?? captionDefaults,
    ),
    duration: normalizeDuration(
      v.duration ?? prior?.video?.duration ?? durationDefaults,
    ),
  };
  r.video.x = Math.min(r.video.x, 1920 - r.video.width);
  r.video.y = Math.min(r.video.y, 1080 - r.video.height);
  if (!Array.isArray(input.items) || input.items.length > 200)
    throw Error("Не больше 200 файлов в награде");
  const seen = new Set();
  r.items = input.items.map((item) => {
    if (typeof item.id !== "string" || seen.has(item.id))
      throw Error("Повтор файла");
    seen.add(item.id);
    return {
      id: item.id,
      volume: number(item.volume, 0, 100, "Громкость"),
      weight: integer(item.weight, 0, 10000, "Вес"),
      ...(input.kind === "video"
        ? {
            captionText: text(
              item.captionText ??
                prior?.items.find((old) => old.id === item.id)?.captionText ??
                r.video.caption.text,
              300,
              "Текст ролика",
            ),
          }
        : {}),
    };
  });
  if (prior)
    for (const key of [
      "id",
      "remoteId",
      "account",
      "clientId",
      "sync",
      "createdAt",
      "chatAccount",
      "chatClientId",
    ])
      r[key] = prior[key];
  return r;
}
function normalizeCaption(value) {
  if (!value || !captionFonts.includes(value.font))
    throw Error("Выберите шрифт надписи");
  const anchor = value.anchor ?? captionDefaults.anchor;
  if (!captionAnchors.includes(anchor))
    throw Error("Выберите положение текста");
  return {
    text: text(value.text, 300, "Текст на видео"),
    anchor,
    x: number(value.x, -1920, 1920, "Смещение текста X"),
    y: number(value.y, -1080, 1080, "Смещение текста Y"),
    size: number(value.size, 8, 200, "Размер текста"),
    color: color(value.color),
    font: value.font,
  };
}
function normalizeDuration(value) {
  if (!value || typeof value.enabled !== "boolean")
    throw Error("Неверный переключатель длительности видео");
  const { text: unused, ...style } = normalizeCaption({ ...value, text: "" });
  return { enabled: value.enabled, ...style };
}
function normalizeChat(value) {
  if (!value || typeof value.enabled !== "boolean")
    throw Error("Неверный переключатель команды чата");
  const command = text(value.command || "", 33, "Команда").toLowerCase();
  if (command && !/^![\p{L}\p{N}_-]{1,32}$/u.test(command))
    throw Error(
      "Команда: ! и до 32 букв, цифр, дефисов или подчёркиваний, без пробелов",
    );
  const source =
    typeof value.users === "string"
      ? value.users.split(/[\s,;]+/).filter(Boolean)
      : value.users;
  if (!Array.isArray(source) || source.length > 200)
    throw Error("Укажите не больше 200 разрешённых ников");
  const users = [
    ...new Set(
      source.map((login) => {
        if (typeof login !== "string") throw Error("Неверный Twitch-ник");
        const result = login.trim().replace(/^@/, "").toLowerCase();
        if (!/^[a-z0-9_]{1,25}$/.test(result))
          throw Error(
            "Нужен Twitch-логин латиницей, без ссылки: " + login.slice(0, 40),
          );
        return result;
      }),
    ),
  ];
  if (value.enabled && (!command || !users.length))
    throw Error("Для команды укажите её текст и хотя бы один разрешённый ник");
  return {
    enabled: value.enabled,
    command,
    users,
    cooldown: integer(value.cooldown ?? 5, 0, 3600, "Пауза между командами"),
  };
}
function twitchFields(r, create = false) {
  const fields = {
    title: r.title,
    prompt: r.prompt,
    cost: r.cost,
    background_color: r.background,
    is_enabled: r.enabled,
    is_user_input_required: r.input,
    is_max_per_stream_enabled: r.streamLimit > 0,
    ...(r.streamLimit > 0 ? { max_per_stream: r.streamLimit } : {}),
    is_max_per_user_per_stream_enabled: r.userLimit > 0,
    ...(r.userLimit > 0 ? { max_per_user_per_stream: r.userLimit } : {}),
    is_global_cooldown_enabled: r.cooldown > 0,
    ...(r.cooldown > 0 ? { global_cooldown_seconds: r.cooldown } : {}),
    should_redemptions_skip_request_queue: r.skipQueue,
  };
  if (!create) fields.is_paused = r.paused;
  return fields;
}
function choose(items, rng = randomInt) {
  const total = items.reduce((n, i) => n + i.weight, 0);
  if (!total) throw Error("Добавьте файл с весом больше нуля");
  let n = rng(total);
  for (const item of items) {
    n -= item.weight;
    if (n < 0) return item;
  }
  throw Error("Некорректный генератор случайных чисел");
}
function chooseCycle(items, previous = {}, rng = randomInt) {
  const active = items.filter((item) => item.weight > 0);
  const used = new Set(previous.used || []);
  let remaining = active.filter((item) => !used.has(item.id));
  if (!remaining.length) {
    used.clear();
    remaining = active;
  }
  // Keep the last item out of the first draw of a new cycle, when possible.
  if (!used.size && remaining.length > 1)
    remaining = remaining.filter((item) => item.id !== previous.last);
  const selected = choose(remaining, rng);
  used.add(selected.id);
  return { selected, cycle: { used: [...used], last: selected.id } };
}
module.exports = {
  initialReward,
  normalizeReward,
  normalizeChat,
  normalizeCaption,
  normalizeDuration,
  normalizeSettings,
  fromTwitch,
  twitchFields,
  choose,
  chooseCycle,
  integer,
};
