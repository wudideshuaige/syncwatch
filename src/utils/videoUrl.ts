export type VideoType = 'native' | 'bilibili' | 'youtube' | 'iframe';

export interface VideoInfo {
  type: VideoType;
  embedUrl: string;
  label: string;
}

/**
 * 解析视频URL，识别平台并返回嵌入链接
 *
 * 支持的格式：
 * - B站: https://www.bilibili.com/video/BV1xxx 或 bvid://BV1xxx
 * - YouTube: https://www.youtube.com/watch?v=xxx 或 https://youtu.be/xxx
 * - 直链视频: .mp4/.webm/.ogg 等可被 <video> 直接播放的链接
 * - 其他: 尝试作为 iframe 嵌入
 */
export function parseVideoUrl(url: string): VideoInfo {
  const trimmed = url.trim();

  // B站视频
  const bvidMatch = trimmed.match(/bilibili\.com\/video\/(BV[\w]+)/i)
    || trimmed.match(/^bvid:\/\/(BV[\w]+)$/i);
  if (bvidMatch) {
    return {
      type: 'bilibili',
      embedUrl: `https://player.bilibili.com/player.html?bvid=${bvidMatch[1]}&high_quality=1&autoplay=0`,
      label: 'B站视频',
    };
  }

  // B站 av 号
  const aidMatch = trimmed.match(/bilibili\.com\/video\/av(\d+)/i);
  if (aidMatch) {
    return {
      type: 'bilibili',
      embedUrl: `https://player.bilibili.com/player.html?aid=${aidMatch[1]}&high_quality=1&autoplay=0`,
      label: 'B站视频',
    };
  }

  // YouTube 标准链接
  const ytMatch = trimmed.match(/youtube\.com\/watch\?v=([\w-]+)/);
  if (ytMatch) {
    return {
      type: 'youtube',
      embedUrl: `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=0`,
      label: 'YouTube视频',
    };
  }

  // YouTube 短链接
  const ytShortMatch = trimmed.match(/youtu\.be\/([\w-]+)/);
  if (ytShortMatch) {
    return {
      type: 'youtube',
      embedUrl: `https://www.youtube.com/embed/${ytShortMatch[1]}?autoplay=0`,
      label: 'YouTube视频',
    };
  }

  // 直链视频（HTML5 video 可播放格式）
  const directVideoExts = ['.mp4', '.webm', '.ogg', '.m3u8'];
  const isDirectVideo = directVideoExts.some((ext) =>
    trimmed.toLowerCase().includes(ext)
  );
  if (isDirectVideo) {
    return {
      type: 'native',
      embedUrl: trimmed,
      label: '直链视频',
    };
  }

  // 其他URL尝试作为iframe嵌入
  return {
    type: 'iframe',
    embedUrl: trimmed,
    label: '嵌入视频',
  };
}

/** 判断是否为平台视频（需要iframe嵌入，无法通过JS控制播放） */
export function isPlatformVideo(type: VideoType): boolean {
  return type === 'bilibili' || type === 'youtube' || type === 'iframe';
}
