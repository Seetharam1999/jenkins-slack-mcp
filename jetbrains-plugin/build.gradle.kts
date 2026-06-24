plugins {
    id("org.jetbrains.kotlin.jvm") version "1.9.21"
    id("org.jetbrains.intellij") version "1.16.1"
}

group = "com.buildpilot"
version = "1.0.0"

repositories {
    mavenCentral()
}

dependencies {
    // No external dependencies - uses IntelliJ platform's built-in HTTP client and JSON
}

intellij {
    version.set("2023.3")
    type.set("IC") // IntelliJ Community - works in all JetBrains IDEs
    plugins.set(listOf())
}

tasks {
    patchPluginXml {
        sinceBuild.set("233")
        untilBuild.set("243.*")
    }

    signPlugin {
        certificateChain.set(System.getenv("CERTIFICATE_CHAIN"))
        privateKey.set(System.getenv("PRIVATE_KEY"))
        password.set(System.getenv("PRIVATE_KEY_PASSWORD"))
    }

    publishPlugin {
        token.set(System.getenv("PUBLISH_TOKEN"))
    }
}
