[CmdletBinding()]
param(
    [ValidateSet('Native', 'Packaged', 'Remote')]
    [string]$Mode = 'Packaged',

    [ValidateSet('Debug', 'Release')]
    [string]$Variant = 'Debug',

    [string]$ServerUrl = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectDirectory = Split-Path -Parent $PSScriptRoot
$oldServerUrl = $env:CAPACITOR_SERVER_URL
$oldJavaHome = $env:JAVA_HOME
$oldAndroidHome = $env:ANDROID_HOME
$oldAndroidSdkRoot = $env:ANDROID_SDK_ROOT
$oldGradleUserHome = $env:GRADLE_USER_HOME

function Initialize-AndroidEnvironment {
    if ($env:JAVA_HOME -and -not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
        Remove-Item Env:JAVA_HOME -ErrorAction SilentlyContinue
    }
    if (-not $env:JAVA_HOME) {
        $studioJavaHomes = @(
            (Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'),
            (Join-Path $env:LOCALAPPDATA 'Programs\Android Studio\jbr')
        )
        $studioJavaHome = $studioJavaHomes | Where-Object {
            $_ -and (Test-Path -LiteralPath (Join-Path $_ 'bin\java.exe'))
        } | Select-Object -First 1
        if ($studioJavaHome) {
            $env:JAVA_HOME = $studioJavaHome
        }
    }

    if (-not $env:JAVA_HOME) {
        $searchRoots = @(
            (Join-Path $env:USERPROFILE '.jdks')
        )
        $javaExecutable = $searchRoots |
            Where-Object { Test-Path -LiteralPath $_ } |
            ForEach-Object {
                Get-ChildItem -LiteralPath $_ -Filter 'java.exe' -Recurse -ErrorAction SilentlyContinue
            } |
            Where-Object {
                $_.FullName -match '\\bin\\java\.exe$' -and
                $_.FullName -match '(jdk|jbr)[-_]?2[1-9]'
            } |
            Select-Object -First 1
        if ($javaExecutable) {
            $env:JAVA_HOME = Split-Path -Parent (Split-Path -Parent $javaExecutable.FullName)
        }
    }

    if ($env:ANDROID_HOME -and -not (
        (Test-Path -LiteralPath (Join-Path $env:ANDROID_HOME 'platforms\android-36')) -and
        (Test-Path -LiteralPath (Join-Path $env:ANDROID_HOME 'build-tools'))
    )) {
        Remove-Item Env:ANDROID_HOME -ErrorAction SilentlyContinue
    }
    if (-not $env:ANDROID_HOME) {
        $sdkCandidates = @(
            (Join-Path $env:LOCALAPPDATA 'Android\Sdk'),
            $env:ANDROID_SDK_ROOT
        )
        $env:ANDROID_HOME = $sdkCandidates |
            Where-Object {
                $_ -and
                (Test-Path -LiteralPath (Join-Path $_ 'platforms\android-36')) -and
                (Test-Path -LiteralPath (Join-Path $_ 'build-tools'))
            } |
            Select-Object -First 1
    }

    if ($env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT) {
        $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
    }

    if (-not $env:JAVA_HOME) {
        throw 'JAVA_HOME is not configured and no JDK was found under the current user profile.'
    }
    if (-not $env:ANDROID_HOME) {
        throw 'ANDROID_HOME is not configured and no Android SDK was found under the current user profile.'
    }
}

function Write-AndroidLocalProperties {
    $localPropertiesPath = Join-Path $projectDirectory 'android\local.properties'
    $escapedSdkPath = $env:ANDROID_HOME.Replace('\', '\\').Replace(':', '\:')
    $contents = "sdk.dir=$escapedSdkPath`n"
    [System.IO.File]::WriteAllText(
        $localPropertiesPath,
        $contents,
        [System.Text.UTF8Encoding]::new($false)
    )
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory)]
        [string]$Command,

        [Parameter(Mandatory)]
        [string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

try {
    Set-Location -LiteralPath $projectDirectory
    Initialize-AndroidEnvironment
    $pnpm = (Get-Command 'pnpm.cmd' -ErrorAction Stop).Source
    if ($Mode -ne 'Native' -and -not (Test-Path -LiteralPath (Join-Path $projectDirectory 'node_modules\.pnpm'))) {
        Write-Host 'Dependencies are missing; installing from pnpm-lock.yaml...' -ForegroundColor Yellow
        Invoke-Checked -Command $pnpm -Arguments @('install', '--frozen-lockfile')
    }

    if ($Mode -eq 'Remote') {
        if (-not [Uri]::IsWellFormedUriString($ServerUrl, [UriKind]::Absolute)) {
            throw "Invalid remote server URL: $ServerUrl"
        }
        $env:CAPACITOR_SERVER_URL = $ServerUrl.TrimEnd('/')
        Write-Warning 'Remote mode is only for explicit online-shell debugging. Use -Mode Packaged for the distributable offline APK.'
    }
    elseif ($Mode -eq 'Packaged') {
        Remove-Item Env:CAPACITOR_SERVER_URL -ErrorAction SilentlyContinue
    }

    Write-Host "Build mode: $Mode / $Variant" -ForegroundColor Cyan
    if ($Mode -ne 'Native') {
        Invoke-Checked -Command $pnpm -Arguments @('build')
        Invoke-Checked -Command $pnpm -Arguments @('exec', 'cap', 'sync', 'android')
    }
    Write-AndroidLocalProperties

    Push-Location (Join-Path $projectDirectory 'android')
    try {
        $taskName = if ($Variant -eq 'Release') { 'assembleRelease' } else { 'assembleDebug' }
        $task = if ($Mode -eq 'Native') { ":nativeapp:$taskName" } else { ":app:$taskName" }
        Invoke-Checked -Command '.\gradlew.bat' -Arguments @($task)
    }
    finally {
        Pop-Location
    }

    $apkName = if ($Variant -eq 'Release') {
        if ($Mode -eq 'Native') { 'nativeapp-release.apk' } else { 'app-release.apk' }
    } else {
        if ($Mode -eq 'Native') { 'nativeapp-debug.apk' } else { 'app-debug.apk' }
    }
    $moduleName = if ($Mode -eq 'Native') { 'nativeapp' } else { 'app' }
    $apkPath = Join-Path $projectDirectory "android\$moduleName\build\outputs\apk\$($Variant.ToLowerInvariant())\$apkName"
    if (-not (Test-Path -LiteralPath $apkPath)) {
        throw "Build completed but the APK was not found: $apkPath"
    }

    Write-Host ''
    Write-Host 'APK generated:' -ForegroundColor Green
    Write-Host $apkPath
    if ($Variant -eq 'Release') {
        $buildToolsDirectory = Get-ChildItem -LiteralPath (Join-Path $env:ANDROID_HOME 'build-tools') -Directory |
            Sort-Object Name -Descending |
            Select-Object -First 1 -ExpandProperty FullName
        $apkSigner = Join-Path $buildToolsDirectory 'apksigner.bat'
        Invoke-Checked -Command $apkSigner -Arguments @('verify', '--verbose', $apkPath)
    }
}
finally {
    if ($null -eq $oldServerUrl) {
        Remove-Item Env:CAPACITOR_SERVER_URL -ErrorAction SilentlyContinue
    }
    else {
        $env:CAPACITOR_SERVER_URL = $oldServerUrl
    }

    foreach ($item in @(
        @{ Name = 'JAVA_HOME'; Value = $oldJavaHome },
        @{ Name = 'ANDROID_HOME'; Value = $oldAndroidHome },
        @{ Name = 'ANDROID_SDK_ROOT'; Value = $oldAndroidSdkRoot },
        @{ Name = 'GRADLE_USER_HOME'; Value = $oldGradleUserHome }
    )) {
        if ($null -eq $item.Value) {
            Remove-Item "Env:$($item.Name)" -ErrorAction SilentlyContinue
        }
        else {
            Set-Item "Env:$($item.Name)" $item.Value
        }
    }
}
