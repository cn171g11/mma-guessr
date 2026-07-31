#!/usr/bin/env node
'use strict';
/**
 * v1.13.0 — 世界街景扩充·第二轮
 * 补充高命中率区域候选，使用真正异步并发（exec promisify）大幅提速
 */
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const execP = promisify(exec);

const ROOT = path.resolve(__dirname, '..');
const GAME = path.join(ROOT, 'MmaGuessr.html');
const TOKEN = 'MLY|27847157814868912|297a1717444edeb373bb94009d2df54a';

const CANDIDATES = [
  // ---- 非洲（第一轮命中率 85%，重点补充）----
  { name: '南非开普敦·维多利亚港', lat: -33.9059, lng: 18.4204, region: 'africa', difficulty: 2 },
  { name: '南非德班·黄金里程海滨', lat: -29.8570, lng: 31.0230, region: 'africa', difficulty: 3 },
  { name: '埃及赫尔格达·海滨大道', lat: 27.2579, lng: 33.8116, region: 'africa', difficulty: 3 },
  { name: '埃及沙姆沙伊赫·纳马湾', lat: 27.9093, lng: 34.3304, region: 'africa', difficulty: 3 },
  { name: '摩洛哥卡萨布兰卡·穆罕默德五世广场', lat: 33.5928, lng: -7.6194, region: 'africa', difficulty: 2 },
  { name: '突尼斯苏塞·老城', lat: 35.8267, lng: 10.6394, region: 'africa', difficulty: 4 },
  { name: '肯尼亚内罗毕·城市市场', lat: -1.2837, lng: 36.8238, region: 'africa', difficulty: 3 },
  { name: '尼日利亚拉各斯·莱基区', lat: 6.4478, lng: 3.4723, region: 'africa', difficulty: 4 },
  { name: '加纳库马西·市中心', lat: 6.6935, lng: -1.6210, region: 'africa', difficulty: 4 },
  { name: '塞内加尔圣路易斯·老城', lat: 16.0277, lng: -16.4984, region: 'africa', difficulty: 4 },
  { name: '埃塞俄比亚亚的斯亚贝巴·圣三一大教堂', lat: 9.0308, lng: 38.7677, region: 'africa', difficulty: 3 },
  { name: '坦桑尼亚阿鲁沙·市中心', lat: -3.3696, lng: 36.6934, region: 'africa', difficulty: 4 },
  { name: '乌干达金贾·尼罗河源头', lat: 0.4479, lng: 33.2039, region: 'africa', difficulty: 4 },
  { name: '卢旺达基加利·基加利会议中心', lat: -1.9507, lng: 30.0927, region: 'africa', difficulty: 4 },
  { name: '博茨瓦纳马翁·市中心', lat: -19.9984, lng: 23.4181, region: 'africa', difficulty: 5 },
  { name: '赞比亚卢萨卡·独立大道', lat: -15.3875, lng: 28.3228, region: 'africa', difficulty: 4 },
  { name: '马拉维利隆圭·市中心', lat: -13.9626, lng: 33.7741, region: 'africa', difficulty: 5 },
  { name: '纳米比亚温得和克·独立大道', lat: -22.5609, lng: 17.0836, region: 'africa', difficulty: 4 },
  { name: '刚果金金沙萨·解放大道', lat: -4.3256, lng: 15.2890, region: 'africa', difficulty: 5 },
  { name: '苏丹喀土穆·尼罗河街', lat: 15.5930, lng: 32.5322, region: 'africa', difficulty: 5 },
  { name: '吉布提吉布提市·独立广场', lat: 11.5886, lng: 43.1450, region: 'africa', difficulty: 5 },
  { name: '塞舌尔维多利亚·钟楼', lat: -4.6202, lng: 55.4517, region: 'africa', difficulty: 4 },
  { name: '毛里求斯路易港·中央市场', lat: -20.1640, lng: 57.5040, region: 'africa', difficulty: 4 },
  { name: '阿尔及利亚奥兰·市中心', lat: 35.6969, lng: -0.6330, region: 'africa', difficulty: 5 },

  // ---- 大洋洲（第一轮命中率 68%）----
  { name: '澳大利亚凯恩斯·夜市', lat: -16.9217, lng: 145.7741, region: 'oceania', difficulty: 4 },
  { name: '澳大利亚达尔文·史密斯街', lat: -12.4650, lng: 130.8400, region: 'oceania', difficulty: 4 },
  { name: '澳大利亚阳光海岸·马卢奇河', lat: -26.6568, lng: 153.0928, region: 'oceania', difficulty: 4 },
  { name: '澳大利亚纽卡斯尔·海滨', lat: -32.9270, lng: 151.7780, region: 'oceania', difficulty: 3 },
  { name: '澳大利亚卧龙岗·市中心', lat: -34.4278, lng: 150.8930, region: 'oceania', difficulty: 4 },
  { name: '澳大利亚汤斯维尔·海滨', lat: -19.2569, lng: 146.8178, region: 'oceania', difficulty: 4 },
  { name: '新西兰汉密尔顿·市中心', lat: -37.7870, lng: 175.2790, region: 'oceania', difficulty: 4 },
  { name: '新西兰陶朗加·海滨', lat: -37.6825, lng: 176.1668, region: 'oceania', difficulty: 4 },
  { name: '新西兰内皮尔·装饰艺术街', lat: -39.4903, lng: 176.9180, region: 'oceania', difficulty: 4 },
  { name: '斐济劳托卡·码头', lat: -17.6080, lng: 177.4510, region: 'oceania', difficulty: 4 },
  { name: '瓦努阿图维拉港·海滨', lat: -17.7333, lng: 168.3219, region: 'oceania', difficulty: 5 },
  { name: '帕劳科罗尔·市中心', lat: 7.3415, lng: 134.4781, region: 'oceania', difficulty: 5 },

  // ---- 欧洲（选南欧/中欧高命中国家）----
  { name: '西班牙塞维利亚·都市阳伞', lat: 37.3925, lng: -5.9889, region: 'europe', difficulty: 2 },
  { name: '西班牙科尔多瓦·清真寺大教堂', lat: 37.8792, lng: -4.7794, region: 'europe', difficulty: 2 },
  { name: '西班牙托莱多·古城', lat: 39.8581, lng: -4.0246, region: 'europe', difficulty: 3 },
  { name: '葡萄牙波尔图·圣本托车站', lat: 41.1458, lng: -8.6100, region: 'europe', difficulty: 2 },
  { name: '葡萄牙里斯本·阿尔法玛区', lat: 38.7107, lng: -9.1310, region: 'europe', difficulty: 2 },
  { name: '意大利巴勒莫·四角广场', lat: 38.1157, lng: 13.3615, region: 'europe', difficulty: 3 },
  { name: '意大利卡塔尼亚·大象喷泉', lat: 37.5022, lng: 15.0872, region: 'europe', difficulty: 3 },
  { name: '意大利比萨·奇迹广场', lat: 43.7230, lng: 10.3966, region: 'europe', difficulty: 2 },
  { name: '意大利热那亚·老港', lat: 44.4084, lng: 8.9280, region: 'europe', difficulty: 3 },
  { name: '希腊雅典·蒙纳斯提拉奇', lat: 37.9762, lng: 23.7259, region: 'europe', difficulty: 2 },
  { name: '希腊伊拉克利翁·威尼斯港', lat: 35.3407, lng: 25.1360, region: 'europe', difficulty: 4 },
  { name: '克罗地亚扎达尔·海风琴', lat: 44.1150, lng: 15.2250, region: 'europe', difficulty: 3 },
  { name: '克罗地亚萨格勒布·耶拉契奇广场', lat: 45.8131, lng: 15.9775, region: 'europe', difficulty: 3 },
  { name: '黑山科托尔·老城', lat: 42.4247, lng: 18.7714, region: 'europe', difficulty: 4 },
  { name: '斯洛文尼亚皮兰·塔蒂尼广场', lat: 45.5292, lng: 13.5674, region: 'europe', difficulty: 4 },
  { name: '塞尔维亚贝尔格莱德·卡莱梅格丹', lat: 44.8230, lng: 20.4500, region: 'europe', difficulty: 3 },
  { name: '北马其顿斯科普里·马其顿广场', lat: 41.9960, lng: 21.4316, region: 'europe', difficulty: 4 },
  { name: '阿尔巴尼亚地拉那·斯坎德培广场', lat: 41.3275, lng: 19.8189, region: 'europe', difficulty: 4 },
  { name: '马耳他瓦莱塔·圣约翰广场', lat: 35.8984, lng: 14.5128, region: 'europe', difficulty: 3 },
  { name: '塞浦路斯尼科西亚·老城', lat: 35.1714, lng: 33.3640, region: 'europe', difficulty: 4 },
  { name: '法国阿维尼翁·教皇宫', lat: 43.9507, lng: 4.8076, region: 'europe', difficulty: 3 },
  { name: '法国里昂·白莱果广场', lat: 45.7642, lng: 4.8355, region: 'europe', difficulty: 2 },
  { name: '德国汉堡·圣米迦勒教堂', lat: 53.5480, lng: 9.9780, region: 'europe', difficulty: 2 },
  { name: '德国慕尼黑·王宫', lat: 48.1400, lng: 11.5790, region: 'europe', difficulty: 2 },
  { name: '荷兰乌得勒支·老运河', lat: 52.0907, lng: 5.1214, region: 'europe', difficulty: 3 },
  { name: '比利时根特·圣巴沃广场', lat: 51.0530, lng: 3.7240, region: 'europe', difficulty: 3 },
  { name: '英国布里斯托尔·克利夫顿吊桥', lat: 51.4551, lng: -2.6275, region: 'europe', difficulty: 3 },
  { name: '英国牛津·拉德克利夫图书馆', lat: 51.7548, lng: -1.2544, region: 'europe', difficulty: 2 },
  { name: '爱尔兰科克·英国市场', lat: 51.8985, lng: -8.4760, region: 'europe', difficulty: 3 },
  { name: '苏格兰格拉斯哥·乔治广场', lat: 55.8612, lng: -4.2490, region: 'europe', difficulty: 3 },
  { name: '波兰华沙·科学文化宫', lat: 52.2319, lng: 21.0059, region: 'europe', difficulty: 2 },
  { name: '匈牙利布达佩斯·英雄广场', lat: 47.5140, lng: 19.0770, region: 'europe', difficulty: 2 },

  // ---- 亚洲（韩国/印度/中东/中亚高命中）----
  { name: '韩国大邱·东城路', lat: 35.8706, lng: 128.5970, region: 'asia', difficulty: 3 },
  { name: '韩国光州·市中心', lat: 35.1595, lng: 126.8520, region: 'asia', difficulty: 3 },
  { name: '韩国全州·韩屋村', lat: 35.8143, lng: 127.1530, region: 'asia', difficulty: 3 },
  { name: '韩国仁川·中国城', lat: 37.4744, lng: 126.6190, region: 'asia', difficulty: 3 },
  { name: '韩国水原·华城行宫', lat: 37.2870, lng: 127.0110, region: 'asia', difficulty: 3 },
  { name: '印度德里·红堡', lat: 28.6562, lng: 77.2410, region: 'asia', difficulty: 2 },
  { name: '印度金奈·玛丽娜海滩', lat: 13.0524, lng: 80.2830, region: 'asia', difficulty: 3 },
  { name: '印度加尔各答·维多利亚纪念馆', lat: 22.5448, lng: 88.3426, region: 'asia', difficulty: 3 },
  { name: '印度普纳·市中心', lat: 18.5204, lng: 73.8567, region: 'asia', difficulty: 4 },
  { name: '印度海得拉巴·查尔米纳尔', lat: 17.3616, lng: 78.4747, region: 'asia', difficulty: 3 },
  { name: '印度科钦·中国渔网', lat: 9.9658, lng: 76.2423, region: 'asia', difficulty: 3 },
  { name: '斯里兰卡加勒·荷兰堡', lat: 6.0269, lng: 80.2170, region: 'asia', difficulty: 3 },
  { name: '尼泊尔博卡拉·费瓦湖', lat: 28.2096, lng: 83.9490, region: 'asia', difficulty: 3 },
  { name: '不丹廷布·扎西却宗', lat: 27.4894, lng: 89.6350, region: 'asia', difficulty: 5 },
  { name: '阿曼马斯喀特·苏丹卡布斯大清真寺', lat: 23.5890, lng: 58.3880, region: 'asia', difficulty: 4 },
  { name: '科威特科威特城·海滨', lat: 29.3759, lng: 47.9774, region: 'asia', difficulty: 4 },
  { name: '巴林麦纳麦·巴林堡', lat: 26.2336, lng: 50.5200, region: 'asia', difficulty: 4 },
  { name: '伊拉克埃尔比勒·城堡', lat: 36.1916, lng: 44.0092, region: 'asia', difficulty: 5 },
  { name: '巴基斯坦拉合尔·巴德夏希清真寺', lat: 31.5882, lng: 74.3094, region: 'asia', difficulty: 4 },
  { name: '塔吉克斯坦杜尚别·鲁达基公园', lat: 38.5737, lng: 68.7739, region: 'asia', difficulty: 5 },
  { name: '吉尔吉斯斯坦比什凯克·阿拉套广场', lat: 42.8777, lng: 74.6050, region: 'asia', difficulty: 5 },
  { name: '土库曼斯坦阿什哈巴德·独立广场', lat: 37.9258, lng: 58.3750, region: 'asia', difficulty: 5 },
  { name: '马尔代夫马累·人工沙滩', lat: 4.1755, lng: 73.5093, region: 'asia', difficulty: 3 },
  { name: '文莱斯里巴加湾·水上村', lat: 4.8833, lng: 114.9360, region: 'asia', difficulty: 4 },
  { name: '东帝汶帝力·滨海大道', lat: -8.5569, lng: 125.5783, region: 'asia', difficulty: 5 },

  // ---- 北美洲（加拿大/加勒比）----
  { name: '加拿大哈利法克斯·城堡山', lat: 44.6470, lng: -63.5780, region: 'northamerica', difficulty: 3 },
  { name: '加拿大里贾纳·议会大厦', lat: 50.4343, lng: -104.6150, region: 'northamerica', difficulty: 4 },
  { name: '加拿大萨斯卡通·市中心', lat: 52.1332, lng: -106.6700, region: 'northamerica', difficulty: 4 },
  { name: '加拿大温哥华·罗布森街', lat: 49.2830, lng: -123.1200, region: 'northamerica', difficulty: 2 },
  { name: '加拿大魁北克·小尚普兰街', lat: 46.8125, lng: -71.2030, region: 'northamerica', difficulty: 3 },
  { name: '美国檀香山·威基基海滩', lat: 21.2800, lng: -157.8330, region: 'northamerica', difficulty: 2 },
  { name: '美国西雅图·先锋广场', lat: 47.6010, lng: -122.3320, region: 'northamerica', difficulty: 3 },
  { name: '美国萨克拉门托·老城', lat: 38.5816, lng: -121.4940, region: 'northamerica', difficulty: 3 },
  { name: '美国圣安东尼奥·河滨步道', lat: 29.4252, lng: -98.4940, region: 'northamerica', difficulty: 3 },
  { name: '美国查尔斯顿·历史街区', lat: 32.7765, lng: -79.9310, region: 'northamerica', difficulty: 3 },
  { name: '美国安克雷奇·市中心', lat: 61.2181, lng: -149.9000, region: 'northamerica', difficulty: 4 },
  { name: '美国朱诺·市中心', lat: 58.3019, lng: -134.4190, region: 'northamerica', difficulty: 5 },
  { name: '美国博伊西·市中心', lat: 43.6150, lng: -116.2020, region: 'northamerica', difficulty: 4 },
  { name: '危地马拉安提瓜·中央公园', lat: 14.5570, lng: -90.7330, region: 'northamerica', difficulty: 4 },
  { name: '洪都拉斯特古西加尔巴·莫拉桑广场', lat: 14.1048, lng: -87.2040, region: 'northamerica', difficulty: 5 },
  { name: '尼加拉瓜格拉纳达·中央公园', lat: 11.9297, lng: -85.9540, region: 'northamerica', difficulty: 5 },
  { name: '萨尔瓦多圣萨尔瓦多·市中心', lat: 13.6929, lng: -89.2182, region: 'northamerica', difficulty: 5 },

  // ---- 南美洲 ----
  { name: '巴西阿雷格里港·红房子广场', lat: -30.0346, lng: -51.2290, region: 'southamerica', difficulty: 3 },
  { name: '巴西贝洛奥里藏特·自由广场', lat: -19.9320, lng: -43.9380, region: 'southamerica', difficulty: 3 },
  { name: '巴西戈亚尼亚·市中心', lat: -16.6869, lng: -49.2648, region: 'southamerica', difficulty: 4 },
  { name: '巴西纳塔尔·海滨灯塔', lat: -5.7619, lng: -35.1970, region: 'southamerica', difficulty: 4 },
  { name: '巴西若昂佩索阿·市中心', lat: -7.1195, lng: -34.8450, region: 'southamerica', difficulty: 4 },
  { name: '阿根廷罗萨里奥·国旗纪念碑', lat: -32.9442, lng: -60.6500, region: 'southamerica', difficulty: 3 },
  { name: '阿根廷萨尔塔·圣马丁广场', lat: -24.7884, lng: -65.4100, region: 'southamerica', difficulty: 4 },
  { name: '智利安托法加斯塔·市中心', lat: -23.6509, lng: -70.3970, region: 'southamerica', difficulty: 4 },
  { name: '智利蒙特港·武器广场', lat: -41.4716, lng: -72.9360, region: 'southamerica', difficulty: 4 },
  { name: '秘鲁特鲁希略·武器广场', lat: -8.1117, lng: -79.0288, region: 'southamerica', difficulty: 4 },
  { name: '厄瓜多尔基多·赤道纪念碑', lat: -0.0082, lng: -78.4560, region: 'southamerica', difficulty: 3 },
  { name: '哥伦比亚波哥大·蒙塞拉特山', lat: 4.6059, lng: -74.0560, region: 'southamerica', difficulty: 3 },
  { name: '哥伦比亚佩雷拉·市中心', lat: 4.8133, lng: -75.6960, region: 'southamerica', difficulty: 4 },
  { name: '苏里南帕拉马里博·独立广场', lat: 5.8260, lng: -55.2040, region: 'southamerica', difficulty: 5 },
  { name: '圭亚那乔治敦·圣乔治大教堂', lat: 6.8183, lng: -58.1530, region: 'southamerica', difficulty: 5 }
];

function parseLocations() {
  const src = fs.readFileSync(GAME, 'utf8');
  const marker = 'const LOCATIONS =';
  const start = src.indexOf(marker);
  const open = src.indexOf('[', start);
  let depth = 0, inStr = false, quote = '', esc = false, end = -1;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"' || c === "'" || c === '`') {
      if (!inStr) { inStr = true; quote = c; }
      else if (quote === c) { inStr = false; quote = ''; }
      continue;
    }
    if (inStr) continue;
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  return eval(src.slice(open, end + 1));
}

async function checkCoverage(lat, lng) {
  const offsets = [0.006, 0.012];
  for (const offset of offsets) {
    const bbox = `${lng - offset},${lat - offset},${lng + offset},${lat + offset}`;
    const url = `https://graph.mapillary.com/images?access_token=${TOKEN}&fields=id,geometry,is_pano&bbox=${bbox}&limit=5`;
    try {
      const { stdout } = await execP(`curl -s --max-time 10 "${url}"`, { timeout: 12000 });
      if (stdout && stdout.trim().startsWith('{')) {
        const data = JSON.parse(stdout.trim());
        if (data.data && data.data.length > 0) {
          const panos = data.data.filter(i => i.is_pano);
          const img = (panos.length ? panos : data.data)[0];
          const [ilng, ilat] = img.geometry.coordinates;
          return { valid: true, imageId: img.id, lat: ilat, lng: ilng };
        }
      }
    } catch (e) { /* 继续 */ }
  }
  return { valid: false };
}

async function main() {
  const existing = parseLocations();
  const existingNames = new Set(existing.map(l => l.name));
  const candidates = CANDIDATES.filter(c => !existingNames.has(c.name));
  console.log('第二轮候选(过滤重名后):', candidates.length);

  const LIMIT = 8;
  const results = new Array(candidates.length);
  let done = 0;
  const total = candidates.length;

  async function worker() {
    for (;;) {
      const idx = done++;
      if (idx >= total) break;
      const c = candidates[idx];
      const r = await checkCoverage(c.lat, c.lng);
      results[idx] = { cand: c, result: r };
      process.stdout.write(`\r  [${idx + 1}/${total}] ${c.name.padEnd(24)} ${r.valid ? '✅' : '❌'}   `);
    }
  }
  await Promise.all(Array.from({ length: LIMIT }, worker));
  process.stdout.write('\n\n');

  const valid = results.filter(r => r.result.valid).map(r => ({ ...r.cand, imageId: r.result.imageId, actualLat: r.result.lat, actualLng: r.result.lng }));
  const invalid = results.filter(r => !r.result.valid).map(r => r.cand);

  console.log(`验证完成: 有效 ${valid.length} / 无效 ${invalid.length}`);
  console.log(`按大洲: ${JSON.stringify(valid.reduce((a, c) => { a[c.region] = (a[c.region]||0)+1; return a; }, {}))}`);

  fs.writeFileSync(path.join(ROOT, 'tools', '.world-expand-report2.json'), JSON.stringify({ valid, invalid }, null, 2), 'utf8');
  console.log('📄 报告已保存至 tools/.world-expand-report2.json');
}

main().catch(e => { console.error('错误:', e.message); process.exit(1); });
