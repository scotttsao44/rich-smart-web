// 服务号「6 体验点」与发送位置时的回复：只列 visible 且有地址（精准／大致）的体验点，附地图导航页（不带推荐码）。
import { KEFU_PUBLIC_PHONE } from './cn-experience-points';
import { listExperiencePointViews, listPublicExperiencePoints, type ExperiencePointView } from './local-cn-experience-points';
import { EXPERIENCE_POINTS_URL } from './wechat-kefu-store-profile';

function distanceKm(a: [number, number], b: [number, number]) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const line = (p: ExperiencePointView, km?: number | null) => `· ${p.name}${km !== undefined && km !== null ? `（约 ${km < 10 ? km.toFixed(1) : Math.round(km)} 公里）` : ''}：${p.address}${p.phoneIsStore ? `，电话 ${p.phone}` : ''}`;
const matchCity = (p: ExperiencePointView, city: string) => Boolean(city) && (p.city === city || city.includes(p.city) || p.city.includes(city));

// 其他有体验点但地址未公开的城市（只说城市）
function otherCities(exclude: string[]) {
  const pub = new Set(listPublicExperiencePoints().map((p) => p.city));
  const cities = Array.from(new Set(listExperiencePointViews().filter((p) => !pub.has(p.city) && !exclude.includes(p.city)).map((p) => (p.city === '南京' ? '南京（高淳）' : p.city))));
  return cities.length ? `${cities.join('、')}也有合作体验点，地址整理中。` : '';
}

export function kefuPointsReply(city = '') {
  const pts = listPublicExperiencePoints().sort((a, b) => a.city.localeCompare(b.city, 'zh'));
  const hit = pts.filter((p) => matchCity(p, city));
  const tail = `地图导航：${EXPERIENCE_POINTS_URL}\n预约电话 ${KEFU_PUBLIC_PHONE}；想预约到店体验请回复 1。`;
  if (hit.length) return `${hit[0].city}的合作体验点：\n${hit.slice(0, 4).map((p) => line(p)).join('\n')}\n${tail}`;
  const head = city ? `${city}暂时还没有公开地址的体验点${listExperiencePointViews().some((p) => matchCity(p, city)) ? '（地址整理中）' : ''}。目前可以导航的体验点：` : '目前可以导航的合作体验点：';
  const list = pts.slice(0, 5).map((p) => `${line(p).replace('· ', `· ${p.city} `)}`).join('\n');
  return `${head}\n${list}\n${otherCities([])}${city ? '' : '回复您所在城市，帮您找最近的。\n'}${tail}`.replace(/\n{2,}/g, '\n');
}

// 只给城市名一行（用于留电话流程前的提示）
export function kefuPointsLine(city = '') {
  const pts = listPublicExperiencePoints().filter((p) => matchCity(p, city));
  if (pts.length) return `${pts[0].city}可以体验的合作门店：${pts.slice(0, 3).map((p) => `${p.name}（${p.address}）`).join('、')}。地图导航：${EXPERIENCE_POINTS_URL}`;
  return '';
}

// 客人发送位置（微信位置消息为 GCJ-02）：按距离列最近 3 个
export function kefuNearestReply(lat: number, lng: number, label: string) {
  const pts = listPublicExperiencePoints().filter((p) => p.lat !== null && p.lng !== null);
  if (!pts.length || !Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  const rows = pts.map((p) => ({ p, km: distanceKm([lat, lng], [p.lat as number, p.lng as number]) })).sort((a, b) => a.km - b.km).slice(0, 3);
  return `收到您的位置${label ? `（${label.slice(0, 30)}）` : ''}。离您最近的合作体验点：\n${rows.map((r) => line(r.p, r.km).replace('· ', `· ${r.p.city} `)).join('\n')}\n地图导航：${EXPERIENCE_POINTS_URL}\n想预约到店体验请回复 1，或留言手机号由客服安排。`;
}
