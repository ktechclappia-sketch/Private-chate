Privacy Chat APK - Java 21 Auto Fix (Windows 11)

1. Download ZIP and choose Extract All.
2. Open Privacy_Chat_Android_Studio folder.
3. Double-click BUILD_APK_WINDOWS.bat.
4. Leave the black terminal open. It will use a local Java 21 installation, or download Java 21 from Eclipse Adoptium (official source). It uses/downloads Gradle 8.9 from services.gradle.org as needed. Internet required.
5. On success, Windows Explorer highlights app\build\outputs\apk\debug\app-debug.apk.
6. Send the APK to your Android phone and install it for testing.

This script does not change the Windows Java environment or Android Studio Java installation. Java 25 is left as it is. It uses Java 21 only for this APK build.

If Build failed, take a screenshot of the black window and share it.

Note: This is a developer test APK project, NOT a compiled APK. Live login, chat, photo and privacy tests remain necessary.

Update: Fixed reserved PowerShell $HOME collision (formerly $home in JDK detection).
