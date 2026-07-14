plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "dev.hearth.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.hearth.app"
        // RoleManager.ROLE_ASSISTANT requires API 29 (Android 10).
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // Platform-independent protocol codec, WAV writer and endpointer.
    // Unit tests live there and run on a plain JVM: ./gradlew :core:test
    implementation(project(":core"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.kotlinx.coroutines.android)
    // WebSocket + REST client for talking to the Hearth hub.
    implementation(libs.okhttp)
}
