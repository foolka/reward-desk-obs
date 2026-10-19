[Setup]
AppId={{F8467B39-465A-461E-B6B3-D37A76EF93CE}
AppName=Reward Desk OBS
AppVersion={#AppVersion}
AppPublisher=FermionaPlay
AppPublisherURL=https://github.com/foolka/reward-desk-obs
AppUpdatesURL=https://github.com/foolka/reward-desk-obs/releases
DefaultDirName={commonappdata}\obs-studio\plugins\reward-desk-obs
UsePreviousAppDir=no
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
WizardStyle=modern
OutputDir={#OutputDir}
OutputBaseFilename=reward-desk-obs-{#AppVersion}-windows-x64-setup
SetupIconFile={#PackageDir}\data\runtime\resources\app.ico
UninstallDisplayIcon={app}\data\runtime\RewardDeskOBS.exe
UninstallFilesDir={app}\uninstall
Compression=lzma2
SolidCompression=yes
CloseApplications=no
RestartApplications=no
SetupLogging=yes
[Languages]
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "uk"; MessagesFile: "compiler:Languages\Ukrainian.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"
[Files]
Source: "{#PackageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Messages]
ru.FinishedLabel=Reward Desk OBS установлен.%nОткройте OBS: Док-панели > Reward Desk.%nРедактор открывается кнопкой в панели. Отдельное приложение не требуется.%nПрофиль плагина: %%APPDATA%%\RewardDeskOBS. Данные отдельного приложения не изменены.
en.FinishedLabel=Reward Desk OBS is installed.%nOpen OBS: Docks > Reward Desk.%nOpen the browser editor from the dock. The standalone app is not required.%nThe plugin has its own profile. Standalone app data is unchanged.
uk.FinishedLabel=Reward Desk OBS установлено.%nВідкрийте OBS: Док-панелі > Reward Desk.%nРедактор відкривається кнопкою в панелі. Окремий застосунок не потрібний.%nПлагін має власний профіль. Дані окремого застосунку не змінено.
[Code]
function Guard(): String;
var Locator, Services, Items: Variant;
begin
  Result := '';
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Services := Locator.ConnectServer('.', 'root\CIMV2');
    Items := Services.ExecQuery('SELECT ProcessId FROM Win32_Process WHERE Name = ''obs64.exe'' OR Name = ''RewardDeskOBS.exe''');
    if Items.Count > 0 then Result := 'Закройте OBS и Reward Desk OBS через Выход в трее. Данные не изменены.';
  except
    Result := 'Не удалось проверить процессы. Установка отменена.';
  end;
end;
function PrepareToInstall(var NeedsRestart: Boolean): String;
var MS, LS: Cardinal; Root: String;
begin
  Result := 'Недопустимая папка установки';
  if CompareText(RemoveBackslashUnlessRoot(ExpandFileName(WizardDirValue)), ExpandConstant('{commonappdata}\obs-studio\plugins\reward-desk-obs')) <> 0 then Exit;
  Root := ExpandConstant('{param:OBSROOT|}');
  if Root = '' then RegQueryStringValue(HKLM64, 'SOFTWARE\OBS Studio', '', Root);
  if Root = '' then Root := ExpandConstant('{autopf}\obs-studio');
  Result := 'Нужен OBS Studio 32 или новее (Windows x64, обычная установка).';
  if not GetVersionNumbers(AddBackslash(Root) + 'bin\64bit\obs64.exe', MS, LS) then Exit;
  if (MS shr 16) < 32 then Exit;
  if FileExists(AddBackslash(Root) + 'portable_mode') or FileExists(AddBackslash(Root) + 'portable_mode.txt') then Exit;
  Result := 'Нужен OBS с Qt 6.8 или новее.';
  if not GetVersionNumbers(AddBackslash(Root) + 'bin\64bit\Qt6Core.dll', MS, LS) then Exit;
  if ((MS shr 16) <> 6) or ((MS and $FFFF) < 8) then Exit;
  Result := Guard();
end;
function InitializeUninstall(): Boolean;
var Reason: String;
begin
  Reason := Guard(); Result := Reason = '';
  if not Result then MsgBox(Reason, mbError, MB_OK);
end;
