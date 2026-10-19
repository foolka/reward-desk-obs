#pragma once
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <shlobj.h>
#include <QString>
#include <QDir>

inline QString rewardProfilePath() {
    // Electron appData is roaming; Qt GenericDataLocation is local on Windows.
    PWSTR roaming = nullptr;
    const auto result = SHGetKnownFolderPath(FOLDERID_RoamingAppData, KF_FLAG_DEFAULT, nullptr, &roaming);
    const auto path = SUCCEEDED(result) && roaming ? QString::fromWCharArray(roaming) : QString{};
    CoTaskMemFree(roaming);
    return path.isEmpty() ? QString{} : QDir(path).filePath("RewardDeskOBS");
}
