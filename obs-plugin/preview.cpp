#include <QApplication>
#include <QDir>
#include <QFile>
#include "dock.hpp"
#include "profile.hpp"
int main(int argc, char **argv) {
    QApplication app(argc, argv);
    if (app.arguments().contains("--profile-path-check")) {
        QFile output(qEnvironmentVariable("REWARD_DESK_OBS_PATH_OUTPUT"));
        const auto profile = rewardProfilePath();
        if (profile.isEmpty() || !output.open(QIODevice::WriteOnly)) return 3;
        return output.write(profile.toUtf8()) > 0 ? 0 : 4;
    }
    const auto profile = qEnvironmentVariable("REWARD_DESK_OBS_TEST_PROFILE");
    if (profile.isEmpty() || !QDir::isAbsolutePath(profile)) return 2;
    RewardDock dock(profile, {}, true);
    dock.resize(320, 540); dock.setWindowTitle("Reward Desk OBS - isolated preview"); dock.show();
    const auto screenshot = qEnvironmentVariable("REWARD_DESK_OBS_SCREENSHOT");
    if (!screenshot.isEmpty()) QTimer::singleShot(3500, &app, [&] {
        dock.grab().save(screenshot);
        app.exit(qEnvironmentVariableIsSet("REWARD_DESK_OBS_REQUIRE_CONNECTED") && !dock.isConnected() ? 5 : 0);
    });
    return app.exec();
}
