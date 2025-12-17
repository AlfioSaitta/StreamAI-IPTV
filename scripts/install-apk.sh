#!/usr/bin/env bash
# scripts/install-apk.sh
# Piccolo helper per installare l'APK di release, diagnosticare errori comuni e mostrare suggerimenti.

set -euo pipefail
APK_PATH="android/app/build/outputs/apk/release/StreamAI-IPTV.apk"
APP_ID="com.streamai.iptv"

if [ ! -f "$APK_PATH" ]; then
  echo "APK non trovato in $APK_PATH"
  echo "Esegui prima: npm run android:build:release"
  exit 2
fi

# Controlla device
DEVICES=$(adb devices -l | sed -n '2,$p' | sed '/^$/d')
if [ -z "$DEVICES" ]; then
  echo "Nessun dispositivo Android rilevato. Assicurati di aver abilitato USB debugging e di aver accettato la chiave RSA sul dispositivo."
  echo "Esegui: adb devices -l"
  exit 3
fi

echo "Dispositivi rilevati:"
adb devices -l

# Prendi il primo device id
DEVICE_ID=$(adb devices | sed -n '2p' | awk '{print $1}')

echo "Device selezionato: $DEVICE_ID"

echo "Device ABI e SDK:
 - ABI: "$(adb -s $DEVICE_ID shell getprop ro.product.cpu.abi 2>/dev/null)"
 - SDK: "$(adb -s $DEVICE_ID shell getprop ro.build.version.sdk 2>/dev/null)"

# Prova ad installare
echo "Provo ad installare l'APK..."
if adb -s $DEVICE_ID install -r "$APK_PATH"; then
  echo "APK installato correttamente!"
  exit 0
fi

# Se l'install fallisce, prova disinstallazione forzata (firma incompatibile)
echo "Installazione fallita: provo a disinstallare l'app esistente (se presente) e reinstallare..."
adb -s $DEVICE_ID uninstall $APP_ID || true
if adb -s $DEVICE_ID install "$APK_PATH"; then
  echo "APK reinstallato correttamente dopo disinstallazione."
  exit 0
fi

# Se ancora fallisce, mostra gli ultimi log
echo "Installazione ancora fallita. Ultimi log (adb logcat):"
adb -s $DEVICE_ID logcat -d | tail -n 200

exit 1

