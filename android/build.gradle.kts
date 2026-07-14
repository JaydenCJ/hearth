// Top-level build file. Individual modules configure their own plugins;
// versions come from gradle/libs.versions.toml (the version catalog).
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.jvm) apply false
}
