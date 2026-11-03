import type { ReactNode } from 'react';
import {
  ClipboardCheck,
  FileText,
  Handshake,
  MonitorSmartphone,
  Phone,
  PlayCircle,
  ShieldCheck,
  Store,
  Ticket,
  Wrench,
} from 'lucide-react';
import AfuStoreApplyQrModal from '@/components/AfuStoreApplyQrModal';
import { afuIntroCopy as t } from '@/lib/afu-intro-copy';
import { KEFU_DOCS, KEFU_PHONE, KEFU_SAFETY_ROWS, KEFU_TIERS } from '@/lib/wechat-kefu-knowledge';

// 阿富同学门店合作介绍页（公开免登录）。主 CTA 进 /cn/member/store-application（未登录由 middleware 带 returnTo 与 ref 去登录）。
const PHOTO_FRONT = '/images/afu/afu-device-front.jpg';
const PHOTO_ANGLE = '/images/afu/afu-device-angle.jpg';

function Section({ id, icon, title, children }: { id: string; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 rounded-lg border border-stone-200 bg-white p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-xl font-black text-stone-950"><span className="text-teal-700">{icon}</span>{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Steps({ items }: { items: readonly (readonly [string, string])[] }) {
  return (
    <ol className="space-y-3">
      {items.map(([title, body], index) => (
        <li key={title} className="flex gap-3 rounded-lg bg-stone-50 px-4 py-3">
          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-teal-50 text-xs font-black text-teal-800">{index + 1}</span>
          <div>
            <div className="font-black text-stone-950">{title}</div>
            <p className="mt-1 text-sm font-semibold leading-6 text-stone-600">{body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function AfuIntroPage({ refCode = '' }: { refCode?: string }) {
  const applyHref = `/cn/member/store-application${refCode ? `?ref=${encodeURIComponent(refCode)}` : ''}`;
  const primaryBtn = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-teal-700 px-5 py-3 font-black text-white shadow-sm';
  const secondaryBtn = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-5 py-3 font-black text-stone-800';
  const docs = [KEFU_DOCS.usage, KEFU_DOCS.insurance, KEFU_DOCS.emc, KEFU_DOCS.wavelength];

  return (
    <main className="min-h-screen bg-stone-50 pb-28 text-stone-950 sm:pb-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-4 sm:px-6 lg:py-8">
        <nav className="flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-white px-3 py-1 text-xs font-black text-teal-800">
            <Store className="h-4 w-4" />
            {t.eyebrow}
          </div>
          <a href={`tel:${KEFU_PHONE}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-black text-stone-700">
            <Phone className="h-4 w-4" />
            {KEFU_PHONE}
          </a>
        </nav>

        <section className="grid items-center gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="py-2">
            <h1 className="text-4xl font-black leading-tight text-stone-950 sm:text-5xl lg:text-6xl">{t.title}</h1>
            <p className="mt-4 max-w-2xl text-lg font-semibold leading-8 text-stone-700">{t.tagline}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {t.heroPoints.map((point) => (
                <span key={point} className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-sm font-black text-teal-800">{point}</span>
              ))}
            </div>
            <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap">
              <a href={applyHref} className={primaryBtn}><ClipboardCheck className="h-5 w-5" />{t.ctaApply}</a>
              <AfuStoreApplyQrModal label={t.ctaQr} phone={KEFU_PHONE} className={secondaryBtn} />
            </div>
            <p className="mt-4 text-xs font-semibold text-stone-500">{t.notIp}</p>
          </div>
          <figure className="relative overflow-hidden rounded-lg border border-stone-200 bg-stone-950 shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={PHOTO_FRONT} alt="阿富同学设备正面" className="aspect-[4/5] max-h-[72svh] w-full object-cover" />
            <figcaption className="absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1 text-xs font-black text-stone-900">{t.photoLabel}</figcaption>
          </figure>
        </section>

        <Section id="device" icon={<MonitorSmartphone className="h-5 w-5" />} title={t.deviceTitle}>
          <p className="text-base font-black text-stone-800">{t.deviceLead}</p>
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_0.8fr]">
            <div className="grid gap-3 sm:grid-cols-2">
              {t.deviceCards.map(([title, body]) => (
                <article key={title} className="rounded-lg border border-stone-200 bg-stone-50 p-4">
                  <h3 className="font-black text-stone-950">{title}</h3>
                  <p className="mt-1 text-sm font-semibold leading-6 text-stone-600">{body}</p>
                </article>
              ))}
            </div>
            <div className="grid gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={PHOTO_ANGLE} alt="阿富同学设备侧面" loading="lazy" className="aspect-[3/4] w-full rounded-lg border border-stone-200 object-cover" />
              <div className="relative overflow-hidden rounded-lg border border-stone-200 bg-stone-950">
                <video className="aspect-video w-full object-cover" src="/device-showcase.mp4" poster={PHOTO_FRONT} controls playsInline preload="none" aria-label={t.videoLabel} />
                <div className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs font-black text-stone-900">
                  <PlayCircle className="h-4 w-4" />{t.videoLabel}
                </div>
              </div>
            </div>
          </div>
        </Section>

        <Section id="model" icon={<Handshake className="h-5 w-5" />} title={t.modelTitle}>
          <div className="grid gap-3 md:grid-cols-3">
            {t.modelCards.map(([title, body]) => (
              <article key={title} className="rounded-lg border border-stone-200 bg-stone-50 p-4">
                <h3 className="font-black text-stone-950">{title}</h3>
                <p className="mt-1 text-sm font-semibold leading-6 text-stone-600">{body}</p>
              </article>
            ))}
          </div>
          <p className="mt-3 text-sm font-semibold leading-6 text-stone-500">{t.modelNote}</p>
        </Section>

        <Section id="tiers" icon={<Ticket className="h-5 w-5" />} title={t.tierTitle}>
          <p className="text-sm font-semibold leading-6 text-stone-600">{t.tierLead}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {KEFU_TIERS.map((tier) => (
              <article key={tier.id} className="rounded-lg border-2 border-teal-100 bg-white p-5">
                <div className="text-sm font-black text-teal-700">{tier.id} 档</div>
                <div className="mt-2 text-3xl font-black tabular-nums text-stone-950">¥{tier.amountYuan.toLocaleString('en-US')}</div>
                <div className="mt-1 text-xl font-black tabular-nums text-stone-800">{tier.uses}<span className="ml-1 text-sm">{t.tierUnit}</span></div>
                <div className="mt-3 text-sm font-bold text-stone-500">{t.tierValidity}</div>
              </article>
            ))}
          </div>
          <p className="mt-3 text-sm font-semibold leading-6 text-stone-500">{t.tierFoot}</p>
        </Section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Section id="run" icon={<Store className="h-5 w-5" />} title={t.runTitle}>
            <p className="mb-4 text-base font-black text-stone-800">{t.runLead}</p>
            <Steps items={t.runSteps} />
          </Section>
          <Section id="flow" icon={<ClipboardCheck className="h-5 w-5" />} title={t.flowTitle}>
            <Steps items={t.flowSteps} />
          </Section>
        </section>

        <Section id="install" icon={<Wrench className="h-5 w-5" />} title={t.installTitle}>
          <Steps items={t.installSteps} />
        </Section>

        <Section id="safety" icon={<ShieldCheck className="h-5 w-5" />} title={t.safetyTitle}>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <p className="text-sm font-black text-stone-700">{t.safetyLead}</p>
              <ul className="mt-2 space-y-2 text-sm font-semibold leading-6 text-stone-600">
                {KEFU_SAFETY_ROWS.map((row) => <li key={row} className="rounded-lg bg-stone-50 px-3 py-2">{row}</li>)}
              </ul>
            </div>
            <div>
              <p className="text-sm font-black text-stone-700">{t.unsuitableTitle}：</p>
              <ul className="mt-2 space-y-2 text-sm font-semibold leading-6 text-stone-600">
                {t.unsuitableRows.map((row) => <li key={row} className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">{row}</li>)}
              </ul>
              <p className="mt-3 text-sm font-semibold leading-6 text-stone-600">{t.safetyUnlisted}</p>
              <a href={KEFU_DOCS.usage.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-black text-teal-800">
                <FileText className="h-4 w-4" />{t.safetyDoc}
              </a>
            </div>
          </div>
        </Section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Section id="apply" icon={<ClipboardCheck className="h-5 w-5" />} title={t.applyTitle}>
            <ol className="space-y-3">
              {t.applySteps.map((row, index) => (
                <li key={row} className="flex gap-3 text-sm font-semibold leading-6 text-stone-700">
                  <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-teal-50 text-xs font-black text-teal-800">{index + 1}</span>
                  <span>{row}</span>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-sm font-semibold text-stone-500">{t.applyNote}</p>
            <div className="mt-4 grid gap-3 sm:flex sm:flex-wrap">
              <a href={applyHref} className={primaryBtn}><ClipboardCheck className="h-5 w-5" />{t.ctaApply}</a>
              <AfuStoreApplyQrModal label={t.ctaQr} phone={KEFU_PHONE} className={secondaryBtn} />
            </div>
          </Section>
          <Section id="contact" icon={<Phone className="h-5 w-5" />} title={t.contactTitle}>
            <p className="text-sm font-semibold leading-6 text-stone-600">{t.contactLead}</p>
            <div className="mt-4 rounded-lg bg-stone-50 p-4 text-sm font-bold leading-7 text-stone-700">
              <div>{t.wechatLabel}：<span className="text-stone-950">{t.wechatName}</span></div>
              <div>{t.phoneLabel}：<a href={`tel:${KEFU_PHONE}`} className="text-teal-700">{KEFU_PHONE}</a></div>
            </div>
            <h3 className="mt-5 text-sm font-black text-stone-700">{t.docsTitle}</h3>
            <ul className="mt-2 space-y-2">
              {docs.map((doc) => (
                <li key={doc.url}>
                  <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-bold text-teal-700 underline-offset-4 hover:underline">
                    <FileText className="h-4 w-4 shrink-0" />{doc.title}
                  </a>
                </li>
              ))}
            </ul>
          </Section>
        </section>

        <footer className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm font-bold leading-6 text-amber-900">{t.disclaimer}</footer>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur sm:hidden">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <a href={applyHref} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-3 text-base font-black text-white"><ClipboardCheck className="h-5 w-5" />{t.ctaApply}</a>
          <AfuStoreApplyQrModal label="扫码" phone={KEFU_PHONE} className="inline-flex min-h-12 items-center justify-center gap-1 rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-black text-stone-800" />
        </div>
      </div>
    </main>
  );
}
