'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Handshake,
  HeartPulse,
  MessageCircle,
  PlayCircle,
  QrCode,
  ShieldCheck,
  ShoppingBag,
  Store,
  X,
} from 'lucide-react';
import { storeOperatingLoop, storeRevenueCards } from '@/lib/cn-mvp';

type Locale = 'zh-CN' | 'zh-TW';

const supportContact = {
  serviceName: '糙米健康服务',
  phone: '15862501498',
  wechatOfficialName: '糙米量子',
  wechatQr: '/wechat-official-qr.jpg',
};

const copy = {
  'zh-CN': {
    back: '返回会员中心',
    shop: '去健康商城',
    progress: '查看申请进度',
    eyebrow: '阿富同学门店申请导览',
    title: '阿富同学',
    subtitle: 'AI 语音操作的频率养生 / 健康体验设备，把到店体验、健康管理记录、商品推荐与门店服务流程串起来。',
    primary: '我想申请',
    videoLabel: '真实设备影片',
    introTitle: '先理解产品，再联系开通',
    intro:
      '阿富同学是门店使用的产品与设备，不是同名个人 IP。申请前建议先确认场地、接待人力与会员服务方式；后续由客服协助确认资格、合作条件、设备安排与建单。',
    fitTitle: '适合哪些门店 / 伙伴',
    canDoTitle: '门店实际能做什么',
    flowTitle: '服务流程',
    stepsTitle: '申请步骤',
    prepareTitle: '申请前需准备',
    noticeTitle: '非医疗与合作条件说明',
    contactTitle: '联系糙米健康服务',
    contactHint: '长按识别二维码，或拨打客服电话。客服会协助确认门店资格、费用、设备安排与后续建单。',
    close: '关闭',
    phone: '客服电话',
    wechat: '微信公众号',
    fit: ['养生体验馆、健康管理门店、社区服务点', '有稳定接待人员与线下服务时段的合作伙伴', '能持续跟进会员记录、复购与商品推荐的门店团队'],
    canDo: ['接待客人到店体验阿富同学设备', '协助会员建立健康管理记录与服务回访', '依系统资料做商品或服务包推荐', '查看申请进度、设备配置与门店相关结算记录'],
    steps: ['阅读本页并确认门店模式', '准备门店资料、负责人联系方式与服务规划', '通过微信公众号或电话联系糙米健康服务', '客服确认资格、合作条件与设备安排后协助建单', '平台审核后再进入设备配置、试营运与正式服务'],
    prepare: ['门店名称、地址与现场照片或简介', '负责人姓名、手机与微信联系方式', '可接待时段、服务人员与会员维护方式', '预计合作区域、客群来源与商品推荐场景'],
    notices: ['阿富同学相关资料仅用于健康管理与商品推荐参考，不作为诊断、治疗或疗效承诺。', '设备、合作费用、资格要求与服务区域以客服最终确认为准。', '一般会员不会直接填写内部申请表；客服会在确认资料后协助建立申请记录。'],
  },
  'zh-TW': {
    back: '返回會員中心',
    shop: '去健康商城',
    progress: '查看申請進度',
    eyebrow: '阿富同學門店申請導覽',
    title: '阿富同學',
    subtitle: 'AI 語音操作的頻率養生 / 健康體驗設備，把到店體驗、健康管理紀錄、商品推薦與門店服務流程串起來。',
    primary: '我想申請',
    videoLabel: '真實設備影片',
    introTitle: '先理解產品，再聯繫開通',
    intro:
      '阿富同學是門店使用的產品與設備，不是同名個人 IP。申請前建議先確認場地、接待人力與會員服務方式；後續由客服協助確認資格、合作條件、設備安排與建單。',
    fitTitle: '適合哪些門店 / 夥伴',
    canDoTitle: '門店實際能做什麼',
    flowTitle: '服務流程',
    stepsTitle: '申請步驟',
    prepareTitle: '申請前需準備',
    noticeTitle: '非醫療與合作條件說明',
    contactTitle: '聯繫糙米健康服務',
    contactHint: '長按識別 QR，或撥打客服電話。客服會協助確認門店資格、費用、設備安排與後續建單。',
    close: '關閉',
    phone: '客服電話',
    wechat: '微信公眾號',
    fit: ['養生體驗館、健康管理門店、社區服務點', '有穩定接待人員與線下服務時段的合作夥伴', '能持續跟進會員紀錄、複購與商品推薦的門店團隊'],
    canDo: ['接待客人到店體驗阿富同學設備', '協助會員建立健康管理紀錄與服務回訪', '依系統資料做商品或服務包推薦', '查看申請進度、設備配置與門店相關結算紀錄'],
    steps: ['閱讀本頁並確認門店模式', '準備門店資料、負責人聯絡方式與服務規劃', '透過微信公眾號或電話聯繫糙米健康服務', '客服確認資格、合作條件與設備安排後協助建單', '平台審核後再進入設備配置、試營運與正式服務'],
    prepare: ['門店名稱、地址與現場照片或簡介', '負責人姓名、手機與微信聯絡方式', '可接待時段、服務人員與會員維護方式', '預計合作區域、客群來源與商品推薦場景'],
    notices: ['阿富同學相關資料僅用於健康管理與商品推薦參考，不作為診斷、治療或療效承諾。', '設備、合作費用、資格要求與服務區域以客服最終確認為準。', '一般會員不會直接填寫內部申請表；客服會在確認資料後協助建立申請紀錄。'],
  },
} as const;

function toTraditional(value: string) {
  const pairs: Array<[string, string]> = [
    ['设备', '設備'], ['预付金', '預付金'], ['检测', '檢測'], ['资料', '資料'], ['登录', '登入'],
    ['状况', '狀況'], ['适合', '適合'], ['产品', '產品'], ['服务', '服務'], ['收益', '收益'],
    ['业务', '業務'], ['推广', '推廣'], ['链路', '鏈路'], ['结算', '結算'], ['跨城', '跨城'],
    ['培训', '培訓'], ['场地', '場地'], ['执行', '執行'], ['客户', '客戶'], ['关系', '關係'],
  ];
  return pairs.reduce((text, [from, to]) => text.replaceAll(from, to), value);
}

function LocalizedLoop({ locale }: { locale: Locale }) {
  const rows = useMemo(() => storeOperatingLoop.map((item) => ({
    title: locale === 'zh-TW' ? toTraditional(item.title) : item.title,
    description: locale === 'zh-TW' ? toTraditional(item.description) : item.description,
  })), [locale]);
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {rows.map((item, index) => (
        <article key={item.title} className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="text-xs font-black text-teal-700">{String(index + 1).padStart(2, '0')}</div>
          <h3 className="mt-2 font-black text-stone-950">{item.title}</h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-stone-600">{item.description}</p>
        </article>
      ))}
    </div>
  );
}

export default function StoreApplicationGuidePage({ locale }: { locale: Locale }) {
  const [contactOpen, setContactOpen] = useState(false);
  const [qrFailed, setQrFailed] = useState(false);
  const [videoState, setVideoState] = useState<'loading' | 'ready' | 'error'>('loading');
  const text = copy[locale];
  const isTraditional = locale === 'zh-TW';
  const memberHref = isTraditional ? '/portal' : '/cn/member';
  const shopHref = isTraditional ? '/portal/shop' : '/cn/shop';
  const progressHref = isTraditional ? '/portal' : '/cn/member#store-applications';
  const hasWechat = Boolean(supportContact.wechatOfficialName?.trim());
  const hasPhone = Boolean(supportContact.phone?.trim());
  const contactMissing = isTraditional ? '尚待核對，尚未提供聯絡資料。' : '尚待核对，尚未提供联系资料。';

  return (
    <main className="min-h-screen bg-stone-50 text-stone-950">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-4 sm:px-6 lg:py-8">
        <nav className="flex flex-wrap items-center justify-between gap-3">
          <Link href={memberHref} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-black text-stone-700">
            <ArrowLeft className="h-4 w-4" />
            {text.back}
          </Link>
          <div className="flex flex-wrap gap-2">
            <Link href={shopHref} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-black text-stone-700">
              <ShoppingBag className="h-4 w-4" />
              {text.shop}
            </Link>
            <Link href={progressHref} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-black text-teal-800">
              <ClipboardCheck className="h-4 w-4" />
              {text.progress}
            </Link>
          </div>
        </nav>

        <section className="grid min-h-[calc(100svh-118px)] items-center gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="py-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-white px-3 py-1 text-xs font-black text-teal-800">
              <Store className="h-4 w-4" />
              {text.eyebrow}
            </div>
            <h1 className="mt-5 text-4xl font-black leading-tight text-stone-950 sm:text-5xl lg:text-6xl">{text.title}</h1>
            <p className="mt-5 max-w-2xl text-lg font-semibold leading-8 text-stone-700">{text.subtitle}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" onClick={() => setContactOpen(true)} className="inline-flex min-h-12 items-center gap-2 rounded-lg bg-teal-700 px-5 py-3 font-black text-white shadow-sm">
                <MessageCircle className="h-5 w-5" />
                {text.primary}
              </button>
              <a href="#product-intro" className="inline-flex min-h-12 items-center gap-2 rounded-lg border border-stone-300 bg-white px-5 py-3 font-black text-stone-800">
                <ChevronRight className="h-5 w-5" />
                {text.introTitle}
              </a>
            </div>
          </div>
          <div className="relative overflow-hidden rounded-lg border border-stone-200 bg-stone-950 shadow-sm">
            <video className="aspect-[4/5] h-full max-h-[72svh] w-full object-cover sm:aspect-video lg:aspect-[4/5]" src="/device-showcase.mp4" controls playsInline preload="metadata" aria-label={text.videoLabel} onLoadedData={() => setVideoState('ready')} onCanPlay={() => setVideoState('ready')} onWaiting={() => setVideoState('loading')} onError={() => setVideoState('error')} />
            {videoState !== 'ready' ? <div role="status" className="absolute inset-x-0 top-14 bg-stone-950/85 px-4 py-3 text-center text-sm font-semibold text-white">{videoState === 'error' ? (isTraditional ? '影片暫時無法載入，仍可閱讀產品介紹與申請步驟。' : '影片暂时无法载入，仍可阅读产品介绍与申请步骤。') : (isTraditional ? '影片載入中…' : '影片加载中…')}</div> : null}
            <div className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1 text-xs font-black text-stone-900">
              <PlayCircle className="h-4 w-4" />
              {text.videoLabel}
            </div>
          </div>
        </section>

        <section id="product-intro" className="scroll-mt-4 rounded-lg border border-stone-200 bg-white p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <HeartPulse className="h-5 w-5 text-teal-700" />
            <h2 className="text-xl font-black">{text.introTitle}</h2>
          </div>
          <p className="mt-3 max-w-4xl text-sm font-semibold leading-7 text-stone-600">{text.intro}</p>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <InfoList title={text.fitTitle} icon={<Handshake className="h-5 w-5" />} rows={text.fit} />
          <InfoList title={text.canDoTitle} icon={<Store className="h-5 w-5" />} rows={text.canDo} />
        </section>

        <section className="space-y-4">
          <h2 className="flex items-center gap-2 text-xl font-black"><CheckCircle2 className="h-5 w-5 text-teal-700" />{text.flowTitle}</h2>
          <LocalizedLoop locale={locale} />
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <InfoList title={text.stepsTitle} icon={<ClipboardCheck className="h-5 w-5" />} rows={text.steps} ordered />
          <InfoList title={text.prepareTitle} icon={<QrCode className="h-5 w-5" />} rows={text.prepare} />
        </section>

        <section className="grid gap-4 lg:grid-cols-4">
          {storeRevenueCards.map((item) => (
            <article key={item.title} className="rounded-lg border border-stone-200 bg-white p-4">
              <h3 className="font-black text-stone-950">{isTraditional ? toTraditional(item.title) : item.title}</h3>
              <p className="mt-2 text-sm font-semibold leading-6 text-stone-600">{isTraditional ? toTraditional(item.detail) : item.detail}</p>
            </article>
          ))}
        </section>

        <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-amber-700" />
            <h2 className="text-xl font-black text-amber-950">{text.noticeTitle}</h2>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {text.notices.map((notice) => <div key={notice} className="rounded-lg bg-white px-4 py-3 text-sm font-bold leading-6 text-amber-900">{notice}</div>)}
          </div>
        </section>

        <div className="sticky bottom-3 z-20 rounded-lg border border-stone-200 bg-white/95 p-3 shadow-lg backdrop-blur">
          <button type="button" onClick={() => setContactOpen(true)} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-5 py-3 font-black text-white">
            <MessageCircle className="h-5 w-5" />
            {text.primary}
          </button>
        </div>
      </div>

      {contactOpen ? (
        <div className="fixed inset-0 z-50 flex items-end bg-stone-950/55 p-0 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-label={text.contactTitle}>
          <div className="max-h-[92svh] w-full overflow-auto rounded-t-lg bg-white p-5 shadow-xl sm:max-w-md sm:rounded-lg">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-stone-950">{text.contactTitle}</h2>
                <p className="mt-2 text-sm font-semibold leading-6 text-stone-600">{hasWechat && hasPhone ? text.contactHint : (isTraditional ? '客服聯絡資料尚待核對；目前不建立申請或收取費用。' : '客服联系资料尚待核对；目前不建立申请或收取费用。')}</p>
              </div>
              <button type="button" onClick={() => setContactOpen(false)} aria-label={text.close} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-stone-200">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-5 grid gap-4">
              {hasWechat && supportContact.wechatQr?.trim() && !qrFailed ? <img src={supportContact.wechatQr} alt={`${supportContact.wechatOfficialName} QR`} onError={() => setQrFailed(true)} className="mx-auto aspect-square w-56 max-w-full rounded-lg border border-stone-200 object-contain p-2" /> : <p role="status" className="text-sm font-semibold text-stone-600">{isTraditional ? '公眾號 QR 暫未提供或無法載入。' : '公众号 QR 暂未提供或无法载入。'}</p>}
              <div className="rounded-lg bg-stone-50 p-4 text-sm font-bold leading-7 text-stone-700">
                <div>{text.wechat}：<span className="text-stone-950">{hasWechat ? supportContact.wechatOfficialName : contactMissing}</span></div>
                <div>{text.phone}：{hasPhone ? <a href={`tel:${supportContact.phone}`} className="text-teal-700">{supportContact.phone}</a> : <span>{contactMissing}</span>}</div>
                <div>{isTraditional ? '客服名稱' : '客服名称'}：<span className="text-stone-950">{supportContact.serviceName?.trim() || contactMissing}</span></div>
              </div>
              <button type="button" onClick={() => setContactOpen(false)} className="min-h-11 rounded-lg border border-stone-300 px-4 py-2 font-black text-stone-800">{text.close}</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function InfoList({ title, icon, rows, ordered = false }: { title: string; icon: ReactNode; rows: readonly string[]; ordered?: boolean }) {
  const ListTag = ordered ? 'ol' : 'ul';
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5">
      <h2 className="flex items-center gap-2 text-xl font-black text-stone-950"><span className="text-teal-700">{icon}</span>{title}</h2>
      <ListTag className="mt-4 space-y-3">
        {rows.map((row, index) => (
          <li key={row} className="flex gap-3 text-sm font-semibold leading-6 text-stone-600">
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-teal-50 text-xs font-black text-teal-800">{ordered ? index + 1 : <CheckCircle2 className="h-4 w-4" />}</span>
            <span>{row}</span>
          </li>
        ))}
      </ListTag>
    </section>
  );
}
