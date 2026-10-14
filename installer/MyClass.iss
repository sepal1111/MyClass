; MyClass 安裝版（Windows）— Inno Setup 6
; 由 scripts/build-installer.mjs 傳入：
;   /DAppVersion=3.5.1  /DServerExe=MyClassV3.5.1.exe  /DSourceDir=<已備妥的檔案資料夾>  /DOutputDir=<輸出資料夾>
;
; 設計重點：
;  - 預設安裝到 C:\MyClass，程式與資料（bin\）同一個資料夾，結構與可攜版相同，老師可直接在
;    C:\MyClass\bin\uploads 取得學生上傳的檔案。
;  - 升級時只覆蓋程式檔，不動 bin\（資料庫、憑證、照片、上傳檔）；解除安裝同樣保留 bin\。
;  - 需要管理員身分：為伺服器程式加入 Windows 防火牆規則，區網內學生的手機／平板才連得進來。

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef ServerExe
  #define ServerExe "MyClassV.exe"
#endif
#ifndef SourceDir
  #define SourceDir "..\release\_installer_staging"
#endif
#ifndef OutputDir
  #define OutputDir "..\release"
#endif

[Setup]
AppId={{6F1C2A58-3B7D-4E9A-9C41-7A5D0E8B2F13}
AppName=MyClass 課堂即時記錄系統
AppVersion={#AppVersion}
AppPublisher=MyClass
DefaultDirName=C:\MyClass
DefaultGroupName=MyClass
DisableProgramGroupPage=yes
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=commandline
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=MyClassSetupV{#AppVersion}
SetupIconFile=..\assets\myclass.ico
UninstallDisplayIcon={app}\MyClass.exe
UninstallDisplayName=MyClass 課堂即時記錄系統
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
; 開機自動啟動寫入目前使用者（HKCU）；本校電腦帳號皆為管理員且以本人身分安裝，符合預期。托盤選單也可隨時切換。
UsedUserAreasWarning=no

[Languages]
Name: "tc"; MessagesFile: "compiler:Languages\ChineseTraditional.isl"

[Tasks]
Name: "desktopicon"; Description: "建立桌面捷徑"; GroupDescription: "額外選項："
Name: "autostart"; Description: "開機時自動啟動（在背景執行，右下角顯示圖示）"; GroupDescription: "額外選項："

[Dirs]
Name: "{app}"; Permissions: users-modify
Name: "{app}\bin"; Permissions: users-modify

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; 舊版的伺服器程式檔名含版本號，升級前先清掉；system\ 為隨程式附帶的靜態檔與資料庫引擎，整份重放。
Type: files; Name: "{app}\ClassManager*.exe"
Type: files; Name: "{app}\MyClassV*.exe"
; 改名前（TeachSYS）的托盤程式與捷徑
Type: files; Name: "{app}\TeachSYS.exe"
Type: filesandordirs; Name: "{autoprograms}\TeachSYS"
Type: files; Name: "{autodesktop}\TeachSYS.lnk"
Type: filesandordirs; Name: "{app}\system"

[Icons]
Name: "{autoprograms}\MyClass"; Filename: "{app}\MyClass.exe"
Name: "{autoprograms}\MyClass 檔案資料夾"; Filename: "{app}\bin\uploads"
Name: "{autoprograms}\解除安裝 MyClass"; Filename: "{uninstallexe}"
Name: "{autodesktop}\MyClass"; Filename: "{app}\MyClass.exe"; Tasks: desktopicon

[Registry]
; 改名前的開機自動啟動項目（TeachSYS）一律移除；需要時由下一行依勾選重新建立
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueName: "TeachSYS"; Flags: deletevalue
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "MyClass"; ValueData: """{app}\MyClass.exe"" --autostart"; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""TeachSYS"""; Flags: runhidden; Check: IsAdminInstallMode
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""MyClass"""; Flags: runhidden; Check: IsAdminInstallMode
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""MyClass"" dir=in action=allow program=""{app}\{#ServerExe}"" enable=yes profile=any"; Flags: runhidden; StatusMsg: "設定 Windows 防火牆…"; Check: IsAdminInstallMode
Filename: "{app}\MyClass.exe"; Description: "立即啟動 MyClass"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\MyClass.exe"; Parameters: "--exit"; Flags: runhidden; RunOnceId: "StopMyClass"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""MyClass"""; Flags: runhidden; RunOnceId: "DeleteFirewallRule"

[Code]
var
  ImportPage: TInputQueryWizardPage;

procedure BrowseImportClick(Sender: TObject);
var
  Dir: String;
begin
  Dir := Trim(ImportPage.Values[0]);
  if BrowseForFolder('選擇可攜版的資料夾（裡面有 bin 資料夾的那一層）', Dir, False) then
    ImportPage.Values[0] := Dir;
end;

procedure InitializeWizard;
var
  Btn: TNewButton;
begin
  { 用一般文字輸入頁（可以留白）；TInputDirWizardPage 不允許空白，會讓使用者無法按「下一步」 }
  ImportPage := CreateInputQueryPage(wpSelectDir,
    '匯入既有資料（選填）',
    '要把可攜版的資料搬進來嗎？',
    '如果你原本使用可攜版，請選擇可攜版的資料夾（裡面有 bin 資料夾的那一層），安裝完成後會把班級、學生、成績與上傳的檔案複製過來。' + #13#10 +
    '沒有舊資料或不需要匯入，請直接按「下一步」。（原本的資料夾不會被更動。）');
  ImportPage.Add('可攜版資料夾（選填）：', False);
  ImportPage.Values[0] := '';

  ImportPage.Edits[0].Width := ImportPage.SurfaceWidth - ScaleX(90);
  Btn := TNewButton.Create(ImportPage);
  Btn.Parent := ImportPage.Surface;
  Btn.Caption := '瀏覽...';
  Btn.Left := ImportPage.Edits[0].Left + ImportPage.Edits[0].Width + ScaleX(8);
  Btn.Top := ImportPage.Edits[0].Top - ScaleY(1);
  Btn.Width := ScaleX(80);
  Btn.Height := ImportPage.Edits[0].Height + ScaleY(2);
  Btn.OnClick := @BrowseImportClick;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Src: String;
begin
  Result := True;
  if CurPageID = ImportPage.ID then
  begin
    Src := Trim(ImportPage.Values[0]);
    if Src <> '' then
    begin
      if not FileExists(AddBackslash(Src) + 'bin\classroom_record.db') then
      begin
        MsgBox('在這個資料夾裡找不到 bin\classroom_record.db，請確認選擇的是可攜版的資料夾；若不需要匯入，請清空欄位。', mbError, MB_OK);
        Result := False;
      end
      else if FileExists(ExpandConstant('{app}\bin\classroom_record.db')) then
      begin
        MsgBox('安裝位置已經有資料庫，為避免覆蓋現有資料，將不會匯入。', mbInformation, MB_OK);
        ImportPage.Values[0] := '';
      end;
    end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Exe: String;
  ResultCode: Integer;
begin
  { 升級時先結束執行中的托盤與伺服器，才能覆蓋檔案 }
  Exe := ExpandConstant('{app}\MyClass.exe');
  if FileExists(Exe) then
    Exec(Exe, '--exit', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  { 由改名前（TeachSYS）的版本升級：舊的托盤程式也要先結束 }
  Exe := ExpandConstant('{app}\TeachSYS.exe');
  if FileExists(Exe) then
    Exec(Exe, '--exit', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Src: String;
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    Src := Trim(ImportPage.Values[0]);
    if Src <> '' then
    begin
      Exec(ExpandConstant('{sys}\xcopy.exe'),
        '"' + AddBackslash(Src) + 'bin" "' + ExpandConstant('{app}\bin') + '" /E /I /Y /H /Q',
        '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    end;
  end;
end;
