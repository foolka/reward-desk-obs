function startupNotice(error, { obsPlugin = false, tr = (text) => text } = {}) {
  const title = obsPlugin ? "Reward Desk OBS" : "Reward Desk";
  if (error?.code === "PROFILE_REDIRECTED") {
    return {
      type: "info",
      title,
      message: tr("Нужен обычный запуск"),
      detail: tr("Windows направила этот запуск в другую папку профиля. Чтобы не открыть пустой список наград, программа не запущена. Существующие награды и настройки не изменены.") +
        "\n\n" + tr(obsPlugin
          ? "После завершения эфира закройте OBS и откройте его обычным ярлыком из меню «Пуск» или панели задач. Модуль Reward Desk OBS запустится вместе с ним."
          : "Откройте Reward Desk обычным ярлыком из меню «Пуск» или панели задач."),
      buttons: [tr("Понятно")],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
  }
  return {
    type: "error",
    title,
    message: tr("Не удалось запустить программу"),
    detail: String(error?.message || error),
    buttons: [tr("Закрыть")],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
}

module.exports = { startupNotice };
