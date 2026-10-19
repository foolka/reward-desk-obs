(() => {
  const descriptions = {
    obsRecovery:
      "Подключает локальный OBS WebSocket. Если активный источник с точным URL Reward Desk не отвечает 20 секунд, обновляет только его. Не прерывает текущую награду, не запускает эфир и не меняет сцены. Не чаще раза в минуту, до трёх попыток за пять минут. Пароль хранится зашифрованным на этом ПК. Прерванный показ требует решения в очереди; ожидающие награды не теряются.",
    autoUpdates:
      "Проверяет публичный стабильный выпуск на GitHub при запуске. Установка начинается только после подтверждения, с резервной копией профиля. Вход в GitHub не требуется.",
    title: "Название награды, которое зрители видят в Twitch. До 45 символов.",
    prompt:
      "Описание награды в Twitch: например, что произойдёт после покупки. До 200 символов.",
    cost: "Сколько баллов канала зритель потратит на одну активацию награды.",
    background:
      "Цвет карточки награды в Twitch. На цвет рамки видео не влияет.",
    enabled:
      "Разрешает зрителям покупать награду в Twitch. Выключение не удаляет награду и её настройки.",
    paused:
      "Временно приостанавливает покупку этой награды в Twitch. Уже созданная очередь продолжает обрабатываться.",
    input: "При покупке Twitch попросит зрителя написать сообщение.",
    streamLimit:
      "Максимальное число покупок этой награды за один эфир. Снятая галочка означает отсутствие этого лимита.",
    userLimit:
      "Сколько раз один зритель может купить эту награду за эфир. Снятая галочка отключает ограничение.",
    cooldown:
      "Общая пауза в секундах между покупками этой награды всеми зрителями. Это не задержка воспроизведения.",
    skipQueue:
      "Twitch сразу считает покупку завершённой. Вернуть баллы через приложение после этого нельзя; покупки во время отключения приложения могут быть пропущены.",
    repeats:
      "Включено: каждый раз выбирается любой файл с учётом веса, включая только что выпавший. Выключено: каждый файл с положительным весом показывается один раз за цикл. Очередь резервирует файлы, но отменённые до показа возвращаются в выбор. Уже начатый ролик считается показанным, даже при остановке. Цикл общий для зрителей и сохраняется после перезапуска. Тест отдельного файла цикл не меняет.",
    chatEnabled:
      "Бесплатный запуск из чата вашего канала, независимо от доступности, цены и лимитов награды Twitch. Можно включить у локальной награды без создания в Twitch. Доступ только у ников из списка; общая очередь, пауза воспроизведения и цикл рулетки сохраняются. Reward Desk должен работать.",
    chatCommand:
      "Сообщение целиком, например !video или !звук, без аргументов. Регистр букв не важен. Одна команда может запускать только одну награду. Сообщения с покупкой за баллы и сообщения из чужого канала общего чата не запускают команду повторно.",
    chatUsers:
      "Twitch-логины латиницей через запятую, пробел или новую строку. Можно с @. Только эти пользователи могут запускать команду, включая владельца и модераторов: их тоже нужно добавить. Пустой список не даёт доступ всем.",
    chatCooldown:
      "Общая пауза между бесплатными запусками этой команды для всех разрешённых пользователей. По умолчанию 5 секунд, ноль отключает паузу. На покупки за баллы не влияет.",
    captionText:
      "Надпись только для выбранного ролика. У каждого файла рулетки свой текст; пустое поле отключает подпись этого файла. Шрифт, цвет, размер и положение общие для видео этой награды. Переносы строк сохраняются.",
    captionFont:
      "Шрифт надписи. Используется установленный на компьютере шрифт; если его нет, применяется системный шрифт без засечек.",
    captionSize:
      "Размер в пикселях источника OBS. Длинный текст переносится и при необходимости уменьшается, чтобы не обрезаться краями видео.",
    captionColor:
      "Цвет текста. Тёмная тень помогает читать надпись на светлом кадре.",
    captionX:
      "Смещение от выбранной позиции по горизонтали в пикселях источника: минус влево, плюс вправо. Текст остаётся внутри кадра.",
    captionY:
      "Смещение от выбранной позиции по вертикали: минус поднимает надпись, плюс опускает. Текст остаётся внутри кадра.",
    captionAnchor:
      "Помещает текст в выбранный угол, середину стороны или центр видео и обнуляет X/Y. Затем можно точно подвинуть его полями смещения. У подписи и длительности независимые позиции; есть небольшой отступ от краёв.",
    durationEnabled:
      "Показывает полную длительность текущего ролика, например 0:24. Это не обратный отсчёт. При исходной нижней центральной позиции, X=0 и Y=−64 располагается над подписью. Выберите другую позицию или задайте свои смещения и оформление.",
    volume:
      "Громкость этого файла от 0 до 100%. Ноль означает воспроизведение без звука.",
    weight:
      "Относительный вес файла. При полном рандоме вес 3 даёт втрое больший шанс, чем вес 1. В цикле вес влияет на очередность среди оставшихся файлов; каждый всё равно выпадет один раз. Ноль исключает файл из рулетки.",
    chance:
      "При полном рандоме показан шанс следующего выбора. Без повторов показана доля веса: фактический шанс пересчитывается среди оставшихся в цикле файлов.",
    mode: "Фиксированная область: размещение вокруг выбранного центра; область можно перетащить на превью. Случайное место: позиция заново выбирается внутри OBS-источника при каждом показе.",
    width:
      "Максимальная ширина видео вместе с рамкой в пикселях источника 1920 × 1080. Пропорции сохраняются: фактическая ширина может быть меньше.",
    height:
      "Максимальная высота видео вместе с рамкой. Видео вписывается без растяжения и без добавленных пустых полос.",
    x: "Горизонтальная координата верхнего левого угла заданной области. Само видео центрируется в ней. В случайном режиме используется только для предпросмотра.",
    y: "Вертикальная координата верхнего левого угла заданной области. Само видео центрируется в ней. В случайном режиме используется только для предпросмотра.",
    border:
      "Толщина рамки в пикселях OBS-источника. Рамка идёт по краю кадра, не добавляя пустые поля.",
    borderStyle:
      "Сплошная, пунктирная, точечная или двойная рамка. «Без рамки» полностью отключает её независимо от толщины.",
    borderColor:
      "Цвет рамки вокруг видео в OBS. Не влияет на цвет карточки награды Twitch.",
    radius:
      "Скругление углов видео и его рамки в пикселях. Ноль оставляет прямые углы.",
    tilt: "При каждом показе видео получает случайный наклон в пределах выбранного угла. Выключение оставляет видео ровным.",
    angle:
      "Предельный наклон в обе стороны. Например, 10° означает случайный угол от −10° до +10°.",
    client:
      "Публичный Client ID регистрации приложения Twitch, не пароль. Другая регистрация не сможет управлять наградами, созданными прежним Client ID.",
    port: "Локальный порт OBS-источника. При его изменении нужно заменить ссылку в OBS. Обычно менять не требуется.",
    source:
      "Постоянная ссылка для источника «Браузер» в OBS, размер 1920 × 1080. Ссылка содержит ключ доступа: не публикуйте её.",
  };
  const tooltip = document.createElement("div");
  tooltip.id = "option-tooltip";
  tooltip.role = "tooltip";
  tooltip.hidden = true;
  document.body.append(tooltip);
  let anchor;
  function hide() {
    anchor?.removeAttribute("aria-describedby");
    anchor = null;
    tooltip.hidden = true;
  }
  function position() {
    if (!anchor?.isConnected) return hide();
    const a = anchor.getBoundingClientRect(),
      t = tooltip.getBoundingClientRect(),
      width = document.documentElement.clientWidth,
      height = document.documentElement.clientHeight;
    tooltip.style.left = `${Math.max(8, Math.min(a.left, width - t.width - 8))}px`;
    const y =
      a.bottom + 8 + t.height <= height - 8
        ? a.bottom + 8
        : a.top - t.height - 8;
    tooltip.style.top = `${Math.max(8, Math.min(y, height - t.height - 8))}px`;
  }
  function show(button) {
    if (!button) return;
    hide();
    anchor = button;
    tooltip.textContent = tr(descriptions[button.dataset.help]);
    tooltip.hidden = false;
    button.setAttribute("aria-describedby", tooltip.id);
    position();
  }
  function add(target, key) {
    if (!target || target.querySelector(".option-help")) return;
    // Keep the translated leaf separate from the help button during static binding.
    if (target.dataset.i18n && !target.children.length) {
      const text = document.createElement("span");
      text.dataset.i18n = target.dataset.i18n;
      text.textContent = target.textContent;
      delete target.dataset.i18n;
      target.replaceChildren(text);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "option-help";
    button.dataset.help = key;
    button.dataset.helpLabel = "";
    button.setAttribute("aria-label", tr("Справка: {label}", {
      label: target.textContent.trim(),
    }));
    button.innerHTML = '<i data-lucide="circle-help" aria-hidden="true"></i>';
    target.append(button);
  }
  function labelHelp(control, key) {
    const label = control?.closest("label");
    if (!label || label.querySelector(".option-help")) return;
    if (label.classList.contains("check")) return add(label, key);
    const text = label.querySelector(":scope > .field-label, :scope > span:not(.select-control)") || [...label.childNodes].find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
    );
    if (!text) return;
    if (text.classList?.contains("field-label")) return add(text, key);
    const heading = document.createElement("span");
    heading.className = "field-label";
    text.before(heading);
    heading.append(text);
    add(heading, key);
  }
  function enhance() {
    if (anchor && !anchor.isConnected) hide();
    document
      .querySelectorAll("[data-field], [data-video]")
      .forEach((control) => {
        const key = control.dataset.field || control.dataset.video;
        if (descriptions[key]) labelHelp(control, key);
      });
    for (const [id, key] of Object.entries({
      "auto-updates": "autoUpdates",
      "allow-repeats": "repeats",
      "chat-enabled": "chatEnabled",
      "chat-command": "chatCommand",
      "chat-users": "chatUsers",
      "chat-cooldown": "chatCooldown",
      "caption-text": "captionText",
      "caption-font": "captionFont",
      "caption-size": "captionSize",
      "caption-color": "captionColor",
      "caption-x": "captionX",
      "caption-y": "captionY",
      "duration-enabled": "durationEnabled",
      "duration-font": "captionFont",
      "duration-size": "captionSize",
      "duration-color": "captionColor",
      "duration-x": "captionX",
      "duration-y": "captionY",
      "border-style": "borderStyle",
      "border-color": "borderColor",
      tilt: "tilt",
      angle: "angle",
      "client-id": "client",
      port: "port",
      "overlay-url": "source",
    }))
      labelHelp(document.getElementById(id), key);
    add(
      document.querySelector(".editor-section:has(#position-mode) h3"),
      "mode",
    );
    const media = document.querySelector(".media-head");
    if (media) {
      media.removeAttribute("aria-hidden");
      ["volume", "weight", "chance"].forEach((key, n) =>
        add(media.children[n + 1], key),
      );
    }
    refreshLanguage();
  }
  function refreshLanguage() {
    document.querySelectorAll("[data-help-label]").forEach((button) => {
      button.setAttribute("aria-label", tr("Справка: {label}", {
        label: button.parentElement.textContent.trim(),
      }));
    });
    if (anchor) {
      tooltip.textContent = tr(descriptions[anchor.dataset.help]);
      position();
    }
  }
  document.addEventListener("pointerover", (event) => {
    const button = event.target.closest(".option-help");
    if (button && button !== anchor) show(button);
  });
  document.addEventListener("pointerout", (event) => {
    if (
      anchor?.contains(event.target) &&
      !anchor.contains(event.relatedTarget) &&
      document.activeElement !== anchor
    )
      hide();
  });
  document.addEventListener("focusin", (event) =>
    show(event.target.closest(".option-help")),
  );
  document.addEventListener("focusout", (event) => {
    if (event.target === anchor) hide();
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".option-help");
    if (button) {
      event.preventDefault();
      show(button);
    } else hide();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  });
  window.addEventListener("resize", () => {
    if (anchor) position();
  });
  document.addEventListener(
    "scroll",
    () => {
      if (anchor) position();
    },
    true,
  );
  window.RewardHelp = { enhance, refreshLanguage };
})();
