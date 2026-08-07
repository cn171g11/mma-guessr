// 图源提供者抽象：新增数据源时实现该接口并在 registry 登记，
// 前端经 /api/imagery/:source/* 统一访问，密钥仅存服务端
export interface ImagerySearchResult {
    data: Array<{
        id: string;
        geometry: { type: 'Point'; coordinates: [number, number] };
        is_pano?: boolean;
    }>;
}

export interface FetchedImageryImage {
    buffer: Buffer;
    contentType: string;
}

export interface ImageryProvider {
    searchImages(bbox: string, limit: number): Promise<ImagerySearchResult>;
    fetchImage(imageId: string, width: number): Promise<FetchedImageryImage>;
}
