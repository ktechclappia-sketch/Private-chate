# Privacy Chat: isolated JDK 21 setup and Android debug APK build.
# Downloads, only when needed, from Eclipse Adoptium and Gradle official distribution websites.
# Does not change machine-wide JAVA_HOME, PATH, or Android Studio settings.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

function Find-Jdk21 {
    param([string]$CacheDir)
    $patterns = @(
        (Join-Path $CacheDir 'temurin21\jdk-21*'),
        (Join-Path $env:ProgramFiles 'Eclipse Adoptium\jdk-21*'),
        (Join-Path $env:ProgramFiles 'Java\jdk-21*'),
        (Join-Path $env:ProgramFiles 'Microsoft\jdk-21*'),
        (Join-Path $env:ProgramFiles 'Amazon Corretto\jdk21*'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Eclipse Adoptium\jdk-21*')
    )
    if ($env:JAVA_HOME) { $patterns = @($env:JAVA_HOME) + $patterns }
    $patterns += (Join-Path $env:ProgramFiles 'Android\Android Studio\jbr')
    foreach ($pattern in $patterns) {
        foreach ($entry in @(Get-Item -Path $pattern -ErrorAction SilentlyContinue)) {
            if ($null -eq $entry) { continue }
            $candidateJdkDir = $entry.FullName
            $release = Join-Path $candidateJdkDir 'release'
            $exe = Join-Path $candidateJdkDir 'bin\java.exe'
            if ((Test-Path -LiteralPath $exe) -and (Test-Path -LiteralPath $release)) {
                $info = Get-Content -LiteralPath $release -Raw
                if ($info -match 'JAVA_VERSION="21(?:\.|\")') { return $candidateJdkDir }
            }
        }
    }
    return $null
}

try {
    Write-Host 'Privacy Chat - Android APK Builder' -ForegroundColor Cyan
    $Sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
    if ($env:ANDROID_HOME -and (Test-Path -LiteralPath (Join-Path $env:ANDROID_HOME 'platforms\android-35\android.jar'))) {
        $Sdk = $env:ANDROID_HOME
    }
    if (-not (Test-Path -LiteralPath (Join-Path $Sdk 'platforms\android-35\android.jar'))) {
        throw "Android SDK 35 not found. Open Android Studio > Settings > Android SDK > SDK Platforms and install Android 15 API 35. Expected SDK location: $Sdk"
    }
    $env:ANDROID_HOME = $Sdk
    $env:ANDROID_SDK_ROOT = $Sdk

    $Cache = Join-Path $env:LOCALAPPDATA 'PrivacyChatBuild'
    New-Item -ItemType Directory -Path $Cache -Force | Out-Null
    $Jdk = Find-Jdk21 -CacheDir $Cache
    if (-not $Jdk) {
        Write-Host 'Java 21 not found. Downloading official Eclipse Temurin JDK 21 into local cache...' -ForegroundColor Yellow
        Write-Host 'This is a large download. Internet connection is required.'
        $JdkFolder = Join-Path $Cache 'temurin21'
        $JdkZip = Join-Path $Cache 'temurin21.zip'
        New-Item -ItemType Directory -Path $JdkFolder -Force | Out-Null
        $Url = 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse'
        Invoke-WebRequest -Uri $Url -OutFile $JdkZip -UseBasicParsing
        Expand-Archive -LiteralPath $JdkZip -DestinationPath $JdkFolder -Force
        $Jdk = Find-Jdk21 -CacheDir $Cache
        if (-not $Jdk) { throw 'JDK 21 archive was downloaded but a valid Java 21 folder was not found.' }
    }

    $env:JAVA_HOME = $Jdk
    $env:PATH = (Join-Path $Jdk 'bin') + ';' + $env:PATH
    Write-Host "Using Java 21: $Jdk" -ForegroundColor Green
    & (Join-Path $Jdk 'bin\java.exe') -version

    $GradleHome = Join-Path $Cache 'gradle-8.9'
    $GradleCmd = Join-Path $GradleHome 'bin\gradle.bat'
    if (-not (Test-Path -LiteralPath $GradleCmd)) {
        Write-Host 'Downloading official Gradle 8.9...' -ForegroundColor Yellow
        $GradleZip = Join-Path $Cache 'gradle-8.9-bin.zip'
        Invoke-WebRequest -Uri 'https://services.gradle.org/distributions/gradle-8.9-bin.zip' -OutFile $GradleZip -UseBasicParsing
        Expand-Archive -LiteralPath $GradleZip -DestinationPath $Cache -Force
    }
    if (-not (Test-Path -LiteralPath $GradleCmd)) { throw 'Gradle 8.9 was not found after download.' }

    Write-Host 'Building Privacy Chat APK ...' -ForegroundColor Cyan
    & $GradleCmd --no-daemon assembleDebug
    if ($LASTEXITCODE -ne 0) { throw "Gradle build failed with exit code $LASTEXITCODE. See messages above." }

    $Apk = Join-Path $PSScriptRoot 'app\build\outputs\apk\debug\app-debug.apk'
    if (-not (Test-Path -LiteralPath $Apk)) { throw 'Gradle finished, but app-debug.apk was not found.' }
    Write-Host 'BUILD SUCCESSFUL' -ForegroundColor Green
    Write-Host "APK ready: $Apk" -ForegroundColor Green
    Start-Process explorer.exe -ArgumentList @('/select,', $Apk)
    exit 0
}
catch {
    Write-Host 'BUILD FAILED' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host 'You can also open this project in Android Studio using JDK 21 and build from the Build menu.'
    exit 1
}
