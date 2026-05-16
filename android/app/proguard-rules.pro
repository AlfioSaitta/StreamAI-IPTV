# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ----- MED-1: AndroidX Media3 (1.10.1) -----
# Preserva classi/interfacce di Media3 — reflection interna a ExoPlayer,
# Renderers e MediaSession; senza queste regole R8 può rimuovere pezzi
# fondamentali e provocare ClassNotFoundException a runtime.
-keep class androidx.media3.** { *; }
-keep interface androidx.media3.** { *; }
-dontwarn androidx.media3.**

# ----- MED-1: Google Cast SDK (richiesto da media3-cast) -----
-keep class com.google.android.gms.cast.** { *; }
-keep interface com.google.android.gms.cast.** { *; }
-dontwarn com.google.android.gms.cast.**

# ----- MED-1: Picasso (artwork loader nel plugin video) -----
-dontwarn com.squareup.picasso.**

# ----- MED-1: Plugin Capacitor video player vendorato -----
-keep class com.jeep.plugin.capacitor.capacitorvideoplayer.** { *; }
