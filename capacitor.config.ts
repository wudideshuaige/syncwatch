import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.syncwatch.app',
  appName: 'SyncWatch',
  webDir: 'dist',
  server: {
    // 允许 WebView 从 file:// 向 http:// 发请求（解决跨域）
    androidScheme: 'https',
    cleartext: true,
  },
  plugins: {},
};

export default config;
