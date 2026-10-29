#!/usr/bin/env bash
# 在 `npx cap add ios` 生成的工程上套用藏馆的定制：原生外壳代码、图标、启动图、Info.plist
# 只在 macOS（GitHub Actions）上运行，用到 PlistBuddy
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IOS="$APP_DIR/ios/App/App"
PLIST="$IOS/Info.plist"
PB=/usr/libexec/PlistBuddy

# 1. 原生外壳：根视图换成 VaultViewController，并注册 VaultShell 插件
SCENE="$IOS/SceneDelegate.swift"
grep -q 'CAPBridgeViewController()' "$SCENE" || { echo "SceneDelegate.swift 模板变了，找不到 CAPBridgeViewController()" >&2; exit 1; }
sed -i '' 's/CAPBridgeViewController()/VaultViewController()/' "$SCENE"
{ echo 'import WebKit'; cat "$SCENE" "$APP_DIR/native-ios/VaultShell.swift"; } > "$SCENE.new"
mv "$SCENE.new" "$SCENE"
sed -i '' 's/customClass="CAPBridgeViewController" customModule="Capacitor"/customClass="VaultViewController" customModule="App" customModuleProvider="target"/' "$IOS/Base.lproj/Main.storyboard"

# 2. 图标和启动图
cp "$APP_DIR/assets/icon-1024.png" "$IOS/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
for f in "$IOS"/Assets.xcassets/Splash.imageset/*.png; do cp "$APP_DIR/assets/splash-2732.png" "$f"; done

# 3. Info.plist
set_key() { # key type [value]（dict / array 不带值）
    $PB -c "Delete :$1" "$PLIST" >/dev/null 2>&1 || true
    if [ $# -ge 3 ]; then $PB -c "Add :$1 $2 $3" "$PLIST"; else $PB -c "Add :$1 $2" "$PLIST"; fi
}
set_key CFBundleDisplayName string "藏馆"
set_key ITSAppUsesNonExemptEncryption bool false
# 允许 http 的局域网地址；连局域网要先问用户
set_key NSAppTransportSecurity dict
$PB -c "Add :NSAppTransportSecurity:NSAllowsArbitraryLoads bool true" "$PLIST"
set_key NSLocalNetworkUsageDescription string "连接局域网里的藏馆服务"
# 网页里的文件选择会提供拍照和相册；分享面板里的「存储图像」要写入相册的权限
set_key NSCameraUsageDescription string "拍照作为封面或附件"
set_key NSPhotoLibraryUsageDescription string "从相册选择图片导入藏馆"
set_key NSPhotoLibraryAddUsageDescription string "把导出的图片存到相册"

# 在别的 App 里分享任意文件时出现「藏馆」；文件会被复制到 App 的 Inbox 再导入
set_key LSSupportsOpeningDocumentsInPlace bool false
set_key CFBundleDocumentTypes array
$PB -c "Add :CFBundleDocumentTypes:0 dict" "$PLIST"
$PB -c "Add :CFBundleDocumentTypes:0:CFBundleTypeName string 藏馆可导入的文件" "$PLIST"
$PB -c "Add :CFBundleDocumentTypes:0:LSHandlerRank string Alternate" "$PLIST"
$PB -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes array" "$PLIST"
i=0
for t in public.png public.jpeg public.image public.json public.plain-text public.zip-archive public.data public.content; do
    $PB -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes:$i string $t" "$PLIST"
    i=$((i + 1))
done

# 模板里还留着 armv7，arm64 才对
set_key UIRequiredDeviceCapabilities array
$PB -c "Add :UIRequiredDeviceCapabilities:0 string arm64" "$PLIST"

echo "iOS 工程已套用藏馆定制"
