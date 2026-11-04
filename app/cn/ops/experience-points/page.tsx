'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, MapPin, RefreshCw } from 'lucide-react';

type Point = {
  id: string; city: string; district: string; name: string; address: string; lat: number | null; lng: number | null;
  geoStatus: 'precise' | 'approximate' | 'missing'; phone: string; phoneIsStore: boolean; hours: string; businessModel: string;
  visible: boolean; photos: string[]; geoNote: string; source: string; base: boolean;
};
type Photo = { id: string; status: string; source: string; at: string; url: string };
type Profile = {
  id: string; kind: 'owner' | 'agent'; memberId: number | null; memberName: string; openid: string | null; storeName: string; city: string; address: string;
  district: string; lat: number | null; lng: number | null; geoHint: string; businessModel: string; hours: string; photos: Photo[]; company: string; coverage: string;
  declaredReferrer: string; status: string; source: string; flags: string[]; pointId: string | null; reviewNote: string; updatedAt: string; submittedAt: string | null;
};
type Draft = { kefuLabel: string; city: string; district: string; publicAddress: string; lat: string; lng: string; geoStatus: string; publicPhone: string; hours: string; businessModel: string; visible: boolean; geoNote: string };

const GEO: Record<string, string> = { precise: '精准', approximate: '大致', missing: '缺地址' };
const GEO_TONE: Record<string, string> = { precise: 'bg-emerald-100 text-emerald-800', approximate: 'bg-amber-100 text-amber-800', missing: 'bg-red-100 text-red-700' };
const PSTATUS: Record<string, string> = { collecting: '填写中', submitted: '待审核', approved: '已通过', rejected: '已退回' };
const t = (v?: string | null) => (v ? new Date(v).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—');

function toDraft(p: Point): Draft {
  return {
    kefuLabel: p.name, city: p.city, district: p.district, publicAddress: p.address, lat: p.lat === null ? '' : String(p.lat), lng: p.lng === null ? '' : String(p.lng),
    geoStatus: p.geoStatus, publicPhone: p.phoneIsStore ? p.phone : '', hours: p.hours, businessModel: p.businessModel, visible: p.visible, geoNote: p.geoNote,
  };
}

export default function OpsExperiencePointsPage() {
  const [points, setPoints] = useState<Point[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<Record<string, { pointId: string; photoIds: string[]; note: string }>>({});

  const apply = (d: { points?: Point[]; profiles?: Profile[] }) => { if (d.points) setPoints(d.points); if (d.profiles) setProfiles(d.profiles); };
  const load = useCallback(async () => {
    const res = await fetch('/api/cn/ops/experience-points', { cache: 'no-store' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(d.error || '读取失败'); return; }
    apply(d);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true); setMsg('');
    try {
      const res = await fetch('/api/cn/ops/experience-points', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d.error || '操作失败'); return null; }
      apply(d);
      return d;
    } finally { setBusy(false); }
  };

  const save = async (id: string) => {
    if (!draft) return;
    const d = await post({ action: 'update', id, patch: draft });
    if (d) { setEditing(null); setMsg('已保存'); }
  };
  const geocode = async () => {
    if (!draft) return;
    const d = await post({ action: 'geocode', address: draft.publicAddress, city: draft.city });
    if (d?.hit) { setDraft({ ...draft, lat: String(d.hit.lat), lng: String(d.hit.lng), geoStatus: 'approximate' }); setMsg(`地图匹配：${d.hit.name}（${d.hit.address}）——请点「地图核对」确认位置，门牌准确再改为「精准」`); }
    else if (d) setMsg('地图没有找到这个地址，请手动填坐标（GCJ-02，可在高德地图上取点）');
  };
  const removePhoto = async (p: Point, url: string) => {
    const refs = p.photos.filter((u) => u !== url).map((u) => { const q = new URL(u, 'https://x').searchParams; return `${q.get('p')}/${q.get('f')}`; });
    await post({ action: 'update', id: p.id, patch: { photos: refs } });
  };

  const cities = Array.from(new Set(points.map((p) => p.city)));

  return (
    <main className="min-h-screen bg-[#f5f6f2] px-4 py-6 text-stone-950">
      <div className="mx-auto max-w-5xl">
        <Link href="/cn/ops" className="inline-flex items-center gap-1 text-sm font-bold text-stone-600"><ArrowLeft className="h-4 w-4" />返回运营台</Link>
        <div className="mt-3 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-black">体验点地址与导航</h1>
          <button type="button" onClick={() => void load()} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-stone-300 bg-white"><RefreshCw className="h-4 w-4" /></button>
        </div>
        <p className="mt-1 text-sm text-stone-500">公开页面 <a className="font-bold text-teal-800 underline" href="/cn/experience-points" target="_blank" rel="noreferrer">/cn/experience-points</a> 与服务号「6」只显示「显示」且有地址的体验点。坐标用 GCJ-02（高德／腾讯／微信同一套）。电话只填门店公开电话，不填个人手机；留空则显示客服电话。</p>
        {msg ? <p className="mt-3 rounded-md bg-white px-3 py-2 text-sm font-bold text-teal-800">{msg}</p> : null}

        {cities.map((city) => (
          <section key={city} className="mt-6">
            <h2 className="text-lg font-black">{city}</h2>
            <div className="mt-2 space-y-3">
              {points.filter((p) => p.city === city).map((p) => (
                <div key={p.id} className="rounded-lg border border-stone-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-black">{p.name}</span>
                        <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${GEO_TONE[p.geoStatus]}`}>{GEO[p.geoStatus]}</span>
                        <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${p.visible ? 'bg-teal-100 text-teal-800' : 'bg-stone-200 text-stone-600'}`}>{p.visible ? '显示' : '隐藏'}</span>
                        {!p.base ? <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs font-bold text-sky-800">店主自报通过</span> : null}
                      </div>
                      <p className="mt-1 text-sm text-stone-700">{p.address || '（没有地址）'}</p>
                      <p className="text-xs text-stone-500">{p.district} · {p.lat !== null ? `${p.lat}, ${p.lng}` : '无坐标'} · {p.phone}{p.phoneIsStore ? '' : '（客服）'}{p.hours ? ` · ${p.hours}` : ''}{p.businessModel ? ` · ${p.businessModel}` : ''}</p>
                      {p.geoNote ? <p className="mt-1 text-xs text-amber-800">{p.geoNote}</p> : null}
                    </div>
                    <div className="flex gap-2">
                      {p.lat !== null ? <a className="inline-flex items-center gap-1 rounded-md border border-stone-300 px-3 py-1.5 text-sm font-bold" target="_blank" rel="noreferrer" href={`https://uri.amap.com/marker?position=${p.lng},${p.lat}&name=${encodeURIComponent(p.name)}&coordinate=gaode`}><MapPin className="h-4 w-4" />地图核对</a> : null}
                      <button type="button" onClick={() => { setEditing(p.id); setDraft(toDraft(p)); }} className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-bold text-white">编辑</button>
                    </div>
                  </div>
                  {p.photos.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {p.photos.map((u) => (
                        <div key={u} className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={u} alt="" className="h-20 w-20 rounded object-cover" />
                          <button type="button" disabled={busy} onClick={() => void removePhoto(p, u)} className="absolute right-0 top-0 rounded bg-black/60 px-1 text-xs text-white">撤下</button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {editing === p.id && draft ? (
                    <div className="mt-3 grid gap-2 border-t border-stone-200 pt-3 text-sm sm:grid-cols-2">
                      {([['kefuLabel', '对外名称'], ['city', '城市'], ['district', '区／县'], ['publicPhone', '门店公开电话（可空）'], ['hours', '营业时间'], ['businessModel', '经营类型']] as const).map(([k, label]) => (
                        <label key={k} className="grid gap-1"><span className="text-xs font-bold text-stone-500">{label}</span>
                          <input value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} className="rounded border border-stone-300 px-2 py-1.5" /></label>
                      ))}
                      <label className="grid gap-1 sm:col-span-2"><span className="text-xs font-bold text-stone-500">完整地址（省市区＋街道门牌＋楼层房号）</span>
                        <input value={draft.publicAddress} onChange={(e) => setDraft({ ...draft, publicAddress: e.target.value })} className="rounded border border-stone-300 px-2 py-1.5" /></label>
                      <label className="grid gap-1"><span className="text-xs font-bold text-stone-500">纬度 lat（GCJ-02）</span><input value={draft.lat} onChange={(e) => setDraft({ ...draft, lat: e.target.value })} className="rounded border border-stone-300 px-2 py-1.5" /></label>
                      <label className="grid gap-1"><span className="text-xs font-bold text-stone-500">经度 lng（GCJ-02）</span><input value={draft.lng} onChange={(e) => setDraft({ ...draft, lng: e.target.value })} className="rounded border border-stone-300 px-2 py-1.5" /></label>
                      <label className="grid gap-1"><span className="text-xs font-bold text-stone-500">定位状态</span>
                        <select value={draft.geoStatus} onChange={(e) => setDraft({ ...draft, geoStatus: e.target.value })} className="rounded border border-stone-300 px-2 py-1.5">
                          <option value="precise">精准（门牌／楼宇已核对）</option><option value="approximate">大致（街道／同名点，待确认）</option><option value="missing">缺地址</option>
                        </select></label>
                      <label className="flex items-center gap-2 pt-5"><input type="checkbox" checked={draft.visible} onChange={(e) => setDraft({ ...draft, visible: e.target.checked })} />在页面与服务号显示</label>
                      <label className="grid gap-1 sm:col-span-2"><span className="text-xs font-bold text-stone-500">备注（只后台可见）</span>
                        <input value={draft.geoNote} onChange={(e) => setDraft({ ...draft, geoNote: e.target.value })} className="rounded border border-stone-300 px-2 py-1.5" /></label>
                      <div className="flex flex-wrap gap-2 sm:col-span-2">
                        <button type="button" disabled={busy} onClick={() => void geocode()} className="rounded-md border border-teal-700 px-3 py-1.5 font-bold text-teal-800">按地址查坐标</button>
                        {draft.lat && draft.lng ? <a target="_blank" rel="noreferrer" className="rounded-md border border-stone-300 px-3 py-1.5 font-bold" href={`https://uri.amap.com/marker?position=${draft.lng},${draft.lat}&name=${encodeURIComponent(draft.kefuLabel)}&coordinate=gaode`}>地图核对</a> : null}
                        <button type="button" disabled={busy} onClick={() => void save(p.id)} className="rounded-md bg-teal-700 px-4 py-1.5 font-bold text-white">保存</button>
                        <button type="button" onClick={() => setEditing(null)} className="rounded-md border border-stone-300 px-3 py-1.5 font-bold">取消</button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ))}

        <section className="mt-10">
          <h2 className="text-lg font-black">店主／代理自填资料</h2>
          <p className="text-sm text-stone-500">来自服务号对话（回复 2／7 后逐题填写）与会员页 /cn/member/store-profile。全部为自报，通过后才更新体验点；推荐归属与分润不会因此改变，比对结果见「需核对」。</p>
          <div className="mt-3 space-y-3">
            {profiles.length === 0 ? <p className="text-sm text-stone-500">暂无</p> : null}
            {profiles.map((p) => {
              const r = review[p.id] || { pointId: p.pointId || '', photoIds: p.photos.filter((x) => x.status === 'ok').map((x) => x.id), note: '' };
              const setR = (patch: Partial<typeof r>) => setReview({ ...review, [p.id]: { ...r, ...patch } });
              return (
                <div key={p.id} className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-black">{p.kind === 'owner' ? '店主' : '代理'} · {p.storeName || p.company || '（未填名称）'}</span>
                    <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs font-bold">{PSTATUS[p.status] || p.status}</span>
                    <span className="text-xs text-stone-500">{p.memberName || `未绑定会员 ${p.openid || ''}`} · {p.source === 'kefu' ? '服务号对话' : '会员网页'} · {t(p.submittedAt || p.updatedAt)}</span>
                  </div>
                  <div className="mt-2 grid gap-1 text-stone-700 sm:grid-cols-2">
                    <div>城市：{p.city || '—'}</div>
                    {p.kind === 'owner' ? <>
                      <div className="sm:col-span-2">地址：{p.address || '—'}{p.lat !== null ? `（${p.lat}, ${p.lng}）` : ''}</div>
                      {p.geoHint ? <div className="text-xs text-stone-500 sm:col-span-2">{p.geoHint}</div> : null}
                      <div>经营类型：{p.businessModel || '—'}</div>
                      <div>营业时间：{p.hours || '—'}</div>
                    </> : <>
                      <div>公司／称呼：{p.company || '—'}</div>
                      <div className="sm:col-span-2">覆盖区域：{p.coverage || '—'}</div>
                    </>}
                    {p.declaredReferrer ? <div>自填推荐人：{p.declaredReferrer}</div> : null}
                  </div>
                  {p.flags.length ? <ul className="mt-2 list-disc rounded bg-amber-50 py-2 pl-6 pr-2 text-xs text-amber-900">{p.flags.map((f) => <li key={f}>需核对：{f}</li>)}</ul> : null}
                  {p.photos.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {p.photos.map((ph) => (
                        <label key={ph.id} className="grid w-24 gap-1 text-xs">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {ph.url ? <img src={ph.url} alt="" className="h-24 w-24 rounded object-cover" /> : <div className="flex h-24 w-24 items-center justify-center rounded bg-stone-100 text-stone-500">{ph.status === 'failed' ? '下载失败' : '下载中'}</div>}
                          {p.status === 'submitted' && ph.status === 'ok' ? <span className="flex items-center gap-1"><input type="checkbox" checked={r.photoIds.includes(ph.id)} onChange={(e) => setR({ photoIds: e.target.checked ? [...r.photoIds, ph.id] : r.photoIds.filter((x) => x !== ph.id) })} />公开</span> : null}
                        </label>
                      ))}
                    </div>
                  ) : null}
                  {p.status === 'submitted' ? (
                    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-stone-200 pt-3">
                      {p.kind === 'owner' ? (
                        <label className="grid gap-1"><span className="text-xs font-bold text-stone-500">通过后写入</span>
                          <select value={r.pointId} onChange={(e) => setR({ pointId: e.target.value })} className="rounded border border-stone-300 px-2 py-1.5">
                            <option value="">新建体验点</option>
                            {points.map((pt) => <option key={pt.id} value={pt.id}>{pt.city} · {pt.name}</option>)}
                          </select></label>
                      ) : null}
                      <input placeholder="备注（可空）" value={r.note} onChange={(e) => setR({ note: e.target.value })} className="rounded border border-stone-300 px-2 py-1.5" />
                      <button type="button" disabled={busy} onClick={() => void post({ action: 'review', profileId: p.id, decision: 'approve', pointId: r.pointId, photoIds: r.photoIds, note: r.note })} className="rounded-md bg-teal-700 px-3 py-1.5 font-bold text-white">通过</button>
                      <button type="button" disabled={busy} onClick={() => void post({ action: 'review', profileId: p.id, decision: 'reject', note: r.note })} className="rounded-md border border-stone-300 px-3 py-1.5 font-bold">退回</button>
                    </div>
                  ) : p.reviewNote ? <p className="mt-2 text-xs text-stone-500">审核备注：{p.reviewNote}</p> : null}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
