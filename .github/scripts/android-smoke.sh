#!/usr/bin/env bash
set -euo pipefail

adb install app/build/outputs/apk/debug/app-debug.apk
adb install -t app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am instrument -w com.privacychat.app.test.test/com.privacychat.app.SmokeRunner | tee smoke.log
grep -q 'PRIVACY_SMOKE_OK' smoke.log
