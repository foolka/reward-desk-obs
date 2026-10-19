#include "dock.hpp"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QFile>
#include <QFileInfo>
#include <QDir>
#include <QJsonDocument>
#include <QJsonArray>
#include <QNetworkReply>
#include <QSettings>
#include <QStandardPaths>
#include <QProcess>
#include <QApplication>
#include <QClipboard>
#include <QStyle>
#include <QMessageBox>
#include <QUrl>
#include <QCoreApplication>

RewardDock::RewardDock(const QString &path, const QString &moduleRuntime, bool test) : profile(path), runtime(moduleRuntime), offlineTest(test) {
    setMinimumWidth(260);
    auto layout = new QVBoxLayout(this);
    layout->setContentsMargins(12, 12, 12, 12);
    layout->setSpacing(9);
    heading = new QLabel("Reward Desk OBS " REWARD_DESK_VERSION, this);
    auto font = heading->font(); font.setBold(true); heading->setFont(font);
    layout->addWidget(heading);
    connection = new QLabel(this); connection->setWordWrap(true); layout->addWidget(connection);
    source = new QLabel(this); source->setWordWrap(true); layout->addWidget(source);
    queue = new QLabel(this); queue->setWordWrap(true); layout->addWidget(queue);
    auto actions = new QHBoxLayout;
    pauseButton = new QPushButton(this);
    stopButton = new QPushButton(this);
    pauseButton->setCheckable(true);
    pauseButton->setIcon(style()->standardIcon(QStyle::SP_MediaPause));
    stopButton->setIcon(style()->standardIcon(QStyle::SP_MediaStop));
    actions->addWidget(pauseButton); actions->addWidget(stopButton); layout->addLayout(actions);
    connect(pauseButton, &QPushButton::clicked, this, [this] { pauseButton->setChecked(paused); command("pause", !paused); });
    connect(stopButton, &QPushButton::clicked, this, [this] {
        if (QMessageBox::question(this, "Reward Desk", text("Остановить текущую награду? Очередь останется.", "Зупинити поточну нагороду? Черга залишиться.", "Stop the current reward? The queue will remain."),
            QMessageBox::Yes | QMessageBox::No, QMessageBox::No) == QMessageBox::Yes) command("stop");
    });
    editorButton = new QPushButton(this); editorButton->setIcon(style()->standardIcon(QStyle::SP_FileDialogDetailedView));
    layout->addWidget(editorButton);
    connect(editorButton, &QPushButton::clicked, this, [this] { command("open-editor"); });
    auto tools = new QHBoxLayout;
    copyButton = new QPushButton(this); copyButton->setIcon(style()->standardIcon(QStyle::SP_FileLinkIcon));
    updateButton = new QPushButton(this); updateButton->setIcon(style()->standardIcon(QStyle::SP_BrowserReload));
    tools->addWidget(copyButton); tools->addWidget(updateButton); layout->addLayout(tools);
    connect(copyButton, &QPushButton::clicked, this, [this] {
        if (!sourceUrl.isEmpty()) { QApplication::clipboard()->setText(sourceUrl); warning->setText(text("Ссылка OBS скопирована · 1920 × 1080", "Посилання OBS скопійовано · 1920 × 1080", "OBS URL copied · 1920 × 1080")); }
    });
    connect(updateButton, &QPushButton::clicked, this, [this] { command("check-updates"); });
    update = new QLabel(this); update->setWordWrap(true); layout->addWidget(update);
    warning = new QLabel(this); warning->setWordWrap(true); layout->addWidget(warning);
    logTitle = new QLabel(this); layout->addWidget(logTitle);
    logEmpty = new QLabel(this); logEmpty->setWordWrap(true); layout->addWidget(logEmpty);
    log = new QPlainTextEdit(this); log->setReadOnly(true); log->setMaximumBlockCount(5);
    log->setFrameShape(QFrame::NoFrame);
    log->setMaximumHeight(90); log->setMinimumHeight(65); log->hide(); layout->addWidget(log);
    startButton = new QPushButton(this); startButton->setIcon(style()->standardIcon(QStyle::SP_MediaPlay));
    connect(startButton, &QPushButton::clicked, this, [this] { start(); });
    layout->addWidget(startButton); layout->addStretch();
    for (auto button : {pauseButton, stopButton, editorButton, copyButton, updateButton, startButton}) button->setMinimumHeight(30);
    labels(); disconnected(text("Подключение к приложению…", "Підключення до застосунку…", "Connecting to the app…"));
    connect(&timer, &QTimer::timeout, this, [this] { poll(); });
    timer.start(2500);
    QTimer::singleShot(0, this, [this] { poll(); });
}
QString RewardDock::text(const char *ru, const char *uk, const char *en) const {
    return QString::fromUtf8(language == "en" ? en : language == "uk" ? uk : ru);
}
void RewardDock::labels() {
    pauseButton->setText(paused ? text("Продолжить", "Продовжити", "Resume") : text("Пауза", "Пауза", "Pause"));
    stopButton->setText(text("Остановить", "Зупинити", "Stop"));
    pauseButton->setToolTip(text("Приостановить следующие награды. Текущая доиграет.", "Призупинити наступні нагороди. Поточна дограє.", "Pause the queue. The current reward will finish."));
    editorButton->setText(text("Открыть редактор", "Відкрити редактор", "Open editor"));
    copyButton->setText(text("Источник", "Джерело", "Source"));
    copyButton->setToolTip(text("Копировать ссылку OBS · 1920 × 1080", "Копіювати посилання OBS · 1920 × 1080", "Copy OBS URL · 1920 × 1080"));
    updateButton->setText(text("Обновления", "Оновлення", "Updates"));
    startButton->setText(text("Запустить Reward Desk", "Запустити Reward Desk", "Start Reward Desk"));
    logTitle->setText(text("Последние события", "Останні події", "Recent events"));
    logEmpty->setText(text("Пока нет событий", "Поки немає подій", "No events yet"));
    log->setAccessibleName(logTitle->text());
}
void RewardDock::start() {
    if (offlineTest) return;
    started = true;
    const auto executable = QDir(runtime).filePath("RewardDeskOBS.exe");
    if (!QFileInfo::exists(executable) || !QProcess::startDetached(executable, {"--obs-parent", QString::number(QCoreApplication::applicationPid())}, runtime))
        warning->setText(text("Модуль плагина не найден. Повторите установку Reward Desk OBS. Данные не изменены.", "Модуль плагіна не знайдено. Повторіть установлення Reward Desk OBS. Дані не змінено.", "Plugin runtime not found. Reinstall Reward Desk OBS. Data is unchanged."));
}
void RewardDock::poll() {
    if (busy) return;
    QFile file(QDir(profile).filePath("obs-control-endpoint.json"));
    if (!file.open(QIODevice::ReadOnly)) {
        disconnected(text("Reward Desk не запущен", "Reward Desk не запущено", "Reward Desk is not running"));
        if (!started) start();
        return;
    }
    const auto value = QJsonDocument::fromJson(file.read(4096)).object();
    QUrl url(value["origin"].toString());
    const auto key = value["token"].toString();
    if (value["protocol"].toInt() != 1 || url.scheme() != "http" || url.host() != "127.0.0.1" ||
        url.port() <= 0 || !url.userInfo().isEmpty() || !url.path().isEmpty() || key.size() != 64) {
        disconnected(text("Несовместимая версия приложения", "Несумісна версія застосунку", "Incompatible app version")); return;
    }
    origin = url.toString(); token = key;
    request("/dock/state");
}
void RewardDock::command(const QString &name, const QJsonValue &arg) {
    if (!online || busy) return;
    request("/dock/command", {{"command", name}, {"arg", arg}}, true);
}
void RewardDock::request(const QString &route, const QJsonObject &body, bool isCommand) {
    busy = true;
    QNetworkRequest request(QUrl(origin + route));
    request.setTransferTimeout(isCommand ? 20000 : 2500);
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy);
    request.setRawHeader("Authorization", "Bearer " + token.toUtf8());
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    auto reply = isCommand ? network.post(request, QJsonDocument(body).toJson(QJsonDocument::Compact)) : network.get(request);
    connect(reply, &QNetworkReply::finished, this, [this, reply, isCommand] {
        busy = false;
        const auto value = QJsonDocument::fromJson(reply->readAll()).object();
        if (reply->error() != QNetworkReply::NoError) {
            if (isCommand && value.contains("error")) warning->setText(value["error"].toString());
            else {
                disconnected(text("Нет связи с Reward Desk. Награды сохранены.", "Немає зв'язку з Reward Desk. Нагороди збережено.", "Reward Desk is disconnected. Rewards are preserved."));
                if (!started) start();
            }
        } else if (value.contains("protocol")) accept(value);
        reply->deleteLater();
    });
}
void RewardDock::disconnected(const QString &reason) {
    online = false; connection->setText(reason); source->clear(); queue->clear();
    for (auto button : {pauseButton, stopButton, editorButton, copyButton, updateButton}) button->setEnabled(false);
    startButton->show();
}
void RewardDock::accept(const QJsonObject &value) {
    online = true; language = value["preferences"].toObject()["language"].toString("ru");
    paused = value["paused"].toBool(); pauseButton->setChecked(paused); labels();
    heading->setText("Reward Desk OBS " + value["version"].toString());
    for (auto button : {pauseButton, editorButton, copyButton, updateButton}) button->setEnabled(true);
    startButton->hide();
    connection->setText(value["connected"].toBool() ? "Twitch · " + value["account"].toString() : text("Twitch не подключён", "Twitch не підключено", "Twitch is disconnected"));
    const auto overlay = value["overlay"].toObject(); sourceUrl = overlay["url"].toString();
    source->setText(overlay["obsClients"].toInt() > 0 ? text("Источник OBS подключён", "Джерело OBS підключено", "OBS source connected") : text("Нет активного источника OBS", "Немає активного джерела OBS", "No active OBS source"));
    const auto playing = value["playing"].toString(); stopButton->setEnabled(!playing.isEmpty());
    queue->setText(text("В очереди: ", "У черзі: ", "Queued: ") + QString::number(value["queued"].toInt()) +
        (playing.isEmpty() ? "" : "\n" + text("Сейчас: ", "Зараз: ", "Playing: ") + playing));
    if (value["attention"].toInt() > 0) warning->setText(text("Есть незавершённые награды. Проверьте очередь в редакторе.", "Є незавершені нагороди. Перевірте чергу в редакторі.", "Some rewards need attention. Check the editor queue."));
    else if (!overlay["error"].toString().isEmpty()) warning->setText(overlay["error"].toString());
    else warning->clear();
    const auto updates = value["updates"].toObject();
    const auto status = updates["status"].toString();
    update->setText(status == "available" ? text("Доступно обновление плагина. Закройте OBS и запустите его установщик.", "Доступне оновлення плагіна. Закрийте OBS і запустіть інсталятор.", "Plugin update available. Close OBS and run its installer.") :
        status == "checking" ? text("Проверяем обновления…", "Перевіряємо оновлення…", "Checking updates…") :
        status == "current" ? text("Установлена актуальная версия", "Установлено актуальну версію", "You are up to date") :
        status == "unavailable" ? text("Публичный выпуск пока недоступен", "Публічний випуск поки недоступний", "Public release is not available yet") :
        status == "error" ? text("Не удалось проверить обновления", "Не вдалося перевірити оновлення", "Could not check for updates") :
        text("Проверка обновлений ещё не выполнена", "Перевірку оновлень ще не виконано", "Updates have not been checked"));
    QStringList lines;
    for (const auto &entry : value["logs"].toArray()) lines << entry.toObject()["message"].toString();
    const auto content = lines.join("\n"); if (log->toPlainText() != content) log->setPlainText(content);
    log->setVisible(!lines.isEmpty()); logEmpty->setVisible(lines.isEmpty());
}
