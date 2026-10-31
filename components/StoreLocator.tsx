'use client';

import { useMemo, useState } from 'react';
import { LocateFixed, MapPin, Search } from 'lucide-react';
import { buildMapUrl, type StoreLocation } from '@/lib/public-site-data';

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const radius = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return radius * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

type NearestStore = StoreLocation & { distanceKm: number };

export default function StoreLocator({ stores }: { stores: StoreLocation[] }) {
  const [query, setQuery] = useState('');
  const [nearest, setNearest] = useState<NearestStore[]>([]);
  const [hint, setHint] = useState('可输入城市、行政区或门店名称，也可使用定位找最近网点。');
  const [locating, setLocating] = useState(false);

  const filteredStores = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return stores;
    return stores.filter((store) =>
      [store.name, store.country, store.city, store.district, store.address, store.description]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    );
  }, [query, stores]);

  const locate = () => {
    if (!navigator.geolocation) {
      setHint('此浏览器不支持定位，请改用城市或门店关键词搜索。');
      return;
    }

    setLocating(true);
    setHint('正在取得定位...');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const results = stores
          .map((store) => ({
            ...store,
            distanceKm: distanceKm(latitude, longitude, store.latitude, store.longitude),
          }))
          .sort((a, b) => a.distanceKm - b.distanceKm)
          .slice(0, 3);
        setNearest(results);
        setHint(`已找到最近 ${results.length} 个服务网点。`);
        setLocating(false);
      },
      () => {
        setNearest([]);
        setHint('定位未授权或取得失败，请改用搜索。');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  };

  const visibleStores = nearest.length > 0 ? nearest : filteredStores;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="relative flex-1">
            <Search className="absolute left-3 top-3 h-5 w-5 text-slate-400" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setNearest([]);
              }}
              className="w-full rounded-2xl border border-slate-200 py-3 pl-10 pr-4 outline-none focus:border-cyan-500"
              placeholder="输入城市、行政区、门店名称"
            />
          </label>
          <button
            type="button"
            onClick={locate}
            disabled={locating}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 font-semibold text-white disabled:opacity-60"
          >
            <LocateFixed size={18} />
            {locating ? '定位中' : '定位最近网点'}
          </button>
        </div>
        <p className="mt-3 text-sm text-slate-500">{hint}</p>

        <div className="mt-5 grid gap-3">
          {visibleStores.map((store) => (
            <article key={store.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold text-cyan-700">
                    {store.country} / {store.city} / {store.district}
                  </p>
                  <h3 className="mt-1 text-lg font-bold text-slate-950">{store.name}</h3>
                  <p className="mt-1 text-sm text-slate-600">{store.address}</p>
                  <p className="mt-1 text-sm text-slate-500">{store.description}</p>
                  {'distanceKm' in store && (
                    <p className="mt-2 text-sm font-semibold text-emerald-700">
                      距离约 {(store as NearestStore).distanceKm.toFixed(1)} km
                    </p>
                  )}
                </div>
                <a
                  href={buildMapUrl(store)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center justify-center gap-1 rounded-full border border-cyan-200 bg-white px-4 py-2 text-sm font-semibold text-cyan-700"
                >
                  <MapPin size={16} />
                  地图导航
                </a>
              </div>
            </article>
          ))}
        </div>
      </div>

      <aside className="rounded-3xl border border-cyan-100 bg-cyan-50 p-5">
        <h3 className="text-xl font-bold text-slate-950">线下服务网点</h3>
      </aside>
    </div>
  );
}
