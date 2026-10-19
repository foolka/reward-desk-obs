#pragma once
#include <QWidget>
#include <QNetworkAccessManager>
#include <QLabel>
#include <QPushButton>
#include <QPlainTextEdit>
#include <QTimer>
#include <QJsonObject>

class RewardDock : public QWidget {
public:
    explicit RewardDock(const QString &profile, const QString &runtime = {}, bool offlineTest = false);
    bool isConnected() const { return online; }
private:
    QString profile, runtime, origin, token, sourceUrl, language = "ru";
    bool paused = false, busy = false, online = false, started = false, offlineTest;
    QNetworkAccessManager network;
    QTimer timer;
    QLabel *heading, *connection, *source, *queue, *warning, *update, *logTitle, *logEmpty;
    QPushButton *pauseButton, *stopButton, *editorButton, *copyButton, *startButton, *updateButton;
    QPlainTextEdit *log;
    QString text(const char *ru, const char *uk, const char *en) const;
    void labels();
    void poll();
    void start();
    void request(const QString &route, const QJsonObject &body = {}, bool command = false);
    void command(const QString &name, const QJsonValue &arg = {});
    void accept(const QJsonObject &value);
    void disconnected(const QString &reason);
};
