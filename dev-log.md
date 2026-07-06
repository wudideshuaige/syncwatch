# SyncWatch 多平台开发日志

## 2026-07-06

### 目标
将 SyncWatch Web 应用打包为桌面端（Electron）和移动端（Capacitor）原生应用。

### 技术选型决策
- **桌面端**: Electron（Chromium 内核，WebRTC 兼容性最佳，生态成熟）
- **移动端**: Capacitor（将 Web 代码包装为 Android/iOS 原生应用）

### 选择理由
- Electron vs Tauri: 虽然 Tauri 更轻量（~5MB vs ~150MB），但项目重度依赖 WebRTC，Electron 的完整 Chromium 内核确保最大兼容性。稳定优先。
- Capacitor vs React Native: Capacitor 可直接复用现有 React 代码，无需重写；React Native 需要大量重写且 WebRTC 支持复杂。

### 架构说明
- 后端（api/）仍为独立服务器，不打包进客户端
- 桌面/移动端仅包含前端代码，连接远程后端
- 需要配置生产环境 API 地址（不再使用 Vite 代理）

---

## Phase 1: Electron 桌面端

### 完成内容

#### 1. 依赖安装
- `electron` v43.0.0 - 桌面应用框架
- `electron-builder` v26.15.3 - 打包构建工具
- `wait-on` v9.0.10 - 等待服务就绪

#### 2. 文件结构
```
electron/
  main.cjs      # Electron 主进程（CommonJS 格式）
  preload.cjs    # 预加载脚本（暴露安全 API 给渲染进程）
```

**注意**: 使用 `.cjs` 扩展名而非 `.js`，因为项目 `package.json` 设置了 `"type": "module"`。如果用 `.js` 会被 Node.js 当作 ESM 导致 `require` 报错。

#### 3. 主进程功能 (main.cjs)
- 创建 BrowserWindow 加载 Vite 开发服务器或 dist 目录
- 屏幕共享权限自动授予（media/clipboard）
- IPC 通信：渲染进程可调用 `get-desktop-sources` 获取桌面源列表
- 开发模式：userData 指向 `.electron-dev/` 目录避免沙箱冲突
- 生产模式：加载 `dist/index.html`

#### 4. Preload 脚本 (preload.cjs)
通过 contextBridge 安全暴露 API：
- `electronAPI.isElectron` - 判断运行环境
- `electronAPI.getDesktopSources()` - 获取屏幕共享源
- `electronAPI.platform` - 操作系统信息

#### 5. 前端适配
- **config.ts** - 统一运行环境检测（Electron/Capacitor/Web），API 地址解析支持环境变量、localStorage、自动检测三级优先
- **roomStore.ts**:
  - Socket.IO 连接地址改用 `getSocketUrl()` 动态获取
  - `connect()` 改为 async（动态 import config.ts）
  - 屏幕共享：Electron 环境使用 `desktopCapturer` + `getUserMedia({ chromeMediaSource: 'desktop' })`
  - 语音通话：添加 Capacitor 运行时权限查询
- **Home.tsx**:
  - API fetch 使用 `getApiBaseUrl()` 拼接前缀
  - 新增服务器地址设置 UI（仅原生应用显示），支持用户输入并保存到 localStorage

#### 6. 构建配置 (package.json)
```json
{
  "main": "electron/main.cjs",
  "build": {
    "appId": "com.syncwatch.app",
    "productName": "SyncWatch",
    "win": { "target": ["nsis"] }
  },
  "scripts": {
    "electron:dev": "concurrently -k \"npm run client:dev\" \"wait-on http://localhost:5173 && electron .\"",
    "build:electron": "tsc -b && vite build && electron-builder --win"
  }
}
```

#### 7. Vite 配置更新
- `base: './'` - Electron 生产模式需要相对路径加载本地文件
- `server.watch.ignored` - 排除 `.electron-dev`/`release`/`android` 目录的文件监听

---

## Phase 2: Capacitor 移动端

### 完成内容

#### 1. 依赖安装
- `@capacitor/core` v8.4.1
- `@capacitor/cli` v8.4.1
- `@capacitor/android` v8.4.1
- `@capacitor/haptics` / `@capacitor/status-bar` (可选增强插件)

#### 2. Android 平台配置
- 已执行 `npx cap add android`，生成完整 Android 项目结构

**AndroidManifest.xml 权限声明**:
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />     <!-- 语音通话 -->
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

**网络安全配置** (`network_security_config.xml`):
- 允许 HTTP 明文连接（开发环境需要）
- 白名单 localhost 和局域网 IP

#### 3. Capacitor 运行时权限处理
在 `joinVoiceChat` 中添加了 Android 权限检查逻辑：
```typescript
if (window.Capacitor?.isNativePlatform?.()) {
  const result = await Permissions.query({ name: 'microphone' });
  if (result.state === 'denied') return; // 权限被拒绝则放弃
}
```

#### 4. 服务器地址配置
- 首页新增"服务器设置"面板（仅 Electron/Capacitor 显示）
- 用户输入服务器 URL → 保存到 localStorage → config.ts 自动读取
- 优先级：环境变量 > localStorage > 自动检测

#### 5. 构建脚本
```bash
npm run cap:sync        # 构建 web + 同步到 native 平台
npm run cap:android     # 在 Android Studio 中打开项目
npm run cap:run:android # 同步 + 安装到设备运行
```

---

## 待解决事项

1. **Trae 沙箱限制**: Electron 在 Trae IDE 的沙箱环境中可能受限（访问 AppData 等系统目录）。建议在系统 PowerShell 中手动运行 `npm run electron:dev` 测试。
2. **生产环境图标**: `public/favicon.svg` 是 SVG 格式，electron-builder 可能需要 ICO/PNG 图标。正式发布前需替换。
3. **iOS 平台**: 如需支持 iOS，执行 `npx cap add ios` 并在 macOS 上使用 Xcode 构建。
4. **Android APK/AAB 构建**: 需要 Android Studio 或 Gradle 命令行来生成最终安装包。

---

## 项目文件清单（新增/修改）

| 文件 | 说明 |
|------|------|
| `electron/main.cjs` | Electron 主进程 |
| `electron/preload.cjs` | Preload 安全桥接 |
| `src/lib/config.ts` | 多平台环境配置工具 |
| `src/types/electron.d.ts` | TypeScript 类型声明 |
| `capacitor.config.ts` | Capacitor 配置 |
| `android/` | Android 原生项目 |
| `package.json` | 新增 scripts/build 配置 |
| `vite.config.ts` | base + watch ignore |
| `.npmrc` | Electron 国内镜像 |
| `.gitignore` | 忽略 .electron-dev/release |
