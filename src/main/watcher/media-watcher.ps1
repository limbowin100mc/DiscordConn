# Presence Hub watcher.
# Prints one JSON line whenever something changes in:
#  - what Windows knows about playing media (the same info as the volume-key media
#    pop-up): title, artist, album, playing/paused, position, length
#  - the open browser windows (each window's title is its current tab's title)
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

# For windows showing a YouTube, YouTube Music or Netflix tab we read the address bar
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
  if ($url -notmatch '(^|[/.])(youtube\.com|netflix\.com)/') { $url = '' }
  $addressCache[$hwnd] = @{ element = $el; url = $url; at = $now }
  return $url
}

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
        if ($w[1] -match '^Netflix(\s|$)| - YouTube( |$)| \| YouTube Music( |$)') { $entry.url = SiteAddress $w[0]; $seenWindows[$w[0]] = $true }
        $windows += $entry
      }
    }
  } catch { }
  foreach ($k in @($addressCache.Keys)) { if (-not $seenWindows.ContainsKey($k)) { $addressCache.Remove($k) } }

  $json = [ordered]@{ type = 'state'; sessions = $sessions; windows = $windows } | ConvertTo-Json -Depth 5 -Compress
  $now = [DateTime]::UtcNow
  if ($json -ne $last -or ($now - $lastBeat).TotalSeconds -ge 15) {
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
    $last = $json
    $lastBeat = $now
  }
  Start-Sleep -Milliseconds 1000
}
