import { fetchMapillaryImage, searchMapillaryImages } from '../mapillary.js';
import type { FetchedImageryImage, ImageryProvider, ImagerySearchResult } from './provider.js';

// Mapillary 图源适配器：复用既有代理实现（搜索/媒体解析/缩略图/缓存）
export const mapillaryProvider: ImageryProvider = {
    async searchImages(bbox, limit) {
        const result = await searchMapillaryImages(bbox, limit);
        return result as ImagerySearchResult;
    },
    async fetchImage(imageId, width) {
        const result = await fetchMapillaryImage(imageId, width);
        return result as FetchedImageryImage;
    },
};
