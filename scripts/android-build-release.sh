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

# --- Workaround toolchain Gradle ---------------------------------------------
# Su alcune distribuzioni (es. openSUSE) il file `release` del pacchetto OpenJDK
# non contiene `IMAGE_TYPE="JDK"`. Il toolchain detector di Gradle 8 in questi
# casi marca l'installazione come priva della capability JAVA_COMPILER e la
# rifiuta, producendo l'errore:
#   "Toolchain installation '...' does not provide the required capabilities:
#    [JAVA_COMPILER]"
# Per evitarlo creiamo, se necessario, un "mirror" della JDK in
# android/.jdk-mirror con i binari originali (linkati) e un release file
# integrato con IMAGE_TYPE=JDK, poi puntiamo Gradle a questo mirror.
prepare_jdk_home() {
    local src="$1"
    if [ ! -x "$src/bin/javac" ]; then
        echo "ERRORE: $src non contiene bin/javac. Installa il pacchetto JDK 17 completo." >&2
        exit 1
    fi
    if grep -q '^IMAGE_TYPE=' "$src/release" 2>/dev/null; then
        echo "$src"
        return
    fi

    # Gradle canonicalizza i path delle installazioni JDK risolvendo i symlink,
    # quindi un mirror basato su `ln -s` viene rimappato sul JDK originale (con
    # il release file invariato). Per questo serve un mirror "reale": proviamo
    # prima con hard link (`cp -al`, istantaneo) e in fallback un full copy.
    local mirror="$ANDROID_DIR/.jdk-mirror"
    local src_dev mirror_dev
    src_dev="$(stat -c '%d' "$src")"

    # Se esiste già un mirror valido (stesso JDK_VERSION del src, IMAGE_TYPE
    # presente, javac eseguibile), lo riutilizziamo: il setup è pesante (190MB
    # su filesystem differente) e non va ripetuto ad ogni build.
    if [ -x "$mirror/bin/javac" ] \
        && grep -q '^IMAGE_TYPE=' "$mirror/release" 2>/dev/null \
        && [ "$(grep -m1 '^JAVA_VERSION=' "$mirror/release" 2>/dev/null)" = \
             "$(grep -m1 '^JAVA_VERSION=' "$src/release" 2>/dev/null)" ]; then
        echo "Riutilizzo mirror JDK esistente: $mirror" >&2
        echo "$mirror"
        return
    fi

    rm -rf "$mirror"
    mkdir -p "$(dirname "$mirror")"
    mirror_dev="$(stat -c '%d' "$(dirname "$mirror")")"

    if [ "$mirror_dev" = "$src_dev" ]; then
        echo "Creazione mirror JDK (hard link) in: $mirror" >&2
        cp -al "$src" "$mirror"
    else
        echo "Creazione mirror JDK (full copy ~200MB) in: $mirror" >&2
        echo "  (sorgente e destinazione su filesystem diversi, operazione una tantum)" >&2
        cp -a "$src" "$mirror"
    fi

    # Sovrascriviamo il release file con IMAGE_TYPE=JDK così Gradle riconosce
    # la capability JAVA_COMPILER su questa installazione.
    rm -f "$mirror/release"
    {
        if [ -f "$src/release" ]; then
            cat "$src/release"
        fi
        echo 'IMAGE_TYPE="JDK"'
    } > "$mirror/release"
    echo "$mirror"
}

JAVA_HOME="$(prepare_jdk_home "$JAVA_HOME")"
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"
echo "Effective JAVA_HOME (toolchain-safe): $JAVA_HOME"
KEYSTORE_FILE="${STREAMAI_ANDROID_KEYSTORE_FILE:-$ANDROID_DIR/streamai-release.keystore}"
KEYSTORE_ALIAS="${STREAMAI_ANDROID_KEYSTORE_ALIAS:-streamai}"
KEYSTORE_PASSWORD_ENV="STREAMAI_ANDROID_KEYSTORE_PASSWORD"
KEY_PASSWORD_ENV="STREAMAI_ANDROID_KEY_PASSWORD"
APK_UNSIGNED="$ANDROID_DIR/app/build/outputs/apk/release/app-release-unsigned.apk"
APK_SIGNED="$ANDROID_DIR/app/build/outputs/apk/release/app-release-signed.apk"
APK_FINAL="$ANDROID_DIR/app/build/outputs/apk/release/StreamAI-IPTV.apk"
KEYSTORE_PROPS="$ANDROID_DIR/keystore.properties"

# --- Gestione keystore locale -------------------------------------------------
# Se non è presente alcun keystore, ne generiamo uno locale (non versionato) per
# permettere build di sviluppo su questa macchina senza configurazione manuale.
# Le password vengono persistite in android/keystore.properties (gitignored) così
# che build successive riutilizzino lo stesso keystore.
load_keystore_props() {
    if [ -f "$KEYSTORE_PROPS" ]; then
        echo "Caricamento credenziali keystore da $KEYSTORE_PROPS"
        # shellcheck disable=SC1090
        set -a
        . "$KEYSTORE_PROPS"
        set +a
    fi
}

generate_random_password() {
    if command -v openssl &> /dev/null; then
        openssl rand -base64 24 | tr -d '\n=+/' | cut -c1-24
    else
        head -c 32 /dev/urandom | base64 | tr -d '\n=+/' | cut -c1-24
    fi
}

load_keystore_props

if [ ! -f "$KEYSTORE_FILE" ]; then
    echo ""
    echo "Keystore non trovato: $KEYSTORE_FILE"
    echo "Generazione di un keystore locale per questa macchina..."

    # Se le password non sono state fornite via env/keystore.properties, le creiamo.
    if [ -z "${!KEYSTORE_PASSWORD_ENV:-}" ]; then
        export STREAMAI_ANDROID_KEYSTORE_PASSWORD="$(generate_random_password)"
        echo "Generata password keystore casuale (salvata in $KEYSTORE_PROPS)."
    fi
    if [ -z "${!KEY_PASSWORD_ENV:-}" ]; then
        export STREAMAI_ANDROID_KEY_PASSWORD="${!KEYSTORE_PASSWORD_ENV}"
    fi

    mkdir -p "$(dirname "$KEYSTORE_FILE")"
    keytool -genkeypair -v \
        -keystore "$KEYSTORE_FILE" \
        -storetype PKCS12 \
        -keyalg RSA \
        -keysize 2048 \
        -validity 10000 \
        -alias "$KEYSTORE_ALIAS" \
        -storepass:env "$KEYSTORE_PASSWORD_ENV" \
        -keypass:env "$KEY_PASSWORD_ENV" \
        -dname "CN=StreamAI, OU=Development, O=StreamAI, L=$(hostname -s 2>/dev/null || echo Local), ST=Local, C=IT"

    # Persistiamo le credenziali in modo che le build successive le riutilizzino
    # senza richiedere variabili d'ambiente.
    umask 077
    cat > "$KEYSTORE_PROPS" <<EOF
# Generato automaticamente da scripts/android-build-release.sh
# NON committare questo file. Contiene le password del keystore locale.
STREAMAI_ANDROID_KEYSTORE_FILE="$KEYSTORE_FILE"
STREAMAI_ANDROID_KEYSTORE_ALIAS="$KEYSTORE_ALIAS"
STREAMAI_ANDROID_KEYSTORE_PASSWORD="${!KEYSTORE_PASSWORD_ENV}"
STREAMAI_ANDROID_KEY_PASSWORD="${!KEY_PASSWORD_ENV}"
EOF
    chmod 600 "$KEYSTORE_PROPS"
    echo "Keystore creato: $KEYSTORE_FILE"
    echo "Credenziali salvate in: $KEYSTORE_PROPS (file ignorato da git)"
fi

if [ -z "${!KEYSTORE_PASSWORD_ENV:-}" ]; then
    echo "ERRORE: STREAMAI_ANDROID_KEYSTORE_PASSWORD non impostata e nessun keystore esistente trovato."
    echo "Esegui di nuovo lo script per generarne uno automaticamente, oppure imposta la variabile manualmente."
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
cd "$ANDROID_DIR" && ./gradlew assembleRelease \
    -Dorg.gradle.java.home="$JAVA_HOME" \
    -Porg.gradle.java.installations.auto-detect=false \
    -Porg.gradle.java.installations.auto-download=false \
    -Porg.gradle.java.installations.paths="$JAVA_HOME"


# Firma l'APK
echo ""
echo "Firmando l'APK..."

# Pulisci eventuali artefatti residui da build precedenti interrotte
rm -f "$APK_SIGNED" "$APK_SIGNED.aligned" "$APK_FINAL"

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
            rm -f "$APK_SIGNED.aligned"
            "$ZIPALIGN" -f -v -p 4 "$APK_UNSIGNED" "$APK_SIGNED.aligned"
            mv -f "$APK_SIGNED.aligned" "$APK_UNSIGNED"
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
