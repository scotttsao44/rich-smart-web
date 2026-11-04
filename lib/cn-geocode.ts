// 地址 → GCJ-02 坐标（免 key：360 地图 restapi.map.so.com/newapi，返回 GCJ-02）。
// 只给后台／店主自报的地址做初步定位，结果一律标 approximate，由后台确认后改为 precise。
export type GeocodeHit = { lat: number; lng: number; name: string; address: string; district: string; city: string };

export async function geocodeCn(address: string, city = ''): Promise<GeocodeHit | null> {
  const keyword = String(address || '').trim().slice(0, 80);
  if (keyword.length < 4) return null;
  const cityname = String(city || '').trim() || (keyword.match(/(?:省)?([\u4e00-\u9fa5]{2,4}?)市/)?.[1] || '');
  const url = new URL('https://restapi.map.so.com/newapi');
  url.searchParams.set('keyword', keyword);
  if (cityname) url.searchParams.set('cityname', cityname);
  url.searchParams.set('batch', '1');
  url.searchParams.set('number', '5');
  url.searchParams.set('sid', '1000');
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    const data = await res.json().catch(() => ({}));
    const pois: Array<Record<string, unknown>> = Array.isArray(data.poi) ? data.poi : [];
    const hit = pois.find((p) => !cityname || String(p.city || '').includes(cityname)) || null;
    if (!hit) return null;
    const lat = Number(hit.y);
    const lng = Number(hit.x);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 3 || lat > 54 || lng < 73 || lng > 136) return null;
    return { lat, lng, name: String(hit.name || ''), address: String(hit.address || ''), district: String(hit.area || ''), city: String(hit.city || '') };
  } catch {
    return null;
  }
}
