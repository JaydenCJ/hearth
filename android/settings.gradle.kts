pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "hearth-android"
// :core is a pure Kotlin/JVM module (no android.* imports) holding the
// protocol codec, WAV writer and endpointer; its unit tests run on any JVM
// via `./gradlew :core:test`, no Android SDK required.
include(":core")
include(":app")
