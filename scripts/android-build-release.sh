#!/bin/bash
# Script wrapper per build Android release con JAVA_HOME configurato

set -e

# Configura JAVA_HOME per Java 17 (necessario per Gradle)
if [ -d "/usr/lib64/jvm/java-17-openjdk-17" ]; then
    export JAVA_HOME="/usr/lib64/jvm/java-17-openjdk-17"
elif [ -d "/usr/lib/jvm/java-17-openjdk-amd64" ]; then
    export JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64"
elif [ -d "/usr/lib/jvm/java-17-openjdk" ]; then
    export JAVA_HOME="/usr/lib/jvm/java-17-openjdk"
elif [ -d "/usr/lib64/jvm/java-17" ]; then
    export JAVA_HOME="/usr/lib64/jvm/java-17"
elif [ -d "/usr/lib/jvm/java-17" ]; then
    export JAVA_HOME="/usr/lib/jvm/java-17"
else
    echo "ERRORE: Java 17 non trovato. Installa OpenJDK 17."
    exit 1
fi

# Assicuriamoci che JAVA_HOME sia nel PATH
export PATH="$JAVA_HOME/bin:$PATH"

echo "Using JAVA_HOME: $JAVA_HOME"
echo "Java version: $($JAVA_HOME/bin/java -version 2>&1 | head -1)"

# Directory del progetto
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ANDROID_DIR="$PROJECT_DIR/android"
KEYSTORE_FILE="${STREAMAI_ANDROID_KEYSTORE_FILE:-$ANDROID_DIR/streamai-release.keystore}"
KEYSTORE_ALIAS="${STREAMAI_ANDROID_KEYSTORE_ALIAS:-streamai}"
KEYSTORE_PASSWORD_ENV="STREAMAI_ANDROID_KEYSTORE_PASSWORD"
KEY_PASSWORD_ENV="STREAMAI_ANDROID_KEY_PASSWORD"
APK_UNSIGNED="$ANDROID_DIR/app/build/outputs/apk/release/app-release-unsigned.apk"
APK_SIGNED="$ANDROID_DIR/app/build/outputs/apk/release/app-release-signed.apk"
APK_FINAL="$ANDROID_DIR/app/build/outputs/apk/release/StreamAI-IPTV.apk"

if [ -z "${!KEYSTORE_PASSWORD_ENV:-}" ]; then
    echo "ERRORE: configura STREAMAI_ANDROID_KEYSTORE_PASSWORD prima della build release."
    echo "Esempio: export STREAMAI_ANDROID_KEYSTORE_PASSWORD='...'"
    exit 1
fi

# Se non indicata, la password della chiave coincide con quella del keystore.
# I tool di firma leggono i segreti dall'ambiente, evitando di esporli nella process list.
if [ -z "${!KEY_PASSWORD_ENV:-}" ]; then
    export STREAMAI_ANDROID_KEY_PASSWORD="${!KEYSTORE_PASSWORD_ENV}"
fi

# Esegui la build
echo "Building web assets..."
vite build

echo "Syncing with Capacitor..."
npx cap sync android

echo "Building Android APK..."
cd "$ANDROID_DIR" && ./gradlew assembleRelease -Dorg.gradle.java.home="$JAVA_HOME"

# Genera il keystore se non esiste solo su richiesta esplicita
if [ ! -f "$KEYSTORE_FILE" ]; then
    if [ "${STREAMAI_ANDROID_GENERATE_KEYSTORE:-}" != "1" ]; then
        echo "ERRORE: keystore non trovato: $KEYSTORE_FILE"
        echo "Imposta STREAMAI_ANDROID_GENERATE_KEYSTORE=1 per generarlo, oppure configura STREAMAI_ANDROID_KEYSTORE_FILE."
        exit 1
    fi

    echo ""
    echo "Generazione keystore per la firma dell'APK..."
    keytool -genkeypair -v \
        -keystore "$KEYSTORE_FILE" \
        -keyalg RSA \
        -keysize 2048 \
        -validity 10000 \
        -alias "$KEYSTORE_ALIAS" \
        -storepass:env "$KEYSTORE_PASSWORD_ENV" \
        -keypass:env "$KEY_PASSWORD_ENV" \
        -dname "CN=StreamAI, OU=Development, O=StreamAI, L=Unknown, ST=Unknown, C=IT"
    echo "Keystore creato: $KEYSTORE_FILE"
fi

# Firma l'APK
echo ""
echo "Firmando l'APK..."

# Usa apksigner se disponibile, altrimenti jarsigner
if command -v apksigner &> /dev/null || [ -f "$ANDROID_HOME/build-tools/34.0.0/apksigner" ]; then
    # Trova apksigner
    if command -v apksigner &> /dev/null; then
        APKSIGNER="apksigner"
    else
        APKSIGNER=$(find "$ANDROID_HOME/build-tools" -name "apksigner" 2>/dev/null | sort -V | tail -1)
    fi

    if [ -n "$APKSIGNER" ]; then
        # Allinea l'APK con zipalign prima
        ZIPALIGN=$(find "$ANDROID_HOME/build-tools" -name "zipalign" 2>/dev/null | sort -V | tail -1)
        if [ -n "$ZIPALIGN" ]; then
            "$ZIPALIGN" -v -p 4 "$APK_UNSIGNED" "$APK_SIGNED.aligned"
            mv "$APK_SIGNED.aligned" "$APK_UNSIGNED"
        fi

        "$APKSIGNER" sign \
            --ks "$KEYSTORE_FILE" \
            --ks-pass "env:$KEYSTORE_PASSWORD_ENV" \
            --key-pass "env:$KEY_PASSWORD_ENV" \
            --ks-key-alias "$KEYSTORE_ALIAS" \
            --out "$APK_FINAL" \
            "$APK_UNSIGNED"
        echo "APK firmato con apksigner"
    fi
else
    # Fallback a jarsigner
    jarsigner -verbose \
        -sigalg SHA256withRSA \
        -digestalg SHA-256 \
        -keystore "$KEYSTORE_FILE" \
        -storepass:env "$KEYSTORE_PASSWORD_ENV" \
        -keypass:env "$KEY_PASSWORD_ENV" \
        "$APK_UNSIGNED" "$KEYSTORE_ALIAS"

    cp "$APK_UNSIGNED" "$APK_FINAL"
    echo "APK firmato con jarsigner"
fi

echo ""
echo "=========================================="
echo "Build completata con successo!"
echo "=========================================="
echo ""
echo "APK installabile disponibile in:"
echo "$APK_FINAL"
echo ""
echo "Per installare sul dispositivo:"
echo "  adb install $APK_FINAL"
echo ""
