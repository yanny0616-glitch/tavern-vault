
// ---- 藏馆 App 外壳（由 app/scripts/patch-ios.sh 追加到 SceneDelegate.swift 末尾，import WebKit 加在文件开头）----

/// 启动后注册藏馆自己的原生插件
class VaultViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(VaultShellPlugin())
    }
}

/// 记住藏馆服务器地址，并决定哪些网址留在 App 里打开：
/// 只有这台服务器的页面在 App 里显示（也只有它能用原生功能），其它网址交给 Safari 或对应的 App
@objc(VaultShellPlugin)
public class VaultShellPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VaultShellPlugin"
    public let jsName = "VaultShell"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getServer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setServer", returnType: CAPPluginReturnPromise)
    ]

    private static let key = "tavernVaultServer"

    private var server: URL? {
        UserDefaults.standard.string(forKey: Self.key).flatMap { URL(string: $0) }
    }

    @objc func getServer(_ call: CAPPluginCall) {
        call.resolve(["url": server?.absoluteString ?? ""])
    }

    @objc func setServer(_ call: CAPPluginCall) {
        let value = call.getString("url") ?? ""
        if value.isEmpty {
            UserDefaults.standard.removeObject(forKey: Self.key)
        } else {
            UserDefaults.standard.set(value, forKey: Self.key)
        }
        call.resolve()
    }

    // true：拦下（不在 App 里打开）；false：放行；nil：交给 Capacitor 默认处理
    // 默认处理会放行 App 自带的连接页、页面里的 iframe，其它网址用系统打开
    override public func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        guard let url = navigationAction.request.url, let server = server,
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            return nil
        }
        let sameServer = url.scheme?.lowercased() == server.scheme?.lowercased()
            && url.host?.lowercased() == server.host?.lowercased()
            && url.port == server.port
        return sameServer ? false : nil
    }
}
