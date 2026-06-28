# CivitasOne ProGuard/R8 rules for release builds
# Prevents reverse engineering of the APK

# Keep Flutter engine
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }

# Keep Kotlin metadata (required by some reflection-based plugins)
-keepattributes *Annotation*
-keepattributes RuntimeVisibleAnnotations

# Keep secure storage plugin internals
-keep class com.it_nomads.fluttersecurestorage.** { *; }

# Keep local_auth plugin
-keep class io.flutter.plugins.localauth.** { *; }

# Keep our custom plugin
-keep class com.civitasone.mobile.** { *; }

# Remove debug logging in release
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
    public static int i(...);
}

# Obfuscate everything else
-repackageclasses ''
-allowaccessmodification
-optimizationpasses 5
