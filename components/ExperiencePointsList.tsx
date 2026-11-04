'use client';

import { useEffect, useMemo, useState } from 'react';
import { LocateFixed, MapPin, Navigation, Phone } from 'lucide-react';

export type PublicPoint = {
  id: string;
  city: string;
  district: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  geoStatus: 'precise' | 'approximate' | 'missing';
  phone: string;
  phoneIsStore: boolean;
  hours: string;
  businessModel: string;
  photos: string[];
};

type WxApi = {
  config: (cfg: Record<string, unknown>) => void;
  ready: (fn: () => void) => void;
  error: (fn: (err: unknown) => void) => void;
  openLocation: (opts: Record<string, unknown>) => void;
  getLocation: (opts: { type: string; success: (r: { latitude: number; longitude: number }) => void; fail?: () => void; cancel?: () => void }) => void;
};

const isWechat = () => typeof navigator !== 'undefined' && /micromessenger/i.test(navigator.userAgent);

function loadJweixin(): Promise<WxApi | null> {
  const w = window as unknown as { wx?: WxApi };
  if (w.wx) return Promise.resolve(w.wx);
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js';
    script.async = true;
    script.onload = () => resolve(w.wx || null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
}

// WGS-84（浏览器定位）→ GCJ-02（国内地图）
function outOfChina(lat: number, lng: number) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}
function tLat(x: number, y: number) {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  r += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return r;
}
function tLng(x: number, y: number) {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  r += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  r += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return r;
}
export function wgsToGcj(lat: number, lng: number): [number, number] {
  if (outOfChina(lat, lng)) return [lat, lng];
  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  let dLat = tLat(lng - 105, lat - 35);
  let dLng = tLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sq = Math.sqrt(magic);
  dLat = (dLat * 180) / (((a * (1 - ee)) / (magic * sq)) * Math.PI);
  dLng = (dLng * 180) / ((a / sq) * Math.cos(radLat) * Math.PI);
  return [lat + dLat, lng + dLng];
}
function distanceKm(a: [number, number], b: [number, number]) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const fmtKm = (km: number) => (km < 1 ? `${Math.round(km * 1000)} 米` : `${km < 10 ? km.toFixed(1) : Math.round(km)} 公里`);

function amapUrl(p: PublicPoint) {
  if (p.lat !== null && p.lng !== null) {
    return `https://uri.amap.com/marker?position=${p.lng},${p.lat}&name=${encodeURIComponent(p.name)}&src=rich-smart&coordinate=gaode&callnative=1`;
  }
  return `https://uri.amap.com/search?keyword=${encodeURIComponent(p.address)}&src=rich-smart&callnative=1`;
}

export default function ExperiencePointsList({ points }: { points: PublicPoint[] }) {
  const [wx, setWx] = useState<WxApi | null>(null);
  const [me, setMe] = useState<[number, number] | null>(null);
  const [locMsg, setLocMsg] = useState('');

  useEffect(() => {
    if (!isWechat()) return;
    let cancelled = false;
    (async () => {
      try {
        const pageUrl = window.location.href.split('#')[0];
        const res = await fetch(`/api/wechat/jssdk-config?url=${encodeURIComponent(pageUrl)}`, { cache: 'no-store' });
        const cfg = await res.json().catch(() => null);
        if (!cfg?.ok || cancelled) return;
        const api = await loadJweixin();
        if (!api || cancelled) return;
        api.config({ debug: false, appId: cfg.appId, timestamp: cfg.timestamp, nonceStr: cfg.nonceStr, signature: cfg.signature, jsApiList: ['openLocation', 'getLocation'] });
        api.ready(() => { if (!cancelled) setWx(api); });
        api.error(() => { /* 签名失败：导航改用高德网页 */ });
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const locate = () => {
    setLocMsg('正在获取位置…');
    if (wx) {
      wx.getLocation({
        type: 'gcj02',
        success: (r) => { setMe([Number(r.latitude), Number(r.longitude)]); setLocMsg(''); },
        fail: () => setLocMsg('未能获取位置，请在微信中允许定位后重试'),
        cancel: () => setLocMsg('已取消定位'),
      });
      return;
    }
    if (!navigator.geolocation) { setLocMsg('当前浏览器不支持定位'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { setMe(wgsToGcj(pos.coords.latitude, pos.coords.longitude)); setLocMsg(''); },
      () => setLocMsg('未能获取位置，请允许定位后重试'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  };

  const navigate = (p: PublicPoint) => {
    if (wx && p.lat !== null && p.lng !== null) {
      wx.openLocation({ latitude: p.lat, longitude: p.lng, name: p.name, address: p.address, scale: 16, infoUrl: '' });
      return;
    }
    window.location.href = amapUrl(p);
  };

  const groups = useMemo(() => {
    const withDist = points.map((p) => ({ p, km: me && p.lat !== null && p.lng !== null ? distanceKm(me, [p.lat, p.lng]) : null }));
    if (me) {
      withDist.sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9));
      return [{ city: '离您最近', items: withDist }];
    }
    const map = new Map<string, typeof withDist>();
    for (const row of withDist) map.set(row.p.city, [...(map.get(row.p.city) || []), row]);
    return Array.from(map.entries()).map(([city, items]) => ({ city, items }));
  }, [points, me]);

  return (
    <div>
      <button type="button" onClick={locate} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-600 bg-white px-4 py-2.5 text-sm font-bold text-emerald-700">
        <LocateFixed className="h-4 w-4" /> {me ? '已按距离排序（重新定位）' : '按离我最近排序'}
      </button>
      {locMsg ? <p className="mt-2 text-center text-xs text-stone-500">{locMsg}</p> : null}

      {groups.map((g) => (
        <section key={g.city} className="mt-6">
          <h2 className="text-base font-black text-stone-800">{g.city}</h2>
          <div className="mt-2 space-y-3">
            {g.items.map(({ p, km }) => (
              <article key={p.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-[15px] font-black text-stone-900">{p.name}</h3>
                    <p className="mt-0.5 text-xs text-stone-500">{[me ? p.city : '', p.district, p.businessModel].filter(Boolean).join(' · ')}{km !== null ? ` · 约 ${fmtKm(km)}` : ''}</p>
                  </div>
                  <button type="button" onClick={() => navigate(p)} className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-emerald-600 px-3.5 py-2 text-sm font-bold text-white">
                    <Navigation className="h-4 w-4" /> 导航
                  </button>
                </div>
                <p className="mt-2 flex items-start gap-1.5 text-sm text-stone-700"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />{p.address}</p>
                {p.geoStatus === 'approximate' ? <p className="ml-5 mt-0.5 text-[11px] text-amber-700">地图位置为附近参考点，到店前建议先电话确认</p> : null}
                {p.hours ? <p className="ml-5 mt-1 text-xs text-stone-500">营业时间：{p.hours}</p> : null}
                <a href={`tel:${p.phone}`} className="mt-2 inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700">
                  <Phone className="h-4 w-4" /> {p.phone}{p.phoneIsStore ? '' : '（客服预约）'}
                </a>
                {p.photos.length ? (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {p.photos.slice(0, 3).map((src) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={src} src={src} alt={`${p.name}现场照片`} className="aspect-square w-full rounded-lg object-cover" loading="lazy" />
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
