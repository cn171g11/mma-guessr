#!/usr/bin/env node
'use strict';
/**
 * v1.13.0 — 世界街景扩充：验证候选点位并生成有效清单
 * 逐点调用 Mapillary API（curl），6 并发，验证后输出 report 供写入 LOCATIONS
 */
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GAME = path.join(ROOT, 'src', 'js', 'data.js');
const TOKEN = process.env.MAPILLARY_TOKEN || 'MLY|27847157814868912|297a1717444edeb373bb94009d2df54a';

// ==========================================================
// 候选世界点位（覆盖六大洲，尽量避开现有 LOCATIONS 中已有点名）
// name 前缀为国家/地区，便于 Notion 分布统计
// ==========================================================
const CANDIDATES = [
    // ---- 欧洲 (Europe) ----
    { name: '英国伦敦·伦敦眼', lat: 51.5033, lng: -0.1196, region: 'europe', difficulty: 1 },
    { name: '英国伦敦·白金汉宫', lat: 51.5014, lng: -0.1419, region: 'europe', difficulty: 1 },
    { name: '英国爱丁堡·城堡', lat: 55.9486, lng: -3.1999, region: 'europe', difficulty: 2 },
    { name: '英国曼彻斯特·中心', lat: 53.4808, lng: -2.2426, region: 'europe', difficulty: 3 },
    { name: '英国利物浦·码头区', lat: 53.4041, lng: -2.9938, region: 'europe', difficulty: 3 },
    { name: '英国剑桥·国王学院', lat: 52.2043, lng: 0.1171, region: 'europe', difficulty: 2 },
    { name: '法国巴黎·凯旋门', lat: 48.8738, lng: 2.295, region: 'europe', difficulty: 1 },
    { name: '法国巴黎·卢浮宫', lat: 48.8606, lng: 2.3376, region: 'europe', difficulty: 1 },
    { name: '法国尼斯·天使湾', lat: 43.6953, lng: 7.2583, region: 'europe', difficulty: 2 },
    { name: '法国波尔多·交易所广场', lat: 44.8412, lng: -0.5698, region: 'europe', difficulty: 3 },
    { name: '法国里尔·大广场', lat: 50.6306, lng: 3.0626, region: 'europe', difficulty: 3 },
    { name: '德国法兰克福·罗马广场', lat: 50.1106, lng: 8.6821, region: 'europe', difficulty: 2 },
    { name: '德国科隆·大教堂', lat: 50.9413, lng: 6.9583, region: 'europe', difficulty: 2 },
    { name: '德国斯图加特·市中心', lat: 48.7758, lng: 9.1829, region: 'europe', difficulty: 3 },
    { name: '德国德累斯顿·茨温格宫', lat: 51.0529, lng: 13.7337, region: 'europe', difficulty: 3 },
    { name: '德国海德堡·老城', lat: 49.4106, lng: 8.6947, region: 'europe', difficulty: 3 },
    { name: '意大利威尼斯·圣马可广场', lat: 45.4342, lng: 12.3388, region: 'europe', difficulty: 1 },
    { name: '意大利那不勒斯·市中心', lat: 40.8518, lng: 14.2681, region: 'europe', difficulty: 3 },
    { name: '意大利都灵·安托内利尖塔', lat: 45.0685, lng: 7.6852, region: 'europe', difficulty: 3 },
    { name: '意大利博洛尼亚·双塔', lat: 44.4941, lng: 11.3465, region: 'europe', difficulty: 4 },
    { name: '意大利维罗纳·竞技场', lat: 45.4388, lng: 10.9938, region: 'europe', difficulty: 3 },
    { name: '西班牙瓦伦西亚·艺术科学城', lat: 39.4549, lng: -0.3525, region: 'europe', difficulty: 3 },
    { name: '西班牙毕尔巴鄂·古根海姆', lat: 43.2687, lng: -2.9342, region: 'europe', difficulty: 3 },
    { name: '西班牙格拉纳达·阿尔罕布拉宫', lat: 37.1765, lng: -3.5888, region: 'europe', difficulty: 2 },
    { name: '西班牙马拉加·毕加索广场', lat: 36.7213, lng: -4.4174, region: 'europe', difficulty: 3 },
    { name: '葡萄牙辛特拉·佩纳宫', lat: 38.7877, lng: -9.3907, region: 'europe', difficulty: 3 },
    { name: '荷兰鹿特丹·立体方块屋', lat: 51.9201, lng: 4.4903, region: 'europe', difficulty: 3 },
    { name: '荷兰海牙·和平宫', lat: 52.0868, lng: 4.2951, region: 'europe', difficulty: 3 },
    { name: '比利时布鲁日·钟楼', lat: 51.2082, lng: 3.2263, region: 'europe', difficulty: 2 },
    { name: '比利时安特卫普·大广场', lat: 51.2213, lng: 4.3993, region: 'europe', difficulty: 3 },
    { name: '瑞士苏黎世·班霍夫大街', lat: 47.3744, lng: 8.539, region: 'europe', difficulty: 2 },
    { name: '瑞士日内瓦·大喷泉', lat: 46.2074, lng: 6.1555, region: 'europe', difficulty: 2 },
    { name: '瑞士卢塞恩·卡佩尔桥', lat: 47.0517, lng: 8.3079, region: 'europe', difficulty: 2 },
    { name: '奥地利萨尔茨堡·老城', lat: 47.8007, lng: 13.045, region: 'europe', difficulty: 3 },
    { name: '奥地利因斯布鲁克·黄金屋顶', lat: 47.2686, lng: 11.3935, region: 'europe', difficulty: 3 },
    { name: '丹麦哥本哈根·新港', lat: 55.6797, lng: 12.5921, region: 'europe', difficulty: 2 },
    { name: '丹麦哥本哈根·蒂沃利', lat: 55.6736, lng: 12.5683, region: 'europe', difficulty: 2 },
    { name: '瑞典斯德哥尔摩·老城', lat: 59.3251, lng: 18.071, region: 'europe', difficulty: 2 },
    { name: '挪威卑尔根·布吕根', lat: 60.397, lng: 5.3232, region: 'europe', difficulty: 3 },
    { name: '芬兰赫尔辛基·参议院广场', lat: 60.1695, lng: 24.9515, region: 'europe', difficulty: 2 },
    { name: '波兰格但斯克·长街', lat: 54.3486, lng: 18.6533, region: 'europe', difficulty: 3 },
    { name: '波兰弗罗茨瓦夫·集市广场', lat: 51.1079, lng: 17.0304, region: 'europe', difficulty: 3 },
    { name: '捷克布尔诺·自由广场', lat: 49.1947, lng: 16.6085, region: 'europe', difficulty: 4 },
    { name: '匈牙利埃格尔·城堡', lat: 47.9025, lng: 20.3779, region: 'europe', difficulty: 4 },
    { name: '希腊塞萨洛尼基·海滨大道', lat: 40.626, lng: 22.95, region: 'europe', difficulty: 3 },
    { name: '希腊圣托里尼·伊亚', lat: 36.4618, lng: 25.3753, region: 'europe', difficulty: 3 },
    { name: '克罗地亚杜布罗夫尼克·老城', lat: 42.6507, lng: 18.0944, region: 'europe', difficulty: 3 },
    { name: '克罗地亚斯普利特·戴克里先宫', lat: 43.5081, lng: 16.4402, region: 'europe', difficulty: 4 },
    { name: '爱尔兰都柏林·圣殿酒吧区', lat: 53.3449, lng: -6.2662, region: 'europe', difficulty: 2 },
    { name: '罗马尼亚布加勒斯特·老城', lat: 44.431, lng: 26.0994, region: 'europe', difficulty: 4 },
    { name: '保加利亚索非亚·亚历山大涅夫斯基', lat: 42.6956, lng: 23.334, region: 'europe', difficulty: 4 },
    { name: '匈牙利布达佩斯·渔人堡', lat: 47.5023, lng: 19.0346, region: 'europe', difficulty: 2 },
    { name: '斯洛文尼亚卢布尔雅那·龙桥', lat: 46.0516, lng: 14.507, region: 'europe', difficulty: 3 },
    { name: '爱沙尼亚塔林·老城', lat: 59.4362, lng: 24.7463, region: 'europe', difficulty: 3 },
    { name: '拉脱维亚里加·老城', lat: 56.947, lng: 24.1061, region: 'europe', difficulty: 4 },
    { name: '立陶宛考纳斯·老城', lat: 54.8974, lng: 23.8864, region: 'europe', difficulty: 4 },
    { name: '俄罗斯莫斯科·莫斯科河畔', lat: 55.7522, lng: 37.6156, region: 'europe', difficulty: 2 },
    { name: '俄罗斯圣彼得堡·涅瓦大街', lat: 59.9343, lng: 30.3351, region: 'europe', difficulty: 2 },
    { name: '乌克兰基辅·独立广场', lat: 50.4501, lng: 30.5234, region: 'europe', difficulty: 3 },
    { name: '格鲁吉亚第比利斯·老城', lat: 41.6908, lng: 44.809, region: 'europe', difficulty: 4 },
    { name: '土耳其伊斯坦布尔·加拉太塔', lat: 41.0256, lng: 28.9742, region: 'europe', difficulty: 2 },
    { name: '土耳其伊兹密尔·钟楼广场', lat: 38.4189, lng: 27.1287, region: 'europe', difficulty: 3 },
    { name: '土耳其安卡拉·共和国塔', lat: 39.9428, lng: 32.8554, region: 'europe', difficulty: 4 },
    { name: '德国柏林·博物馆岛', lat: 52.5172, lng: 13.4011, region: 'europe', difficulty: 2 },

    // ---- 亚洲 (Asia, 非中国) ----
    { name: '日本东京·浅草寺', lat: 35.7148, lng: 139.7967, region: 'asia', difficulty: 1 },
    { name: '日本东京·涩谷十字路口', lat: 35.6595, lng: 139.7005, region: 'asia', difficulty: 1 },
    { name: '日本横滨·中华街', lat: 35.4437, lng: 139.6463, region: 'asia', difficulty: 3 },
    { name: '日本名古屋·名古屋城', lat: 35.1853, lng: 136.8997, region: 'asia', difficulty: 2 },
    { name: '日本神户·南京町', lat: 34.6852, lng: 135.1867, region: 'asia', difficulty: 3 },
    { name: '日本广岛·和平公园', lat: 34.3926, lng: 132.4527, region: 'asia', difficulty: 2 },
    { name: '日本福冈·运河城', lat: 33.5896, lng: 130.401, region: 'asia', difficulty: 3 },
    { name: '日本奈良·东大寺', lat: 34.6889, lng: 135.8397, region: 'asia', difficulty: 2 },
    { name: '日本札幌·狸小路', lat: 43.0566, lng: 141.3517, region: 'asia', difficulty: 3 },
    { name: '韩国首尔·景福宫', lat: 37.5796, lng: 126.977, region: 'asia', difficulty: 1 },
    { name: '韩国首尔·弘大商圈', lat: 37.5566, lng: 126.9238, region: 'asia', difficulty: 3 },
    { name: '韩国釜山·海云台', lat: 35.1587, lng: 129.1604, region: 'asia', difficulty: 2 },
    { name: '韩国济州岛·龙头岩', lat: 33.5168, lng: 126.5166, region: 'asia', difficulty: 3 },
    { name: '泰国曼谷·考山路', lat: 13.7585, lng: 100.4974, region: 'asia', difficulty: 2 },
    { name: '泰国清迈·古城塔佩门', lat: 18.7883, lng: 98.9897, region: 'asia', difficulty: 2 },
    { name: '泰国芭提雅·海滩路', lat: 12.9335, lng: 100.8595, region: 'asia', difficulty: 3 },
    { name: '新加坡·牛车水', lat: 1.2836, lng: 103.8435, region: 'asia', difficulty: 2 },
    { name: '新加坡·乌节路', lat: 1.3048, lng: 103.8318, region: 'asia', difficulty: 2 },
    { name: '马来西亚吉隆坡·双子塔', lat: 3.1578, lng: 101.712, region: 'asia', difficulty: 1 },
    { name: '马来西亚槟城·姓氏桥', lat: 5.4111, lng: 100.3337, region: 'asia', difficulty: 3 },
    { name: '马来西亚马六甲·红屋广场', lat: 2.1941, lng: 102.2493, region: 'asia', difficulty: 3 },
    { name: '印尼巴厘岛·库塔海滩', lat: -8.7183, lng: 115.1683, region: 'asia', difficulty: 2 },
    { name: '印尼日惹·婆罗浮屠', lat: -7.6079, lng: 110.2038, region: 'asia', difficulty: 3 },
    { name: '印尼万隆·亚非会议街', lat: -6.9175, lng: 107.6095, region: 'asia', difficulty: 4 },
    { name: '菲律宾马尼拉·黎刹公园', lat: 14.5826, lng: 120.9816, region: 'asia', difficulty: 3 },
    { name: '菲律宾宿务·圣婴教堂', lat: 10.2931, lng: 123.9019, region: 'asia', difficulty: 4 },
    { name: '越南河内·还剑湖', lat: 21.0285, lng: 105.8522, region: 'asia', difficulty: 2 },
    { name: '越南胡志明市·滨城市场', lat: 10.7727, lng: 106.698, region: 'asia', difficulty: 2 },
    { name: '越南岘港·美溪海滩', lat: 16.0603, lng: 108.24, region: 'asia', difficulty: 3 },
    { name: '柬埔寨暹粒·吴哥窟', lat: 13.4125, lng: 103.867, region: 'asia', difficulty: 2 },
    { name: '缅甸仰光·大金塔', lat: 16.7983, lng: 96.149, region: 'asia', difficulty: 3 },
    { name: '尼泊尔加德满都·杜巴广场', lat: 27.7042, lng: 85.3071, region: 'asia', difficulty: 3 },
    { name: '印度新德里·印度门', lat: 28.6129, lng: 77.2295, region: 'asia', difficulty: 2 },
    { name: '印度斋浦尔·风之宫', lat: 26.9239, lng: 75.8267, region: 'asia', difficulty: 2 },
    { name: '印度孟买·印度门', lat: 18.922, lng: 72.8347, region: 'asia', difficulty: 2 },
    { name: '印度班加罗尔·库本公园', lat: 12.9762, lng: 77.5931, region: 'asia', difficulty: 4 },
    { name: '斯里兰卡科伦坡·加勒菲斯绿地', lat: 6.9271, lng: 79.848, region: 'asia', difficulty: 3 },
    { name: '斯里兰卡康提·佛牙寺', lat: 7.2937, lng: 80.6413, region: 'asia', difficulty: 4 },
    { name: '孟加拉国达卡·国会大厦', lat: 23.778, lng: 90.37, region: 'asia', difficulty: 5 },
    { name: '阿联酋阿布扎比·大清真寺', lat: 24.4128, lng: 54.4748, region: 'asia', difficulty: 2 },
    { name: '卡塔尔多哈·伊斯兰艺术博物馆', lat: 25.295, lng: 51.539, region: 'asia', difficulty: 3 },
    { name: '沙特利雅得·王国中心', lat: 24.7136, lng: 46.6753, region: 'asia', difficulty: 4 },
    { name: '以色列耶路撒冷·西墙', lat: 31.7767, lng: 35.2345, region: 'asia', difficulty: 3 },
    { name: '以色列特拉维夫·罗斯柴尔德大道', lat: 32.0638, lng: 34.7708, region: 'asia', difficulty: 3 },
    { name: '约旦安曼·城堡山', lat: 31.9547, lng: 35.9348, region: 'asia', difficulty: 4 },
    { name: '黎巴嫩贝鲁特·鸽子岩', lat: 33.9025, lng: 35.4705, region: 'asia', difficulty: 4 },
    { name: '阿塞拜疆巴库·火焰塔', lat: 40.36, lng: 49.824, region: 'asia', difficulty: 4 },
    { name: '哈萨克斯坦阿拉木图·独立广场', lat: 43.2473, lng: 76.9458, region: 'asia', difficulty: 4 },
    { name: '乌兹别克斯坦撒马尔罕·列基斯坦', lat: 39.6546, lng: 66.9757, region: 'asia', difficulty: 4 },
    { name: '蒙古乌兰巴托·苏赫巴托广场', lat: 47.9186, lng: 106.9177, region: 'asia', difficulty: 4 },

    // ---- 北美洲 (North America) ----
    { name: '美国纽约·布鲁克林大桥', lat: 40.7061, lng: -73.9969, region: 'northamerica', difficulty: 1 },
    { name: '美国纽约·洛克菲勒中心', lat: 40.7587, lng: -73.9787, region: 'northamerica', difficulty: 2 },
    { name: '美国迈阿密·南海滩', lat: 25.779, lng: -80.1306, region: 'northamerica', difficulty: 2 },
    { name: '美国奥兰多·市中心', lat: 28.5383, lng: -81.3792, region: 'northamerica', difficulty: 3 },
    { name: '美国亚特兰大·奥林匹克公园', lat: 33.7601, lng: -84.3931, region: 'northamerica', difficulty: 3 },
    { name: '美国休斯顿·市中心', lat: 29.7604, lng: -95.3698, region: 'northamerica', difficulty: 3 },
    { name: '美国达拉斯·感恩广场', lat: 32.7876, lng: -96.8004, region: 'northamerica', difficulty: 3 },
    { name: '美国丹佛·联合车站', lat: 39.753, lng: -105.0005, region: 'northamerica', difficulty: 3 },
    { name: '美国凤凰城·市中心', lat: 33.4484, lng: -112.074, region: 'northamerica', difficulty: 3 },
    { name: '美国拉斯维加斯·长街', lat: 36.1126, lng: -115.1747, region: 'northamerica', difficulty: 2 },
    { name: '美国圣地亚哥·煤气灯街区', lat: 32.7101, lng: -117.162, region: 'northamerica', difficulty: 3 },
    { name: '美国新奥尔良·法国区', lat: 29.9584, lng: -90.0641, region: 'northamerica', difficulty: 3 },
    { name: '美国纳什维尔·百老汇大街', lat: 36.1622, lng: -86.778, region: 'northamerica', difficulty: 3 },
    { name: '美国奥斯汀·第六街', lat: 30.2672, lng: -97.7431, region: 'northamerica', difficulty: 3 },
    { name: '美国费城·独立宫', lat: 39.9489, lng: -75.15, region: 'northamerica', difficulty: 2 },
    { name: '美国盐湖城·圣殿广场', lat: 40.7705, lng: -111.8919, region: 'northamerica', difficulty: 3 },
    { name: '美国明尼阿波利斯·市中心', lat: 44.9778, lng: -93.265, region: 'northamerica', difficulty: 3 },
    { name: '美国堪萨斯城·喷泉广场', lat: 39.0997, lng: -94.5786, region: 'northamerica', difficulty: 4 },
    { name: '加拿大多伦多·加拿大国家电视塔', lat: 43.6426, lng: -79.3871, region: 'northamerica', difficulty: 1 },
    { name: '加拿大蒙特利尔·老港', lat: 45.5019, lng: -73.5533, region: 'northamerica', difficulty: 2 },
    { name: '加拿大渥太华·国会山', lat: 45.4235, lng: -75.701, region: 'northamerica', difficulty: 2 },
    { name: '加拿大卡尔加里·市中心', lat: 51.0447, lng: -114.0719, region: 'northamerica', difficulty: 3 },
    { name: '加拿大埃德蒙顿·市政厅广场', lat: 53.5444, lng: -113.4909, region: 'northamerica', difficulty: 3 },
    { name: '加拿大温尼伯·福克斯市场', lat: 49.8967, lng: -97.1314, region: 'northamerica', difficulty: 4 },
    { name: '加拿大维多利亚·内港', lat: 48.4284, lng: -123.3697, region: 'northamerica', difficulty: 2 },
    { name: '墨西哥瓜达拉哈拉·大教堂', lat: 20.6769, lng: -103.347, region: 'northamerica', difficulty: 3 },
    { name: '墨西哥蒙特雷·马可广场', lat: 25.669, lng: -100.3095, region: 'northamerica', difficulty: 4 },
    { name: '墨西哥坎昆·酒店区', lat: 21.1552, lng: -86.8244, region: 'northamerica', difficulty: 3 },
    { name: '墨西哥瓦哈卡·圣多明各广场', lat: 17.0654, lng: -96.7237, region: 'northamerica', difficulty: 4 },
    { name: '古巴哈瓦那·革命广场', lat: 23.1206, lng: -82.3872, region: 'northamerica', difficulty: 3 },
    { name: '巴拿马巴拿马城·旧城区', lat: 8.952, lng: -79.5354, region: 'northamerica', difficulty: 4 },
    { name: '哥斯达黎加圣何塞·中央公园', lat: 9.9333, lng: -84.0786, region: 'northamerica', difficulty: 4 },
    { name: '多米尼加圣多明各·殖民区', lat: 18.4736, lng: -69.8844, region: 'northamerica', difficulty: 4 },
    { name: '波多黎各圣胡安·老城', lat: 18.4655, lng: -66.1057, region: 'northamerica', difficulty: 3 },

    // ---- 南美洲 (South America) ----
    { name: '巴西圣保罗·保利斯塔大道', lat: -23.5614, lng: -46.6559, region: 'southamerica', difficulty: 1 },
    { name: '巴西萨尔瓦多·佩洛里尼奥', lat: -12.9728, lng: -38.51, region: 'southamerica', difficulty: 3 },
    { name: '巴西累西腓·老城', lat: -8.0629, lng: -34.8718, region: 'southamerica', difficulty: 4 },
    { name: '巴西福塔莱萨·海滩', lat: -3.7275, lng: -38.5025, region: 'southamerica', difficulty: 4 },
    { name: '巴西巴西利亚·三权广场', lat: -15.7939, lng: -47.8828, region: 'southamerica', difficulty: 2 },
    { name: '巴西伊瓜苏·伊瓜苏瀑布', lat: -25.6953, lng: -54.4367, region: 'southamerica', difficulty: 3 },
    { name: '阿根廷布宜诺斯艾利斯·博卡区', lat: -34.6355, lng: -58.3646, region: 'southamerica', difficulty: 2 },
    { name: '阿根廷科尔多瓦·圣马丁广场', lat: -31.4186, lng: -64.1837, region: 'southamerica', difficulty: 4 },
    { name: '阿根廷巴里洛切·市中心', lat: -41.1335, lng: -71.3103, region: 'southamerica', difficulty: 4 },
    { name: '阿根廷乌斯怀亚·世界尽头', lat: -54.8069, lng: -68.3071, region: 'southamerica', difficulty: 5 },
    { name: '智利圣地亚哥·武器广场', lat: -33.4372, lng: -70.6506, region: 'southamerica', difficulty: 2 },
    { name: '智利阿塔卡马·圣佩德罗', lat: -22.9089, lng: -68.1995, region: 'southamerica', difficulty: 5 },
    { name: '秘鲁利马·武器广场', lat: -12.0464, lng: -77.0428, region: 'southamerica', difficulty: 2 },
    { name: '秘鲁阿雷基帕·圣卡塔利娜修道院', lat: -16.3958, lng: -71.5369, region: 'southamerica', difficulty: 4 },
    { name: '哥伦比亚麦德林·博特罗广场', lat: 6.2452, lng: -75.5682, region: 'southamerica', difficulty: 3 },
    { name: '哥伦比亚卡塔赫纳·古城墙', lat: 10.4236, lng: -75.5505, region: 'southamerica', difficulty: 3 },
    { name: '乌拉圭蒙得维的亚·独立广场', lat: -34.9068, lng: -56.2, region: 'southamerica', difficulty: 3 },
    { name: '巴拉圭亚松森·帕尔马街', lat: -25.2812, lng: -57.635, region: 'southamerica', difficulty: 4 },
    { name: '玻利维亚拉巴斯·穆里略广场', lat: -16.4961, lng: -68.134, region: 'southamerica', difficulty: 4 },
    { name: '玻利维亚圣克鲁斯·市中心', lat: -17.7836, lng: -63.1823, region: 'southamerica', difficulty: 4 },
    { name: '厄瓜多尔瓜亚基尔·圣安娜山', lat: -2.195, lng: -79.886, region: 'southamerica', difficulty: 4 },
    { name: '委内瑞拉加拉加斯·解放者大道', lat: 10.4995, lng: -66.8846, region: 'southamerica', difficulty: 5 },

    // ---- 非洲 (Africa) ----
    { name: '摩洛哥马拉喀什·杰马广场', lat: 31.6258, lng: -7.9891, region: 'africa', difficulty: 2 },
    { name: '摩洛哥非斯·皮革染坊', lat: 34.0644, lng: -4.9744, region: 'africa', difficulty: 4 },
    { name: '摩洛哥丹吉尔·老城', lat: 35.7842, lng: -5.8111, region: 'africa', difficulty: 4 },
    { name: '埃及开罗·埃及博物馆', lat: 30.0478, lng: 31.2336, region: 'africa', difficulty: 2 },
    { name: '埃及卢克索·卡纳克神庙', lat: 25.7188, lng: 32.6573, region: 'africa', difficulty: 3 },
    { name: '埃及亚历山大·滨海大道', lat: 31.2058, lng: 29.8823, region: 'africa', difficulty: 3 },
    { name: '突尼斯突尼斯市·布尔吉巴大街', lat: 36.8006, lng: 10.1815, region: 'africa', difficulty: 4 },
    { name: '阿尔及利亚阿尔及尔·卡斯巴', lat: 36.7844, lng: 3.06, region: 'africa', difficulty: 5 },
    { name: '尼日利亚阿布贾·千年塔', lat: 9.062, lng: 7.4891, region: 'africa', difficulty: 5 },
    { name: '加纳阿克拉·独立广场', lat: 5.5474, lng: -0.1915, region: 'africa', difficulty: 4 },
    { name: '塞内加尔达喀尔·独立广场', lat: 14.6641, lng: -17.4363, region: 'africa', difficulty: 4 },
    { name: '科特迪瓦阿比让·圣保罗大教堂', lat: 5.3373, lng: -4.0183, region: 'africa', difficulty: 5 },
    { name: '埃塞俄比亚亚的斯亚贝巴·梅斯克尔广场', lat: 9.0117, lng: 38.7599, region: 'africa', difficulty: 4 },
    { name: '肯尼亚蒙巴萨·旧港', lat: -4.0647, lng: 39.6697, region: 'africa', difficulty: 4 },
    { name: '坦桑尼亚达累斯萨拉姆·独立广场', lat: -6.817, lng: 39.2819, region: 'africa', difficulty: 4 },
    { name: '坦桑尼亚桑给巴尔·石头城', lat: -6.1631, lng: 39.1899, region: 'africa', difficulty: 3 },
    { name: '乌干达坎帕拉·议会广场', lat: 0.3145, lng: 32.5854, region: 'africa', difficulty: 5 },
    { name: '卢旺达基加利·市中心', lat: -1.9441, lng: 30.0619, region: 'africa', difficulty: 5 },
    { name: '马达加斯加塔那那利佛·女王宫', lat: -18.9243, lng: 47.5321, region: 'africa', difficulty: 5 },
    { name: '博茨瓦纳哈博罗内·市中心', lat: -24.6541, lng: 25.9087, region: 'africa', difficulty: 5 },
    { name: '赞比亚利文斯通·维多利亚瀑布', lat: -17.9243, lng: 25.8572, region: 'africa', difficulty: 4 },
    { name: '津巴布韦哈拉雷·非洲团结广场', lat: -17.8292, lng: 31.0522, region: 'africa', difficulty: 5 },
    { name: '莫桑比克马普托·独立广场', lat: -25.9664, lng: 32.5718, region: 'africa', difficulty: 5 },
    { name: '安哥拉罗安达·滨海大道', lat: -8.8137, lng: 13.2354, region: 'africa', difficulty: 5 },
    { name: '南非约翰内斯堡·宪法山', lat: -26.189, lng: 28.045, region: 'africa', difficulty: 3 },
    { name: '南非比勒陀利亚·联合大厦', lat: -25.7406, lng: 28.211, region: 'africa', difficulty: 3 },
    { name: '南非开普敦·桌山缆车站', lat: -33.9534, lng: 18.4023, region: 'africa', difficulty: 3 },

    // ---- 大洋洲 (Oceania) ----
    { name: '澳大利亚悉尼·邦迪海滩', lat: -33.8908, lng: 151.2743, region: 'oceania', difficulty: 2 },
    { name: '澳大利亚墨尔本·弗林德斯街车站', lat: -37.8183, lng: 144.9671, region: 'oceania', difficulty: 2 },
    { name: '澳大利亚布里斯班·南岸公园', lat: -27.4772, lng: 153.0233, region: 'oceania', difficulty: 3 },
    { name: '澳大利亚珀斯·国王公园', lat: -31.959, lng: 115.8368, region: 'oceania', difficulty: 3 },
    { name: '澳大利亚堪培拉·国会大厦', lat: -35.3086, lng: 149.1249, region: 'oceania', difficulty: 3 },
    { name: '澳大利亚霍巴特·萨拉曼卡广场', lat: -42.8848, lng: 147.3337, region: 'oceania', difficulty: 4 },
    { name: '澳大利亚黄金海岸·冲浪者天堂', lat: -28.0017, lng: 153.431, region: 'oceania', difficulty: 3 },
    { name: '澳大利亚阿德莱德·维多利亚广场', lat: -34.9287, lng: 138.6008, region: 'oceania', difficulty: 3 },
    { name: '新西兰奥克兰·天空塔', lat: -36.8485, lng: 174.762, region: 'oceania', difficulty: 2 },
    { name: '新西兰惠灵顿·蜂巢大厦', lat: -41.2785, lng: 174.7767, region: 'oceania', difficulty: 3 },
    { name: '新西兰基督城·大教堂广场', lat: -43.5316, lng: 172.6366, region: 'oceania', difficulty: 3 },
    { name: '新西兰罗托鲁瓦·政府花园', lat: -38.138, lng: 176.2508, region: 'oceania', difficulty: 4 },
    { name: '新西兰尼尔森·市中心', lat: -41.2706, lng: 173.284, region: 'oceania', difficulty: 5 },
    { name: '斐济苏瓦·阿尔伯特公园', lat: -18.1494, lng: 178.4245, region: 'oceania', difficulty: 4 },
    { name: '斐济楠迪·镇中心', lat: -17.7554, lng: 177.4455, region: 'oceania', difficulty: 4 },
    { name: '巴布亚新几内亚莫尔兹比港·市中心', lat: -9.4438, lng: 147.1803, region: 'oceania', difficulty: 5 },
    { name: '新喀里多尼亚努美阿·海滨大道', lat: -22.2758, lng: 166.458, region: 'oceania', difficulty: 5 },
    { name: '塔希提帕皮提·海滨', lat: -17.535, lng: -149.5695, region: 'oceania', difficulty: 5 },
    { name: '萨摩亚阿皮亚·海滨大道', lat: -13.8314, lng: -171.7666, region: 'oceania', difficulty: 5 },
];

// ==========================================================
// 读取现有 LOCATIONS 避免重名
// ==========================================================
function parseLocations() {
    const src = fs.readFileSync(GAME, 'utf8');
    const marker = 'const LOCATIONS =';
    const start = src.indexOf(marker);
    const open = src.indexOf('[', start);
    let depth = 0,
        inStr = false,
        quote = '',
        esc = false,
        end = -1;
    for (let i = open; i < src.length; i++) {
        const c = src[i];
        if (esc) {
            esc = false;
            continue;
        }
        if (c === '\\') {
            esc = true;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            if (!inStr) {
                inStr = true;
                quote = c;
            } else if (quote === c) {
                inStr = false;
                quote = '';
            }
            continue;
        }
        if (inStr) continue;
        if (c === '[') depth++;
        else if (c === ']') {
            depth--;
            if (depth === 0) {
                end = i;
                break;
            }
        }
    }
    return eval(src.slice(open, end + 1));
}

// ==========================================================
// Mapillary API (curl)
// ==========================================================
function mapillaryRequest(url) {
    try {
        const out = execSync(`curl -s --max-time 12 "${url}"`, {
            encoding: 'utf8',
            timeout: 15000,
            stdio: ['pipe', 'pipe', 'ignore'],
        });
        if (out && out.trim().startsWith('{')) return JSON.parse(out.trim());
    } catch (e) {}
    return null;
}

async function checkCoverage(lat, lng) {
    const offsets = [0.006, 0.012];
    for (const offset of offsets) {
        const bbox = `${lng - offset},${lat - offset},${lng + offset},${lat + offset}`;
        const url = `https://graph.mapillary.com/images?access_token=${TOKEN}&fields=id,geometry,is_pano&bbox=${bbox}&limit=5`;
        const data = mapillaryRequest(url);
        if (data && data.data && data.data.length > 0) {
            const panos = data.data.filter((i) => i.is_pano);
            const img = (panos.length ? panos : data.data)[0];
            const [ilng, ilat] = img.geometry.coordinates;
            return { valid: true, imageId: img.id, lat: ilat, lng: ilng };
        }
    }
    return { valid: false };
}

async function withConcurrency(items, fn, limit = 6) {
    const results = [];
    for (let i = 0; i < items.length; i += limit) {
        const batch = items.slice(i, i + limit);
        results.push(...(await Promise.all(batch.map(fn))));
    }
    return results;
}

// ==========================================================
// 主流程
// ==========================================================
async function main() {
    const existing = parseLocations();
    const existingNames = new Set(existing.map((l) => l.name));
    console.log('现有 LOCATIONS 总数:', existing.length);

    // 过滤重名候选
    const candidates = CANDIDATES.filter((c) => !existingNames.has(c.name));
    console.log('候选点位(过滤重名后):', candidates.length, '(共', CANDIDATES.length, ')');

    console.log('开始逐点验证 Mapillary 覆盖...\n');
    const valid = [];
    const invalid = [];
    let done = 0;
    const total = candidates.length;

    const results = await withConcurrency(candidates, async (c) => {
        done++;
        const r = await checkCoverage(c.lat, c.lng);
        process.stdout.write(`\r  [${done}/${total}] ${c.name.padEnd(22)} ${r.valid ? '✅' : '❌'}   `);
        return { cand: c, result: r };
    });
    process.stdout.write('\n\n');

    for (const { cand, result } of results) {
        if (result.valid)
            valid.push({ ...cand, imageId: result.imageId, actualLat: result.lat, actualLng: result.lng });
        else invalid.push(cand);
    }

    console.log(`验证完成: 有效 ${valid.length} / 无效 ${invalid.length}`);
    console.log(
        `按大洲统计: ${JSON.stringify(
            valid.reduce((a, c) => {
                a[c.region] = (a[c.region] || 0) + 1;
                return a;
            }, {})
        )}`
    );

    fs.writeFileSync(
        path.join(ROOT, 'tools', '.world-expand-report.json'),
        JSON.stringify({ valid, invalid }, null, 2),
        'utf8'
    );
    console.log('📄 报告已保存至 tools/.world-expand-report.json');
}

main().catch((e) => {
    console.error('错误:', e.message);
    process.exit(1);
});
