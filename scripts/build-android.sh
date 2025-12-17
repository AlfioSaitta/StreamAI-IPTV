#!/bin/bash
# Script per verificare i requisiti e compilare l'APK Android

set -e

echo "🔍 Verifica requisiti Android build..."
echo ""

# Verifica Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js non trovato. Installalo da https://nodejs.org/"
    exit 1
fi
echo "✅ Node.js: $(node --version)"

# Verifica npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm non trovato."
    exit 1
fi
echo "✅ npm: $(npm --version)"

# Verifica Java
if ! command -v java &> /dev/null; then
    echo "❌ Java non trovato. Installa JDK 17+:"
    echo "   Ubuntu/Debian: sudo apt install openjdk-17-jdk"
    echo "   Fedora/RHEL: sudo dnf install java-17-openjdk-devel"
    echo "   openSUSE: sudo zypper install java-17-openjdk-devel"
    exit 1
fi
echo "✅ Java: $(java --version | head -1)"

# Verifica javac (JDK, non solo JRE)
if ! command -v javac &> /dev/null; then
    echo ""
    echo "❌ javac non trovato. Hai installato solo il JRE, serve il JDK completo!"
    echo ""
    echo "   Installa il JDK:"
    echo "   Ubuntu/Debian: sudo apt install openjdk-17-jdk"
    echo "   Fedora/RHEL: sudo dnf install java-17-openjdk-devel"
    echo "   openSUSE: sudo zypper install java-17-openjdk-devel"
    echo ""
    exit 1
fi
echo "✅ javac: $(javac --version)"

# Configura JAVA_HOME per Java 17 (necessario per Gradle)
if [ -z "$JAVA_HOME" ]; then
    # Prova a trovare Java 17
    if [ -d "/usr/lib64/jvm/java-17-openjdk-17" ]; then
        export JAVA_HOME="/usr/lib64/jvm/java-17-openjdk-17"
        echo "✅ JAVA_HOME configurato: $JAVA_HOME"
    elif [ -d "/usr/lib/jvm/java-17-openjdk-amd64" ]; then
        export JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64"
        echo "✅ JAVA_HOME configurato: $JAVA_HOME"
    elif [ -d "/usr/lib/jvm/java-17-openjdk" ]; then
        export JAVA_HOME="/usr/lib/jvm/java-17-openjdk"
        echo "✅ JAVA_HOME configurato: $JAVA_HOME"
    else
        echo "⚠️  JAVA_HOME non trovato automaticamente. Gradle userà la versione di default."
    fi
else
    echo "✅ JAVA_HOME già configurato: $JAVA_HOME"
fi

# Verifica ANDROID_HOME (opzionale)
if [ -n "$ANDROID_HOME" ]; then
    echo "✅ ANDROID_HOME: $ANDROID_HOME"
else
    echo "⚠️  ANDROID_HOME non impostato (opzionale se usi solo Gradle)"
fi

echo ""
echo "📦 Build in corso..."
echo ""

# Build web
npm run build

# Sync Capacitor
npx cap sync android

# Build APK
cd android
./gradlew assembleDebug

echo ""
echo "✅ Build completata!"
echo ""
echo "📱 APK disponibile in:"
echo "   android/app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo "Per installare su dispositivo connesso:"
echo "   adb install android/app/build/outputs/apk/debug/app-debug.apk"
