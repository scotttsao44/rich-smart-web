// 合作体验点（单一资料来源）
// 读取方：AI 客服知识库（lib/wechat-kefu-knowledge.ts 的 KEFU_STORES / 提示词）、品牌前页页尾（app/cn/brands/[slug]/page.tsx）。
// 线下整理稿：plan_materials/運營中心_投放與發貨地址_20261102.md（同一笔资料，改这里时一并更新）。
// 原则：只放公司/门店主体与经营地址；不放个人姓名、个人手机号、注册地址、法定代表人。
// publicAddress：品牌前页、体验点导航页（/cn/experience-points）与 AI 客服可公开；不放个人姓名、个人手机号。

export type ExperiencePoint = {
  id: string;
  city: string;
  kefuLabel: string; // AI 客服可公开的称呼
  operator: string; // 经营主体（公司）
  publicAddress: string; // 经营地址（品牌前页显示）
  brandSlug?: string; // 关联品牌前页
  source: string;
  ownerMemberIds?: number[]; // 店主／体验点负责人会员 ID（后台「需要推送的人」设置，存 cn-store-owners.json，见 lib/local-cn-store-owners.ts）
  // ── 地址与导航（2026-11-04 新增；后台 /cn/ops/experience-points 可改，改动存 cn-experience-points.json 覆盖这里的底稿） ──
  district?: string; // 区／县
  lat?: number; // GCJ-02 纬度（微信 openLocation、高德均用 GCJ-02）
  lng?: number; // GCJ-02 经度
  geoStatus?: GeoStatus; // precise＝门牌／楼宇级；approximate＝街道或同名地图点，待门店确认；missing＝没有可用地址
  publicPhone?: string; // 门店公开座机／前台电话；没有就显示客服电话，绝不放个人手机
  hours?: string;
  visible?: boolean; // false＝不在体验点页面与客服回复中出现
  businessModel?: string;
  geoNote?: string; // 地址来源／待确认说明（只给后台看）
};

export type GeoStatus = 'precise' | 'approximate' | 'missing';
export const KEFU_PUBLIC_PHONE = '15862501498';

export const EXPERIENCE_POINTS: ExperiencePoint[] = [
  {
    id: 'xiamen-jinlong',
    city: '厦门',
    kefuLabel: '金龙广场（湖里区）体验点',
    operator: '厦门中康恒久健康产业有限公司（华南总代理办公室）',
    publicAddress: '福建省厦门市湖里区金山街道金钟路130号 金龙广场2号楼1506室',
    brandSlug: 'zhongkang-zhongshu',
    source: '叶荣德 2026-09-04 私聊；王建民 2026-09-07「频率激活华南群」；曹总 2026-11-03 确认',
    district: '湖里区',
    lat: 24.500844,
    lng: 118.176141,
    geoStatus: 'precise',
    visible: true,
    geoNote: '360 地图 POI「金龙广场二号楼」（金钟路130号，GCJ-02），楼宇级',
  },
  {
    id: 'suzhou-liangyuan',
    city: '苏州',
    kefuLabel: '量元能量空间（姑苏区）',
    operator: '量元健康（苏州合量元文化发展有限公司）· 量元能量空间 宝元工作室',
    publicAddress: '江苏省苏州市姑苏区前宝元街23号（量元能量空间 宝元工作室）',
    brandSlug: 'liangyuan-health',
    source: '量元健康品牌资料 PDF 第 42 页宣传单页；2026-11-03 平台代建登记，待苏老师认领时确认',
    district: '姑苏区',
    lat: 31.31753,
    lng: 120.59702,
    geoStatus: 'approximate',
    visible: true,
    geoNote: '地图上只有「前宝元街」街道点，没有 23 号门牌；与 OSM 前宝元街（WGS84→GCJ-02）相符。待苏老师确认门牌与现场是否有设备',
  },
];

// 体验点目录（体验点页面 /cn/experience-points 与客服「6」读取）。
// 与 EXPERIENCE_POINTS 分开：店主通知（notifyStoreOwnersForCity）只按 EXPERIENCE_POINTS 走，这里新增的点不会触发店主／兜底通知。
// 没有可靠地址的点 geoStatus='missing'，页面与客服不列出地址，等后台补齐。
export const EXPERIENCE_POINT_DIRECTORY: ExperiencePoint[] = [
  {
    id: 'suzhou-dejitang',
    city: '苏州',
    kefuLabel: '德吉堂',
    operator: '苏州德吉堂健康管理服务有限公司',
    publicAddress: '',
    source: '运营中心群 2026-08-19 起；客服知识库定稿 2026-11-02',
    district: '姑苏区',
    geoStatus: 'missing',
    visible: true,
    geoNote: '网上查到三个不同地址，无法确定门店：招聘页「姑苏区山塘街373号」、企业查询「姑苏区枫桥路910号」、注册地址「姑苏区胥江路482号传达室东-7」。请门店确认实际营业地址',
  },
  {
    id: 'suzhou-qichao',
    city: '苏州',
    kefuLabel: '芪巢健康社区服务中心',
    operator: '芪巢健康保健服务中心',
    publicAddress: '江苏省苏州市吴中区东华林街 水墨江南一期（芪巢健康保健服务中心）',
    source: '运营中心群 2026-08-19「投放到芪巢健康社区服务中心娄江街道」',
    district: '吴中区',
    lat: 31.288454,
    lng: 120.722206,
    geoStatus: 'approximate',
    visible: true,
    geoNote: '360 地图同名 POI「芪巢健康保健服务中心」（吴中区东华林街水墨江南一期）；群里写「娄江街道」，两者不一致，待门店确认',
  },
  {
    id: 'suzhou-dequan',
    city: '苏州',
    kefuLabel: '德泉中医养生馆',
    operator: '吴中德泉中医养生馆',
    publicAddress: '',
    source: '运营中心群 2026-04-29 合同名「吴中德泉中医养生馆共享设备投放合作协议」',
    district: '吴中区',
    geoStatus: 'missing',
    visible: true,
    geoNote: '地图与网上均未找到；地址应在合同附件里，请后台补',
  },
  ...EXPERIENCE_POINTS,
  {
    id: 'jinan-zhongtai',
    city: '济南',
    kefuLabel: '济南体验点（中泰大厦）',
    operator: '待确认',
    publicAddress: '山东省济南市历下区东关大街5号 中泰大厦706室',
    source: '运营中心群 2026-10-07 设备变更后的投放点',
    district: '历下区',
    lat: 36.680013,
    lng: 117.045893,
    geoStatus: 'precise',
    visible: false,
    geoNote: '楼宇级坐标（360 地图「中泰大厦」）。群里记录是合作人处，没有对外店名，先不公开；确认可公开名称后再打开',
  },
  {
    id: 'nanjing-gaochun',
    city: '南京',
    kefuLabel: '高淳体验点',
    operator: '待确认',
    publicAddress: '',
    source: '运营中心群 2026-08-19 起（高淳 大闸蟹基地）',
    district: '高淳区',
    geoStatus: 'missing',
    visible: false,
    geoNote: '地址只在 10-08 图片与合同附件里，文字未写；请后台补地址和对外名称',
  },
];

export function experiencePointForBrand(slug: string) {
  return EXPERIENCE_POINTS.find((point) => point.brandSlug && point.brandSlug === slug) || null;
}
