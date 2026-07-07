# Android build toolchain (contained + removable)

The Android companion (`apps/android`) needs a JDK and the Android SDK. This
machine uses a Homebrew-managed, contained setup so it updates and uninstalls
cleanly, with nothing scattered in the global shell.

## Install

```bash
brew install openjdk@17                       # JDK, keg-only (not symlinked)
brew install --cask android-commandlinetools  # sdkmanager, avdmanager, adb
# SDK packages (build tools + platform + platform-tools):
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-34" "build-tools;34.0.0"
```

Gradle is not installed globally — the project uses the Gradle wrapper
(`apps/android/gradlew`, pinned to 8.11.1) which downloads its own Gradle.

`apps/android/local.properties` (gitignored) points Gradle at the SDK:

```
sdk.dir=/opt/homebrew/share/android-commandlinetools
```

## Emulator (optional; runtime testing)

```bash
sdkmanager "emulator" "system-images;android-34;google_apis;arm64-v8a"
avdmanager create avd -n forge -k "system-images;android-34;google_apis;arm64-v8a"
$ANDROID_HOME/emulator/emulator -avd forge
```

arm64 images run natively on Apple Silicon (no x86 emulation tax).

## Versions

JDK 17 · AGP 8.7.3 · Gradle 8.11.1 · Kotlin 2.0.21 · compileSdk 34 · minSdk 26.

## Remove it all

```bash
brew uninstall openjdk@17
brew uninstall --cask android-commandlinetools
rm -rf /opt/homebrew/share/android-commandlinetools   # SDK packages + AVDs
rm -rf ~/.gradle ~/.android                            # gradle + avd caches
```

Nothing was written to your shell profile; the build sets `JAVA_HOME` inline.
