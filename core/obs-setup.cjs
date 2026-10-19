const fs = require("node:fs");
const { randomBytes } = require("node:crypto");
function prepareObs(file, { running, backup, io = fs }) {
  if (!io.existsSync(file))
    throw Error("Сначала установите и один раз запустите OBS Studio.");
  const raw = io.readFileSync(file, "utf8");
  let current;
  try {
    current = JSON.parse(raw);
  } catch {
    throw Error("Не удалось прочитать настройки OBS. Файл не изменён.");
  }
  const port = Number(current.server_port || 4455);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("В OBS указан неверный порт подключения.");
  if (current.server_enabled)
    return {
      config: {
        port,
        password: current.auth_required ? current.server_password || "" : "",
      },
      prepared: !running(),
    };
  if (running())
    throw Error(
      "Для первой настройки закройте OBS через «Выход» и нажмите эту кнопку ещё раз. После настройки запустите OBS обычным способом. Эфир или запись не прерывайте.",
    );
  const next = {
    ...current,
    server_enabled: true,
    server_port: port,
    auth_required: true,
    server_password:
      current.auth_required && current.server_password
        ? current.server_password
        : randomBytes(24).toString("base64url"),
  };
  backup(raw);
  if (running() || io.readFileSync(file, "utf8") !== raw)
    throw Error(
      "OBS или его настройки изменились. Повторите настройку после закрытия OBS.",
    );
  const temp = file + ".reward-desk-" + randomBytes(6).toString("hex") + ".tmp";
  try {
    io.writeFileSync(temp, JSON.stringify(next, null, 2), { flag: "wx" });
    io.renameSync(temp, file);
  } finally {
    if (io.existsSync(temp)) io.unlinkSync(temp);
  }
  return { config: { port, password: next.server_password }, prepared: true };
}
module.exports = { prepareObs };
