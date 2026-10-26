# Presence Hub watcher.
# Prints one JSON line whenever something changes in:
#  - what Windows knows about playing media (the same info as the volume-key media
#    pop-up): title, artist, album, playing/paused, position, length
#  - the open browser windows (each window's title is its current tab's title)
#  - the game you're playing (a fullscreen app that isn't a browser or known non-game)
# Reads commands from the app (play/pause/next/previous for the mini player).
# Started and read by the Presence Hub app; nothing is stored.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Browser processes whose window titles we look at (nothing else is read).
$BrowserProcesses = '^(chrome|msedge|brave|opera|vivaldi|firefox|chromium|arc|thorium|zen|waterfox|librewolf|floorp|browser)$'

Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;
public static class PresenceHubWin {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);

  // The foreground window: { handle, pid, title, coversWholeScreen }
  public static string[] Foreground() {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero) return new string[] { "0", "0", "", "0" };
    var title = new StringBuilder(512);
    GetWindowText(h, title, 512);
    uint pid;
    GetWindowThreadProcessId(h, out pid);
    var cls = new StringBuilder(64);
    GetClassName(h, cls, 64);
    bool full = false;
    RECT r;
    if (cls.ToString() != "Progman" && cls.ToString() != "WorkerW" && GetWindowRect(h, out r)) { // not the desktop
      var mi = new MONITORINFO();
      mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
      if (GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) {
        full = r.Left <= mi.rcMonitor.Left && r.Top <= mi.rcMonitor.Top && r.Right >= mi.rcMonitor.Right && r.Bottom >= mi.rcMonitor.Bottom;
      }
    }
    return new string[] { h.ToInt64().ToString(), pid.ToString(), title.ToString(), full ? "1" : "0" };
  }

  // Top-level browser windows: { handle, title, pid, isForeground }
  public static List<string[]> BrowserWindows() {
    var list = new List<string[]>();
    IntPtr fg = GetForegroundWindow();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return true; // hidden or owned pop-up
      var cls = new StringBuilder(64);
      GetClassName(h, cls, 64);
      string c = cls.ToString();
      if (c != "Chrome_WidgetWin_1" && c != "MozillaWindowClass") return true;
      var title = new StringBuilder(1024);
      GetWindowText(h, title, 1024);
      if (title.Length == 0) return true;
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      list.Add(new string[] { h.ToInt64().ToString(), title.ToString(), pid.ToString(), h == fg ? "1" : "0" });
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
'@

# For windows showing a YouTube, YouTube Music, Netflix or Prime Video tab we read the address bar
# (the video id), so what's playing is still known after you switch tabs or to a game.
# Netflix needs it most: it titles every page just "Netflix". Other sites aren't read.
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$UIA = [System.Windows.Automation.AutomationElement]
$addressBar = New-Object System.Windows.Automation.OrCondition(
  (New-Object System.Windows.Automation.PropertyCondition($UIA::ClassNameProperty, 'OmniboxViewViews')),  # Chrome, Edge, Brave, Opera
  (New-Object System.Windows.Automation.PropertyCondition($UIA::AutomationIdProperty, 'urlbar-input')))     # Firefox
$addressCache = @{}
function SiteAddress([string]$hwnd) {
  $now = [DateTime]::UtcNow
  $c = $addressCache[$hwnd]
  if ($c -and ($now - $c.at).TotalSeconds -lt 4) { return $c.url }
  $el = if ($c) { $c.element } else { $null }
  $url = ''
  try {
    if (-not $el) { $el = $UIA::FromHandle([IntPtr][long]$hwnd).FindFirst([System.Windows.Automation.TreeScope]::Descendants, $addressBar) }
    if ($el) { $url = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value }
  } catch { $el = $null }
  if ($url -notmatch '(^|[/.])(youtube\.com|netflix\.com|primevideo\.com)/|(^|[/.])amazon\.[a-z.]+/gp/video/') { $url = '' }
  $addressCache[$hwnd] = @{ element = $el; url = $url; at = $now }
  return $url
}

# Games: fullscreen apps that aren't browsers or one of these.
$NotGames = '^(explorer|applicationframehost|shellexperiencehost|startmenuexperiencehost|searchhost|searchapp|textinputhost|lockapp|discord|discordptb|discordcanary|presence hub|electron|vlc|mpc-hc64|mpc-hc|mpc-be64|potplayermini64|potplayermini|wmplayer|microsoft\.media\.player|video\.ui|spotify|powerpnt|winword|excel|onenote|outlook|olk|teams|ms-teams|zoom|obs64|obs32|code|devenv|idea64|pycharm64|rider64|steam|steamwebhelper|epicgameslauncher|eadesktop|battle\.net|riotclientux|riotclientservices|photos|microsoft\.photos|mspaint|acrobat|acrord32|notepad|windowsterminal|cmd|powershell|pwsh|taskmgr|slack|telegram|whatsapp|snippingtool|screenclippinghost|systemsettings|magnify|nvidia overlay|nvcontainer|gamebar|xboxpcapp|wallpaper64|wallpaper32|lively)$'
$KnownGames = @{
  'valorant-win64-shipping' = 'VALORANT'; 'fortniteclient-win64-shipping' = 'Fortnite'; 'cs2' = 'Counter-Strike 2'; 'csgo' = 'Counter-Strike: Global Offensive'
  'league of legends' = 'League of Legends'; 'r5apex' = 'Apex Legends'; 'r5apex_dx12' = 'Apex Legends'; 'rocketleague' = 'Rocket League'
  'gta5' = 'Grand Theft Auto V'; 'gta5_enhanced' = 'Grand Theft Auto V'; 'overwatch' = 'Overwatch 2'; 'dota2' = 'Dota 2'; 'javaw' = 'Minecraft'
  'minecraft.windows' = 'Minecraft'; 'robloxplayerbeta' = 'Roblox'; 'eldenring' = 'ELDEN RING'; 'rainbowsix' = 'Rainbow Six Siege'; 'rainbowsix_vulkan' = 'Rainbow Six Siege'
  'tslgame' = 'PUBG: BATTLEGROUNDS'; 'rustclient' = 'Rust'; 'project8' = 'Deadlock'; 'marvel-win64-shipping' = 'Marvel Rivals'; 'cyberpunk2077' = 'Cyberpunk 2077'
  'witcher3' = 'The Witcher 3'; 'cod' = 'Call of Duty'; 'cod24-cod' = 'Call of Duty'; 'fc25' = 'EA SPORTS FC 25'; 'fc26' = 'EA SPORTS FC 26'
}
function GameName([string]$proc, [string]$title) {
  if ($KnownGames.ContainsKey($proc)) { return $KnownGames[$proc] }
  $t = ($title -replace '\s+', ' ').Trim()
  if ($t -and $t.Length -le 40) { return $t }
  $p = ($proc -replace '(-win64)?-shipping$', '') -replace '[_-]+', ' '
  return (Get-Culture).TextInfo.ToTitleCase($p)
}
$game = $null

$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1

function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait(3000)) { return $null }
  return $task.Result
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$manager = $null

# Commands from the app, one JSON line each: { "cmd": "toggle" | "next" | "prev", "app": "<media app id>" }
# (A StreamReader on the raw input: Console.In would block the loop.)
$stdinReader = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pendingLine = $stdinReader.ReadLineAsync()
function Control([string]$app, [string]$cmd) {
  if (-not $manager) { return }
  $target = $null
  foreach ($s in $manager.GetSessions()) { if ($s.SourceAppUserModelId -eq $app) { $target = $s; break } }
  if (-not $target) { $target = $manager.GetCurrentSession() }
  if (-not $target) { return }
  $op = switch ($cmd) {
    'toggle' { $target.TryTogglePlayPauseAsync() }
    'next' { $target.TrySkipNextAsync() }
    'prev' { $target.TrySkipPreviousAsync() }
    default { $null }
  }
  if ($op) { $null = Await $op ([bool]) }
}
function HandleCommands {
  while ($script:pendingLine.IsCompleted) {
    $line = $script:pendingLine.Result
    if ($null -eq $line) { exit } # the app closed: stop too
    try { $c = $line | ConvertFrom-Json; Control $c.app $c.cmd } catch { }
    $script:pendingLine = $stdinReader.ReadLineAsync()
  }
}

$procNames = @{}
$procNamesAt = [DateTime]::UtcNow
function ProcessName([int]$id) {
  if (-not $procNames.ContainsKey($id)) {
    try { $procNames[$id] = (Get-Process -Id $id).ProcessName.ToLower() } catch { $procNames[$id] = '' }
  }
  return $procNames[$id]
}

$last = ''
$lastBeat = [DateTime]::MinValue
while ($true) {
  if (([DateTime]::UtcNow - $procNamesAt).TotalMinutes -ge 2) { $procNames = @{}; $procNamesAt = [DateTime]::UtcNow }

  $sessions = @()
  try {
    if (-not $manager) { $manager = Await ($managerType::RequestAsync()) $managerType }
    foreach ($s in $manager.GetSessions()) {
      $p = $null
      try { $p = Await ($s.TryGetMediaPropertiesAsync()) $propsType } catch { }
      $tl = $s.GetTimelineProperties()
      $pb = $s.GetPlaybackInfo()
      $sessions += [ordered]@{
        app      = $s.SourceAppUserModelId
        title    = if ($p) { $p.Title } else { '' }
        artist   = if ($p) { $p.Artist } else { '' }
        album    = if ($p) { $p.AlbumTitle } else { '' }
        status   = [string]$pb.PlaybackStatus
        position = [math]::Round($tl.Position.TotalSeconds, 2)
        duration = [math]::Round(($tl.EndTime - $tl.StartTime).TotalSeconds, 2)
        updated  = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
        rate     = if ($pb.PlaybackRate) { [double]$pb.PlaybackRate } else { 1 }
      }
    }
  } catch { $manager = $null }

  $windows = @()
  $seenWindows = @{}
  try {
    foreach ($w in [PresenceHubWin]::BrowserWindows()) {
      $name = ProcessName ([int]$w[2])
      if ($name -match $BrowserProcesses) {
        $entry = [ordered]@{ id = $w[0]; title = $w[1]; process = $name; foreground = ($w[3] -eq '1') }
        if ($w[1] -match '^Netflix(\s|$)| - YouTube( |$)| \| YouTube Music( |$)|^Prime Video[: ]|\| Prime Video') { $entry.url = SiteAddress $w[0]; $seenWindows[$w[0]] = $true }
        $windows += $entry
      }
    }
  } catch { }
  foreach ($k in @($addressCache.Keys)) { if (-not $seenWindows.ContainsKey($k)) { $addressCache.Remove($k) } }

  $gameOut = $null
  try {
    $fg = [PresenceHubWin]::Foreground()
    $fgProc = ProcessName ([int]$fg[1])
    if ($fg[3] -eq '1' -and $fgProc -and $fgProc -notmatch $NotGames -and $fgProc -notmatch $BrowserProcesses) {
      $game = @{ pid = [int]$fg[1]; name = (GameName $fgProc $fg[2]) }
    }
    if ($game) {
      # Keep showing the game while it runs, even when you alt-tab out of it.
      if (Get-Process -Id $game.pid -ErrorAction SilentlyContinue) {
        $gameOut = [ordered]@{ name = $game.name; foreground = ([int]$fg[1] -eq $game.pid) }
      } else { $game = $null }
    }
  } catch { }

  $json = [ordered]@{ type = 'state'; sessions = $sessions; windows = $windows; game = $gameOut } | ConvertTo-Json -Depth 5 -Compress
  $now = [DateTime]::UtcNow
  if ($json -ne $last -or ($now - $lastBeat).TotalSeconds -ge 15) {
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
    $last = $json
    $lastBeat = $now
  }
  for ($i = 0; $i -lt 10; $i++) { HandleCommands; Start-Sleep -Milliseconds 100 }
}
