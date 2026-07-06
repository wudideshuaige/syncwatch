export {};

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      getDesktopSources: () => Promise<Array<{
        id: string;
        name: string;
        thumbnail: string;
        appIcon: string | null;
      }>>;
      getServerInfo: () => Promise<{
        serverPort: number;
        lanIPs: string[];
        tunnelUrl: string;
        isServerEmbedded: boolean;
      }>;
      startTunnel: () => Promise<string>;
      onTunnelReady: (callback: (data: { url: string }) => void) => void;
      platform: string;
    };
  }
}
