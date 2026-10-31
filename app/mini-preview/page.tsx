'use client';

import { useEffect, useMemo, useState } from 'react';
import { Building2, ChevronRight, MessageCircleMore, Search, ShoppingBag, ShoppingCart, Store, UserRound } from 'lucide-react';
import './preview.css';

type Product = {
  id: number;
  name: string;
  price?: number;
  priceCny?: number;
  category?: string;
  tag?: string;
  brandName?: string;
  imageUrl?: string;
  imageIsTest?: boolean;
  sold?: number;
};

type CartLine = Product & { quantity: number };
type PreviewPage = 'login' | 'shop' | 'cart' | 'member';

const money = (value: number) => `¥${value.toLocaleString('zh-CN')}`;
const productPrice = (product: Product) => Number(product.priceCny ?? product.price ?? 0);

export default function MiniPreviewPage() {
  const [page, setPage] = useState<PreviewPage>('login');
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [member, setMember] = useState<{ name: string; referralCode?: string } | null>(null);
  const [workspace, setWorkspace] = useState<any>(null);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/products?marketRegion=CN')
      .then((response) => response.json())
      .then((data) => setProducts(Array.isArray(data) ? data : data.products || []))
      .catch(() => setProducts([]));
  }, []);

  const login = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: `fresh-member:${Date.now()}`, password: '0', testRole: 'member' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || '登录失败');
      setMember(data.user);
      const workspaceResponse = await fetch('/api/cn/workspaces/member');
      if (workspaceResponse.ok) setWorkspace(await workspaceResponse.json());
      setPage('shop');
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    if (!query) return products;
    return products.filter((product) => [product.name, product.brandName, product.category, product.tag].some((value) => String(value || '').toLowerCase().includes(query)));
  }, [keyword, products]);

  const addCart = (product: Product) => {
    setCart((current) => {
      const found = current.find((line) => String(line.id) === String(product.id));
      if (found) return current.map((line) => String(line.id) === String(product.id) ? { ...line, quantity: line.quantity + 1 } : line);
      return [...current, { ...product, quantity: 1 }];
    });
  };

  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const cartTotal = cart.reduce((sum, line) => sum + productPrice(line) * line.quantity, 0);

  return (
    <main className="mini-review-stage">
      <section className="mini-device" aria-label="糙米小程序本机同步预览">
        <header className="mini-native-bar">
          <span>{page === 'login' ? '糙米登录' : '糙米'}</span>
          <span className="mini-menu">••• ◉</span>
        </header>

        <div className="mini-content">
          {page === 'login' && (
            <div className="login-page">
              <div className="kicker">糙米平台</div>
              <h1>微信登录</h1>
              <section className="mini-card login-card">
                <h2>微信会员登录</h2>
                <button className="wechat-login" onClick={login} disabled={loading}>
                  <MessageCircleMore size={20} /> {loading ? '正在建立会员' : '微信一键登录'}
                </button>
              </section>
            </div>
          )}

          {page === 'shop' && (
            <div className="shop-page">
              <div className="shop-topbar">
                <div><strong>糙米</strong><small>{member ? member.name : '糙米平台'}</small></div>
                <button onClick={() => setPage('member')}>会员中心</button>
              </div>
              <label className="search-box"><Search size={18} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索商品、品牌或健康需求" /></label>
              <section className="shop-hero"><small>CAOMI MARKET</small><h1>精选健康商品</h1></section>
              <div className="section-heading"><div><small>PRODUCTS</small><h2>精选商品</h2></div><span>{filteredProducts.length} 件</span></div>
              <div className="product-grid">{filteredProducts.map((product) => <article className="product-tile" key={product.id}><div className="product-image">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span>品牌商品</span>}{product.imageIsTest ? <em>商品参考图</em> : null}</div><div className="product-copy"><small>{product.brandName || '品牌待确认'}</small><h3>{product.name}</h3><p>{product.category || product.tag || '健康商品'} · 已售 {product.sold || 0}</p><footer><strong>{money(productPrice(product))}</strong><button onClick={() => addCart(product)}>+</button></footer></div></article>)}</div>
            </div>
          )}

          {page === 'cart' && (
            <div className="standard-page"><div className="title-row"><h1>购物车</h1><span>{cartCount} 件</span></div>{cart.length ? <>{cart.map((line) => <article className="mini-card cart-line" key={line.id}>{line.imageUrl ? <img src={line.imageUrl} alt="" /> : <div className="cart-placeholder"><ShoppingBag /></div>}<div><h3>{line.name}</h3><strong>{money(productPrice(line))}</strong><p>数量 {line.quantity}</p></div></article>)}<section className="mini-card"><div className="title-row"><h2>合计</h2><strong>{money(cartTotal)}</strong></div><div className="payment-row"><span>微信支付</span><em>未开通</em></div><button className="primary-action">保存订单</button></section></> : <div className="empty-state"><ShoppingCart size={42} /><h2>购物车还是空的</h2><button onClick={() => setPage('shop')}>去逛商城</button></div>}</div>
          )}

          {page === 'member' && (
            <div className="standard-page member-page"><div className="member-head"><div><div className="kicker">会员中心</div><h1>{member?.name || '微信会员'}</h1></div><button onClick={() => { setMember(null); setWorkspace(null); setPage('login'); }}>退出</button></div><section className="referral-card"><span>我的推荐码</span><strong>{workspace?.referralCode || member?.referralCode || '建立中'}</strong><button>复制</button></section><div className="section-heading"><h2>经营功能</h2></div><div className="capability-list"><button><Building2 /><span><b>申请品牌入驻</b></span><em>未开通 <ChevronRight /></em></button><button><Store /><span><b>申请开通门店</b></span><em>未开通 <ChevronRight /></em></button></div><div className="section-heading"><h2>我的服务</h2></div><div className="service-grid"><button>我的订单</button><button>分润钱包</button><button onClick={() => setPage('cart')}>购物车</button><button onClick={() => setPage('shop')}>返回商城</button></div><div className="metric-grid">{(workspace?.metrics || []).map((metric: any) => <article key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>查看全部 <ChevronRight /></small></article>)}</div></div>
          )}
        </div>

        {page !== 'login' && <nav className="mini-tabbar" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}><button className={page === 'shop' ? 'active' : ''} onClick={() => setPage('shop')}><ShoppingBag />商城</button><button className={page === 'cart' ? 'active' : ''} onClick={() => setPage('cart')}><ShoppingCart />购物车{cartCount ? <i>{cartCount}</i> : null}</button><button className={page === 'member' ? 'active' : ''} onClick={() => setPage('member')}><UserRound />我的</button></nav>}
      </section>
    </main>
  );
}
