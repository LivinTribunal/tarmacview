#!/usr/bin/env bash
# TarmacView - rooted Android emulator for testing the HTTPS/MQTTS field-hub
# path that BlueStacks can't reach.
#
# BlueStacks can only install a CA into the *user* trust store, which Pilot's
# webview won't honor - so the cert-free emulator/ rig is HTTP-only. This AVD is
# rootable, so the local CA can be planted in the *system* store and Pilot will
# trust the hub's self-signed cert over real HTTPS. That exercises the V5 leg
# (does Pilot work over TLS with our IP-SAN cert) without a real RC.
#
# Stack choice: a "google_apis" (NOT "google_play") arm64-v8a image on API 33.
#   - google_apis allows `adb root`; google_play images block it.
#   - arm64-v8a runs natively on Apple Silicon and matches Pilot's ARM build.
#   - API 33 keeps the simple writable-system cert flow; Android 14 moved the
#     system store into an immutable APEX and needs Magisk/Cert-Fixer instead.
#
# Usage:
#   ./emulator/avd-rc.sh setup        # install cmdline-tools + image, create the AVD
#   ./emulator/avd-rc.sh start        # boot the AVD with a writable system partition
#   ./emulator/avd-rc.sh trust-ca     # plant certs/fieldhub/ca.crt in the system store
#   ./emulator/avd-rc.sh install-apk <pilot2.apk>
#   ./emulator/avd-rc.sh doctor       # show what's installed / running
#
# IMPORTANT - system store vs user store:
#   trust-ca uses the SYSTEM store (needs root). That proves Pilot works over
#   TLS with a *trusted* cert, but it is MORE permissive than a real RC, which
#   you cannot root. To faithfully predict the RC, ALSO test the USER store the
#   way you would provision a controller: copy the CA in, then
#   Settings -> Security -> Encryption & credentials -> Install a certificate ->
#   CA certificate. If Pilot trusts the user-store CA here, the real RC will
#   too; if only the system store works, switch the field hub to a public-CA
#   cert on a DNS hostname instead.
set -euo pipefail

cd "$(dirname "$0")/.."

# config
AVD_NAME="tarmacview-rc"
SDK_PKG="system-images;android-33;google_apis;arm64-v8a"
DEVICE="pixel_6"
CA="certs/fieldhub/ca.crt"
SYSTEM_CACERTS="/system/etc/security/cacerts"

# resolve an SDK root: honor an existing env, else the Android Studio default,
# else the Homebrew cask location.
SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"

# pin both vars so avdmanager looks where sdkmanager installs - without this it
# defaults to the Homebrew cmdline-tools dir and can't find the system image
# ("Package path is not valid. Valid system image paths are: null").
export ANDROID_SDK_ROOT="$SDK_ROOT"
export ANDROID_HOME="$SDK_ROOT"

sdk_bin() {
    # prints the first existing path for an sdk tool, or just its name if on PATH
    local tool="$1" p
    for p in \
        "$SDK_ROOT/cmdline-tools/latest/bin/$tool" \
        "$SDK_ROOT/platform-tools/$tool" \
        "$SDK_ROOT/emulator/$tool" \
        "/opt/homebrew/share/android-commandlinetools/cmdline-tools/latest/bin/$tool"; do
        [ -x "$p" ] && { echo "$p"; return 0; }
    done
    command -v "$tool" 2>/dev/null || echo "$tool"
}

java_is_17plus() {
    # true when $1 is a JDK home whose java reports major version >= 17
    local jh="$1"
    [ -x "$jh/bin/java" ] || return 1
    "$jh/bin/java" -version 2>&1 | grep -qE 'version "(1[7-9]|[2-9][0-9])'
}

ensure_java() {
    # sdkmanager/avdmanager need JDK 17+; this machine defaults to JDK 8, and
    # `java_home -v 17` falsely returns it - so always validate the version.
    # provision openjdk@17 (keg-only, no sudo) and point JAVA_HOME at it.
    if [ -n "${JAVA_HOME:-}" ] && java_is_17plus "$JAVA_HOME"; then
        echo "==> using JDK at $JAVA_HOME"; return 0
    fi
    if ! command -v brew >/dev/null 2>&1; then
        echo "[ERROR] JDK 17+ required for sdkmanager and Homebrew is unavailable."
        echo "        install a JDK 17+ and export JAVA_HOME, then re-run."
        exit 1
    fi
    local jh; jh="$(brew --prefix)/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
    if ! java_is_17plus "$jh"; then
        echo "==> installing openjdk@17 via Homebrew"
        brew install openjdk@17
    fi
    if java_is_17plus "$jh"; then
        export JAVA_HOME="$jh"; echo "==> using JDK at $JAVA_HOME"; return 0
    fi
    echo "[ERROR] openjdk@17 install did not yield a usable JDK at $jh"; exit 1
}

require_docker_hub_up() {
    # the AVD reaches the host hub at 10.0.2.2:8443 (the production field stack).
    # just a reminder - this script doesn't manage that stack.
    echo "Note: point Pilot at the production HTTPS hub: https://10.0.2.2:8443"
    echo "      (bring it up with ./start-field.sh; the AVD's 10.0.2.2 is the host)"
}

cmd_setup() {
    echo "==> SDK root: $SDK_ROOT"
    ensure_java
    local sdkmanager
    sdkmanager="$(sdk_bin sdkmanager)"
    if [ ! -x "$sdkmanager" ] && ! command -v sdkmanager >/dev/null 2>&1; then
        echo "==> sdkmanager not found; installing the Homebrew cask (large download)"
        if ! command -v brew >/dev/null 2>&1; then
            echo "[ERROR] Homebrew not found. Install Android Studio or the command-line"
            echo "        tools manually, set ANDROID_SDK_ROOT, then re-run."
            exit 1
        fi
        brew install --cask android-commandlinetools
        sdkmanager="$(sdk_bin sdkmanager)"
    fi

    echo "==> accepting licenses"
    yes | "$sdkmanager" --sdk_root="$SDK_ROOT" --licenses >/dev/null || true

    # cmdline-tools must land INSIDE $SDK_ROOT: avdmanager derives its sdk root
    # from its own location (it ignores ANDROID_SDK_ROOT), so the Homebrew copy
    # looks in the wrong root and reports "Valid system image paths are: null".
    # the copy under $SDK_ROOT/cmdline-tools resolves the root correctly.
    echo "==> installing cmdline-tools, platform-tools, emulator, and $SDK_PKG"
    "$sdkmanager" --sdk_root="$SDK_ROOT" "cmdline-tools;latest" "platform-tools" "emulator" "$SDK_PKG"

    # resolve avdmanager AFTER the install so sdk_bin returns the in-root copy
    local avdmanager
    avdmanager="$(sdk_bin avdmanager)"
    echo "==> avdmanager: $avdmanager"

    if "$avdmanager" list avd 2>/dev/null | grep -q "Name: $AVD_NAME"; then
        echo "==> AVD '$AVD_NAME' already exists - leaving it as is"
    else
        echo "==> creating AVD '$AVD_NAME'"
        echo "no" | "$avdmanager" create avd -n "$AVD_NAME" -k "$SDK_PKG" --device "$DEVICE"
    fi
    echo "==> done. next: ./emulator/avd-rc.sh start"
}

cmd_start() {
    local emulator
    emulator="$(sdk_bin emulator)"
    # -writable-system is mandatory for the system-store cert plant; it forces a
    # cold boot (incompatible with snapshots).
    echo "==> booting '$AVD_NAME' with a writable system partition (cold boot)"
    require_docker_hub_up
    "$emulator" -avd "$AVD_NAME" -writable-system -no-snapshot -no-boot-anim &
    echo "==> emulator launched in the background (pid $!). waiting for boot..."
    local adb; adb="$(sdk_bin adb)"
    "$adb" wait-for-device
    until [ "$("$adb" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
        "$adb" wait-for-device
    done
    echo "==> booted. next: ./emulator/avd-rc.sh trust-ca (system store) and sideload Pilot 2"
}

cmd_trust_ca() {
    [ -f "$CA" ] || { echo "[ERROR] $CA not found - run ./start-field.sh first to mint it"; exit 1; }
    local adb; adb="$(sdk_bin adb)"

    # android's system store keys certs by the old openssl subject hash + .0
    local hash; hash="$(openssl x509 -inform PEM -subject_hash_old -in "$CA" | head -1)"
    local staged="/tmp/${hash}.0"
    cp "$CA" "$staged"
    echo "==> CA subject hash: $hash"

    "$adb" root
    "$adb" wait-for-device
    # writable-system usually lets remount succeed directly; if verity is on, the
    # disable-verification + reboot dance is the documented fallback.
    if ! "$adb" remount >/dev/null 2>&1; then
        echo "==> remount failed; disabling verification and rebooting once"
        "$adb" shell avbctl disable-verification || true
        "$adb" reboot
        "$adb" wait-for-device
        "$adb" root
        "$adb" wait-for-device
        "$adb" remount
    fi

    echo "==> planting $hash.0 in $SYSTEM_CACERTS"
    "$adb" push "$staged" "$SYSTEM_CACERTS/"
    "$adb" shell chmod 644 "$SYSTEM_CACERTS/${hash}.0"
    "$adb" reboot
    "$adb" wait-for-device
    echo "==> CA installed in the system store. verify:"
    echo "    adb shell ls -l $SYSTEM_CACERTS/${hash}.0"
}

cmd_install_apk() {
    local apk="${1:-}"
    [ -f "$apk" ] || { echo "[ERROR] usage: $0 install-apk <pilot2.apk>"; exit 1; }
    local adb; adb="$(sdk_bin adb)"
    echo "==> installing $apk"
    "$adb" install -r "$apk"
}

cmd_doctor() {
    echo "SDK root:    $SDK_ROOT"
    echo "sdkmanager:  $(sdk_bin sdkmanager)"
    echo "avdmanager:  $(sdk_bin avdmanager)"
    echo "emulator:    $(sdk_bin emulator)"
    echo "adb:         $(sdk_bin adb)"
    echo "--- avds ---"; "$(sdk_bin avdmanager)" list avd 2>/dev/null | grep -E 'Name:|Based on:' || echo "(none)"
    echo "--- running devices ---"; "$(sdk_bin adb)" devices 2>/dev/null || true
}

case "${1:-}" in
    setup)       cmd_setup ;;
    start)       cmd_start ;;
    trust-ca)    cmd_trust_ca ;;
    install-apk) shift; cmd_install_apk "${1:-}" ;;
    doctor)      cmd_doctor ;;
    *)
        echo "usage: $0 {setup|start|trust-ca|install-apk <apk>|doctor}"
        exit 1
        ;;
esac
