import ExpoModulesCore

public class ExpoCallAudioModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoCallAudio")

    Function("hello") {
      return "Hello world! 👋"
    }
  }
}
