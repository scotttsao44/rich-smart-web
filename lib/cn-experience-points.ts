// 合作体验点（单一资料来源）
// 读取方：AI 客服知识库（lib/wechat-kefu-knowledge.ts 的 KEFU_STORES / 提示词）、品牌前页页尾（app/cn/brands/[slug]/page.tsx）。
// 线下整理稿：plan_materials/運營中心_投放與發貨地址_20261102.md（同一笔资料，改这里时一并更新）。
// 原则：只放公司/门店主体与经营地址；不放个人姓名、个人手机号、注册地址、法定代表人。
// publicAddress 只在品牌前页显示；AI 客服只说 kefuLabel（店名＋城市／区域），预约仍引导留电话。

export type ExperiencePoint = {
  id: string;
  city: string;
  kefuLabel: string; // AI 客服可公开的称呼
  operator: string; // 经营主体（公司）
  publicAddress: string; // 经营地址（品牌前页显示）
  brandSlug?: string; // 关联品牌前页
  source: string;
};

export const EXPERIENCE_POINTS: ExperiencePoint[] = [
  {
    id: 'xiamen-jinlong',
    city: '厦门',
    kefuLabel: '金龙广场（湖里区）体验点',
    operator: '厦门中康恒久健康产业有限公司（华南总代理办公室）',
    publicAddress: '福建省厦门市湖里区金山街道金钟路130号 金龙广场2号楼1506室',
    brandSlug: 'zhongkang-zhongshu',
    source: '叶荣德 2026-09-04 私聊；王建民 2026-09-07「频率激活华南群」；曹总 2026-11-03 确认',
  },
  {
    id: 'suzhou-liangyuan',
    city: '苏州',
    kefuLabel: '量元能量空间（姑苏区）',
    operator: '量元健康（苏州合量元文化发展有限公司）· 量元能量空间 宝元工作室',
    publicAddress: '江苏省苏州市姑苏区前宝元街23号（量元能量空间 宝元工作室）',
    brandSlug: 'liangyuan-health',
    source: '量元健康品牌资料 PDF 第 42 页宣传单页；2026-11-03 平台代建登记，待苏老师认领时确认',
  },
];

export function experiencePointForBrand(slug: string) {
  return EXPERIENCE_POINTS.find((point) => point.brandSlug && point.brandSlug === slug) || null;
}
