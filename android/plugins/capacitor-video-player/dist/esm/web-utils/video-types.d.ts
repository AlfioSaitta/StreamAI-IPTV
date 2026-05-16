export type videoExtension = 'mp4' | 'webm' | 'cmaf' | 'cmfv' | 'm3u8';
export type videoMimeType = 'video/mp4' | 'application/x-mpegURL';
export declare const possibleQueryParameterExtensions: string[];
export declare const videoTypes: Record<videoExtension, videoMimeType>;
