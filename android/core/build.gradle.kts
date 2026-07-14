// Pure Kotlin/JVM module: hub protocol codec, WAV container writer,
// energy-based endpointer and URL derivation. No android.* imports, so the
// tests run on a plain JVM: `./gradlew :core:test` (no Android SDK needed).
plugins {
    alias(libs.plugins.kotlin.jvm)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    // JSON frames for the /v1/stream WebSocket protocol (docs/protocol.md).
    // Used through the JsonElement API only — no @Serializable codegen, so
    // the serialization compiler plugin is not required.
    implementation(libs.kotlinx.serialization.json)
    testImplementation(libs.junit)
}
