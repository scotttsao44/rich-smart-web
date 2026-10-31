'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle, Minus, Package, Pencil, Plus, ShoppingCart, Star, Trash2 } from 'lucide-react';
import { useAuth, useCart } from '@/app/providers';
import { formatCny } from '@/lib/cn-market';
import { normalizeContactPhone } from '@/lib/international-phone';
import ChinaMobileTabBar from '@/components/ChinaMobileTabBar';

type AddressForm = {
  id: string;
  name: string;
  phone: string;
  provinceCity: string;
  provinceCode: string;
  province: string;
  cityCode: string;
  city: string;
  districtCode: string;
  district: string;
  address: string;
  isDefault: boolean;
};

type RegionOption = { code: string; name: string };

type PaymentMethod = 'wechat_pay' | 'alipay' | 'bank_transfer';
type PaymentOption = { value: PaymentMethod; title: string; detail: string; enabled: boolean; testMode: boolean; liveConfigured: boolean };

const emptyAddress: AddressForm = {
  id: '',
  name: '',
  phone: '',
  provinceCity: '',
  provinceCode: '',
  province: '',
  cityCode: '',
  city: '',
  districtCode: '',
  district: '',
  address: '',
  isDefault: false,
};

const defaultPaymentOptions: PaymentOption[] = [
  { value: 'wechat_pay', title: '微信支付', detail: '支付通道尚未开通，本次不会扣款', enabled: true, testMode: true, liveConfigured: false },
  { value: 'alipay', title: '支付宝', detail: '支付通道尚未开通，本次不会扣款', enabled: true, testMode: true, liveConfigured: false },
  { value: 'bank_transfer', title: '银行转账', detail: '建立待付款订单，转账后由平台确认', enabled: true, testMode: false, liveConfigured: true },
];

export default function ChinaCartPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { items, removeItem, updateQuantity, clearCart } = useCart();
  const cnItems = useMemo(() => items.filter((item) => item.marketRegion === 'CN' || item.currency === 'CNY'), [items]);
  const totalAmount = cnItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const [checkingOut, setCheckingOut] = useState(false);
  const [orderId, setOrderId] = useState<number | null>(null);
  const [addressBook, setAddressBook] = useState<AddressForm[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [editingAddress, setEditingAddress] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('bank_transfer');
  const [paymentOptions, setPaymentOptions] = useState<PaymentOption[]>(defaultPaymentOptions);
  const [paymentMessage, setPaymentMessage] = useState('');
  const [wechatQr, setWechatQr] = useState('');
  const [paid, setPaid] = useState(false);
  const [form, setForm] = useState<AddressForm>(emptyAddress);
  const [addressMessage, setAddressMessage] = useState('');
  const [checkoutError, setCheckoutError] = useState('');
  const [provinces, setProvinces] = useState<RegionOption[]>([]);
  const [cities, setCities] = useState<RegionOption[]>([]);
  const [districts, setDistricts] = useState<RegionOption[]>([]);

  const loadRegions = async (level: 'province' | 'city' | 'district', parent = '') => {
    const response = await fetch(`/api/cn/regions?level=${level}${parent ? `&parent=${parent}` : ''}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '读取地区失败');
    return (data.regions || []) as RegionOption[];
  };

  useEffect(() => {
    loadRegions('province').then(setProvinces).catch(() => setAddressMessage('地区资料读取失败，请刷新重试'));
  }, []);

  useEffect(() => {
    if (!user) return;
    fetch('/api/cn/addresses')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '读取收货信息失败');
        return data.addresses || [];
      })
      .then((addresses: Array<AddressForm & { region?: string }>) => {
        const normalized = addresses.map((item) => ({
          ...emptyAddress,
          ...item,
          provinceCity: item.region || item.provinceCity || '',
        }));
        setAddressBook(normalized);
        const selected = normalized.find((item) => item.isDefault) || normalized[0];
        if (selected) {
          setSelectedAddressId(selected.id);
          setForm(selected);
          setEditingAddress(false);
        }
      })
      .catch((error) => setAddressMessage(error instanceof Error ? error.message : '读取收货信息失败'));
  }, [user]);

  useEffect(() => {
    if (!form.provinceCode) return setCities([]);
    loadRegions('city', form.provinceCode).then(setCities).catch(() => setAddressMessage('城市资料读取失败'));
  }, [form.provinceCode]);

  useEffect(() => {
    if (!form.cityCode) return setDistricts([]);
    loadRegions('district', form.cityCode).then(setDistricts).catch(() => setAddressMessage('区县资料读取失败'));
  }, [form.cityCode]);

  useEffect(() => {
    fetch('/api/payments/providers').then((response) => response.json()).then((data) => {
      if (!Array.isArray(data.providers)) return;
      setPaymentOptions(data.providers.filter((provider: any) => provider.channels?.includes('web') || provider.channels?.includes('h5')).map((provider: any) => ({ value: provider.id, title: provider.name, detail: provider.message, enabled: provider.enabled, testMode: provider.testMode, liveConfigured: provider.liveConfigured })));
    }).catch(() => undefined);
  }, []);

  const updateForm = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const selectProvince = (code: string) => {
    const selected = provinces.find((item) => item.code === code);
    setForm((current) => ({ ...current, provinceCode: code, province: selected?.name || '', cityCode: '', city: '', districtCode: '', district: '', provinceCity: '' }));
    setCities([]);
    setDistricts([]);
  };

  const selectCity = (code: string) => {
    const selected = cities.find((item) => item.code === code);
    setForm((current) => ({ ...current, cityCode: code, city: selected?.name || '', districtCode: '', district: '', provinceCity: '' }));
    setDistricts([]);
  };

  const selectDistrict = (code: string) => {
    const selected = districts.find((item) => item.code === code);
    setForm((current) => {
      const district = selected?.name || '';
      const provinceCity = [current.province, current.city === current.province ? '' : current.city, district].filter(Boolean).join('');
      return { ...current, districtCode: code, district, provinceCity };
    });
  };

  const regionComplete = Boolean(form.provinceCode && form.cityCode && form.districtCode);
  let normalizedPhone = '';
  try { normalizedPhone = normalizeContactPhone(form.phone); } catch {}
  const canSubmit = Boolean(form.name.trim() && normalizedPhone && (regionComplete || form.provinceCity.trim()) && form.address.trim());

  const saveAddress = async () => {
    if (!canSubmit || !user) return null;
    setAddressMessage('保存中...');
    const res = await fetch('/api/cn/addresses', {
      method: form.id ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, name: form.name.trim(), phone: normalizedPhone, region: form.provinceCity.trim(), address: form.address.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      setAddressMessage(data.error || '保存失败');
      return null;
    }
    const nextAddress = { ...emptyAddress, ...data.address, provinceCity: data.address.region } as AddressForm;
    setAddressBook((current) => {
      const exists = current.some((item) => item.id === nextAddress.id);
      return exists ? current.map((item) => (item.id === nextAddress.id ? nextAddress : item)) : [nextAddress, ...current];
    });
    setSelectedAddressId(nextAddress.id);
    setForm(nextAddress);
    setEditingAddress(false);
    setAddressMessage('收货信息已保存');
    return nextAddress;
  };

  const deleteAddress = async (id: string) => {
    const res = await fetch(`/api/cn/addresses?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) return setAddressMessage('删除失败');
    const next = addressBook.filter((item) => item.id !== id);
    setAddressBook(next);
    const replacement = next.find((item) => item.isDefault) || next[0];
    if (replacement) selectAddress(replacement);
    else startNewAddress();
    setAddressMessage('地址已删除');
  };

  const setDefaultAddress = async (address: AddressForm) => {
    const res = await fetch('/api/cn/addresses', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: address.id, action: 'set_default' }),
    });
    if (!res.ok) return setAddressMessage('设置默认地址失败');
    setAddressBook((current) => current.map((item) => ({ ...item, isDefault: item.id === address.id })));
    setForm({ ...address, isDefault: true });
    setAddressMessage('已设为默认地址');
  };

  const selectAddress = (address: AddressForm) => {
    setSelectedAddressId(address.id);
    setForm(address);
    setEditingAddress(false);
  };

  const startNewAddress = () => {
    setForm(emptyAddress);
    setSelectedAddressId('');
    setEditingAddress(true);
  };

  const handleCheckout = async () => {
    if (!user) {
      router.push('/cn/login?next=%2Fcn%2Fcart');
      return;
    }
    if (cnItems.length === 0 || !canSubmit) return;
    const checkoutAddress = editingAddress ? await saveAddress() : form;
    if (!checkoutAddress) return;

    setCheckingOut(true);
    setCheckoutError('');
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          currency: 'CNY',
          marketRegion: 'CN',
          sourceChannel: 'wechat_h5',
          paymentMethod,
          shippingName: checkoutAddress.name.trim(),
          shippingPhone: checkoutAddress.phone.trim(),
          shippingCity: checkoutAddress.provinceCity.trim(),
          shippingAddress: checkoutAddress.address.trim(),
          items: cnItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.price,
            referrerBrandId: item.referrerBrandId,
            partnershipId: item.partnershipId,
          })),
          addressId: checkoutAddress.id,
          idempotencyKey: `web-${user.id}-${Date.now()}-${cnItems.map((item) => `${item.productId}:${item.quantity}`).join('-')}`,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '订单建立失败');
      if (paymentMethod !== 'bank_transfer') {
        const paymentResponse = await fetch('/api/payments/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: data.orderId, provider: paymentMethod, simulate: true, idempotencyKey: `web-payment-${data.orderId}` }),
        });
        const paymentData = await paymentResponse.json();
        if (!paymentResponse.ok && !paymentData.pendingAuthorization) throw new Error(paymentData.error || '付款建立失败');
        if (paymentData.qrDataUrl) setWechatQr(paymentData.qrDataUrl);
        setPaymentMessage(paymentData.message || '付款状态已更新');
      }
      clearCart();
      setOrderId(data.orderId);
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : '订单提交失败，请稍后再试');
    } finally {
      setCheckingOut(false);
    }
  };

  useEffect(() => {
    if (!orderId || !wechatQr || paid) return;
    const timer = setInterval(async () => {
      try {
        const r = await fetch('/api/payments/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId }) });
        const d = await r.json();
        if (d.paid) { setPaid(true); setPaymentMessage('微信支付成功！'); }
      } catch { /* 继续轮询 */ }
    }, 3000);
    return () => clearInterval(timer);
  }, [orderId, wechatQr, paid]);

  if (orderId) {
    return (
      <main className="mx-auto min-h-screen max-w-4xl px-4 pb-24 pt-12 text-center md:pb-12">
        <CheckCircle size={64} className="mx-auto mb-4 text-green-500" />
        <h1 className="text-2xl font-bold text-gray-950">订单已提交</h1>
        <p className="mt-2 text-gray-500">订单编号：#{orderId}</p>
        {wechatQr && !paid && (
          <div className="mx-auto mt-4 w-fit rounded-lg border border-green-200 bg-white p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={wechatQr} alt="微信支付二维码" width={240} height={240} />
            <p className="mt-2 text-sm text-green-700">请使用微信扫一扫付款，付款后页面自动更新</p>
          </div>
        )}
        <p className="mt-2 text-sm text-gray-500">{paymentMethod === 'bank_transfer' ? '付款状态：等待银行转账。' : (paymentMessage || '支付通道尚未开通，订单已记录，没有发生扣款。')}订单与收货资料已经保存。</p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href={`/cn/orders/${orderId}`} className="btn-primary">查看订单</Link>
          <Link href="/cn/shop" className="btn-outline">继续选购</Link>
        </div>
        <ChinaMobileTabBar active="cart" />
      </main>
    );
  }

  if (cnItems.length === 0) {
    return (
      <main className="mx-auto min-h-screen max-w-6xl px-4 pb-24 pt-12 text-center md:pb-12">
        <ShoppingCart size={48} className="mx-auto mb-4 text-gray-300" />
        <h1 className="mb-2 text-xl font-bold text-gray-800">购物车是空的</h1>
        <Link href="/cn/shop" className="btn-primary">前往商城</Link>
        <ChinaMobileTabBar active="cart" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f3ea] pb-20 md:pb-0">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <Link href="/cn/shop" className="text-sm font-semibold text-amber-700 hover:text-amber-800">
          返回商城
        </Link>
        <h1 className="mt-4 text-3xl font-bold text-gray-950">确认订单</h1>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
          <section className="space-y-4">
            {cnItems.map((item) => (
              <article key={item.productId} className="flex items-center gap-4 rounded-lg border border-amber-100 bg-white p-4 shadow-sm">
                <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
                  {item.imageUrl ? (
                    <Image src={item.imageUrl} alt={item.name} fill sizes="80px" className="object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-gray-400">
                      <Package size={22} />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-grow">
                  <h2 className="truncate font-bold text-gray-950">{item.name}</h2>
                  <p className="text-sm text-gray-500">{formatCny(item.price)}</p>
                </div>
                <div className="flex items-center rounded-lg border border-gray-300">
                  <button onClick={() => updateQuantity(item.productId, item.quantity - 1)} className="px-2 py-1 hover:bg-gray-50">
                    <Minus size={14} />
                  </button>
                  <span className="min-w-[2rem] px-3 py-1 text-center text-sm font-semibold">{item.quantity}</span>
                  <button onClick={() => updateQuantity(item.productId, item.quantity + 1)} className="px-2 py-1 hover:bg-gray-50">
                    <Plus size={14} />
                  </button>
                </div>
                <p className="min-w-[5rem] text-right font-bold text-gray-950">{formatCny(item.price * item.quantity)}</p>
                <button onClick={() => removeItem(item.productId)} className="p-2 text-gray-400 hover:text-red-500">
                  <Trash2 size={18} />
                </button>
              </article>
            ))}
          </section>

          <aside className="rounded-lg border border-amber-100 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-gray-950">收货与联系信息</h2>
              <button type="button" onClick={startNewAddress} className="text-xs font-bold text-teal-700">新增</button>
            </div>

            {addressBook.length > 0 && (
              <div className="mt-4 space-y-2">
                {addressBook.map((address) => (
                  <div
                    key={address.id}
                    className={`w-full rounded-lg border px-3 py-3 text-left ${selectedAddressId === address.id ? 'border-teal-500 bg-teal-50' : 'border-gray-200 bg-white'}`}
                  >
                    <button type="button" onClick={() => selectAddress(address)} className="w-full text-left">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-bold text-gray-950">{address.name} · {address.phone}</span>
                        <span className="text-xs font-bold text-teal-700">{address.isDefault ? '默认' : selectedAddressId === address.id ? '使用中' : '使用'}</span>
                      </div>
                      <div className="mt-1 text-xs text-gray-500">{address.provinceCity} {address.address}</div>
                    </button>
                    <div className="mt-3 flex gap-3 border-t border-stone-100 pt-2 text-xs font-bold">
                      <button type="button" onClick={() => { selectAddress(address); setEditingAddress(true); }} className="inline-flex items-center gap-1 text-teal-700"><Pencil size={13} />编辑</button>
                      {!address.isDefault && <button type="button" onClick={() => setDefaultAddress(address)} className="inline-flex items-center gap-1 text-amber-700"><Star size={13} />设为默认</button>}
                      <button type="button" onClick={() => deleteAddress(address.id)} className="ml-auto text-red-600">删除</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 space-y-3">
              {editingAddress ? (
                <>
                  <input className="input-field" value={form.name} onChange={(event) => updateForm('name', event.target.value)} placeholder="收货人姓名" />
                  <input className="input-field" value={form.phone} onChange={(event) => updateForm('phone', event.target.value)} placeholder="手机号 / 微信联系方式" />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <select className="input-field" value={form.provinceCode} onChange={(event) => selectProvince(event.target.value)}>
                      <option value="">选择省份</option>
                      {provinces.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
                    </select>
                    <select className="input-field" value={form.cityCode} disabled={!form.provinceCode} onChange={(event) => selectCity(event.target.value)}>
                      <option value="">选择城市</option>
                      {cities.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
                    </select>
                    <select className="input-field" value={form.districtCode} disabled={!form.cityCode} onChange={(event) => selectDistrict(event.target.value)}>
                      <option value="">选择区县</option>
                      {districts.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
                    </select>
                  </div>
                  {!regionComplete && form.provinceCity ? <p className="text-xs font-semibold text-amber-700">原地址地区：{form.provinceCity}。可直接保留，或重新选择省市区县。</p> : null}
                  <textarea className="input-field min-h-[96px]" value={form.address} onChange={(event) => updateForm('address', event.target.value)} placeholder="街道、路、巷、门牌号、楼栋及房间号" />
                  <button type="button" onClick={saveAddress} disabled={!canSubmit} className="w-full rounded-lg border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-bold text-teal-700 disabled:opacity-50">
                    保存收货信息
                  </button>
                </>
              ) : (
                <div className="rounded-lg bg-stone-50 p-3">
                  <div className="font-bold text-gray-950">{form.name} · {form.phone}</div>
                  <div className="mt-1 text-sm text-gray-600">{form.provinceCity} {form.address}</div>
                  <button type="button" onClick={() => setEditingAddress(true)} className="mt-3 text-sm font-bold text-teal-700">
                    修改信息
                  </button>
                </div>
              )}
            </div>
            {addressMessage && <p className="mt-3 text-sm font-semibold text-teal-700">{addressMessage}</p>}

            <div className="mt-5 border-t border-gray-100 pt-5">
              <h3 className="text-sm font-bold text-gray-950">付款方式</h3>
              <div className="mt-3 space-y-2">
                {paymentOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => option.enabled && setPaymentMethod(option.value)}
                    className={`w-full rounded-lg border px-3 py-3 text-left ${paymentMethod === option.value ? 'border-teal-500 bg-teal-50' : 'border-gray-200 bg-white'} ${option.enabled ? '' : 'opacity-60'}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-bold text-gray-950">{option.title}</span>
                      <span className="text-xs font-bold text-gray-500">{option.testMode ? '未开通' : option.enabled ? (paymentMethod === option.value ? '已选择' : '可选') : '待接入'}</span>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">{option.detail}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 border-t border-gray-100 pt-5">
              <div className="flex items-center justify-between text-gray-600">
                <span>商品小计</span>
                <span className="font-semibold">{formatCny(totalAmount)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-gray-600">
                <span>当前付款</span>
                <span className="text-right font-semibold text-teal-700">
                  {paymentOptions.find((option) => option.value === paymentMethod)?.title}
                </span>
              </div>
              <div className="mt-4 flex items-center justify-between text-xl font-bold">
                <span>合计</span>
                <span className="text-amber-700">{formatCny(totalAmount)}</span>
              </div>
            </div>

            <button
              onClick={handleCheckout}
              disabled={checkingOut || !canSubmit}
              className="btn-primary mt-6 flex w-full items-center justify-center gap-2 py-3 disabled:opacity-50"
            >
              {checkingOut ? '提交中...' : '提交订单'}
              <ArrowRight size={18} />
            </button>
            {checkoutError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-600">{checkoutError}</p>}
            {!user && <p className="mt-3 text-center text-sm text-gray-500">提交订单需要会员身份。</p>}
          </aside>
        </div>
      </div>
      <ChinaMobileTabBar active="cart" />
    </main>
  );
}
