import { LOCATION_SOURCES, type LocationSource } from '../../locations/types.js';
import { badRequest } from '../../utils/httpError.js';
import { mapillaryProvider } from './mapillary.js';
import type { ImageryProvider } from './provider.js';

// 数据源注册表：新增图源时在此登记对应的 provider，并在 LOCATION_SOURCES 中加入来源名
const PROVIDERS: Readonly<Record<LocationSource, ImageryProvider>> = {
    mapillary: mapillaryProvider,
};

function isLocationSource(value: string): value is LocationSource {
    return (LOCATION_SOURCES as readonly string[]).includes(value);
}

export function getImageryProvider(source: string): ImageryProvider {
    if (!isLocationSource(source)) {
        throw badRequest(`未知图片数据源：${source}`);
    }
    return PROVIDERS[source];
}
