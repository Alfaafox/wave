import ExpoModulesCore
import UIKit

public class ExpoCallAudioModule: Module {
  // Holds the hidden secure UITextField while screenshot blocking is on.
  private var secureField: UITextField?

  public func definition() -> ModuleDefinition {
    Name("ExpoCallAudio")

    // Screenshot / screen-recording blocking, used by the view-once photo
    // viewer (ViewOnceViewer.js). iOS has no window flag for this outside
    // CallKit; the reliable trick is to route the key window's layer through a
    // secureTextEntry UITextField's layer, which the system excludes from
    // screenshots and recordings. No-op if there is no key window.
    Function("setSecureScreen") { (enabled: Bool) in
      DispatchQueue.main.async {
        let window = UIApplication.shared.windows.first(where: { $0.isKeyWindow })
          ?? UIApplication.shared.windows.first
        guard let window = window else { return }

        if enabled {
          if self.secureField == nil {
            let field = UITextField()
            field.isSecureTextEntry = true
            field.translatesAutoresizingMaskIntoConstraints = false
            window.addSubview(field)
            field.centerXAnchor.constraint(equalTo: window.centerXAnchor).isActive = true
            field.centerYAnchor.constraint(equalTo: window.centerYAnchor).isActive = true
            window.layer.superlayer?.addSublayer(field.layer)
            if #available(iOS 17.0, *) {
              field.layer.sublayers?.last?.addSublayer(window.layer)
            } else {
              field.layer.sublayers?.first?.addSublayer(window.layer)
            }
            self.secureField = field
          }
        } else {
          self.secureField?.removeFromSuperview()
          self.secureField = nil
        }
      }
    }
  }
}
