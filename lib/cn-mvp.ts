import {
  BadgeDollarSign,
  CalendarCheck,
  ClipboardCheck,
  Crown,
  HeartPulse,
  Megaphone,
  PackageCheck,
  QrCode,
  ScanLine,
  ShieldCheck,
  Store,
  Users,
} from 'lucide-react';

export const cnRoleEntrances = [
  {
    title: '门店端',
    plainTitle: '缴设备预付金，开始经营客人',
    description: '门店取得阿富同学与身体检测仪，接待客人、办会员、做检测、推送商品。',
    href: '/cn/store',
    icon: Store,
    cta: '看门店工作台',
  },
  {
    title: '用户端',
    plainTitle: '到店体验、办会员、看推荐',
    description: '用户在门店完成会员、身体检测与服务，再接收适合的产品推送。',
    href: '/cn/experience',
    icon: HeartPulse,
    cta: '看用户流程',
  },
  {
    title: '渠道伙伴端',
    plainTitle: '跨城拓展门店与业务',
    description: '渠道伙伴或业务查看合作门店、会员、订单、分润与待跟进任务，不受行政区域限制。',
    href: '/cn/promoter',
    icon: Megaphone,
    cta: '看渠道伙伴工作台',
  },
  {
    title: '平台端',
    plainTitle: '公司看全局 CRM',
    description: '糙米平台管理客户来源、门店履约、订单、推荐码和客服确认状态。',
    href: '/cn/ops',
    icon: ClipboardCheck,
    cta: '看平台看板',
  },
];

export const storeOperatingLoop = [
  {
    title: '设备预付金取得设备',
    description: '门店缴纳设备预付金，取得阿富同学设备与身体检测仪。',
  },
  {
    title: '接待客人',
    description: '客人到店体验，门店赚取单次服务收益。',
  },
  {
    title: '办理会员',
    description: '门店用推荐码绑定客人，客人成为门店下线会员。',
  },
  {
    title: '检测登录',
    description: '身体检测仪资料登录到系统，形成健康记录。',
  },
  {
    title: 'AI 推送',
    description: '系统依身体状况推荐适合产品或服务包。',
  },
  {
    title: '成交分润',
    description: '用户下单后，利润依推荐关系分给业务、门店、渠道伙伴与公司。',
  },
];

export const hierarchyLevels = [
  {
    title: '糙米 / 公司',
    scope: '全国规则、品牌、商品、分润与总账',
  },
  {
    title: '渠道伙伴',
    scope: '管理合作门店、业务、交易与跨城拓展成果',
  },
  {
    title: '门店',
    scope: '管理设备、客人、会员、检测、推送与成交',
  },
  {
    title: '业务',
    scope: '拓展客户、绑定推荐码、追踪成交',
  },
  {
    title: '用户',
    scope: '到店体验、检测、购买服务或产品、再推荐朋友',
  },
];

export const storeRevenueCards = [
  {
    title: '单次体验收入',
    detail: '客人到店使用机器，门店取得服务收益。',
  },
  {
    title: '会员收入',
    detail: '客人办理会员或服务包，绑定门店推荐码。',
  },
  {
    title: '产品推送成交',
    detail: 'AI 依检测结果推送商品，用户下单后进分润。',
  },
  {
    title: '拓展下级',
    detail: '门店也可成为推广者，发展业务或更多用户。',
  },
];

export const transactionSettlementRows = [
  {
    title: '品牌结算',
    rule: 'SKU 固定结算价',
    value: '依 SKU',
    detail: '品牌供货与履约应收',
  },
  {
    title: '平台服务费',
    rule: '实付净额 × 0.6%',
    value: '0.6%',
    detail: '平台交易服务收入（千分之六）',
  },
  {
    title: '直接成交贡献',
    rule: '可奖励基数 × 30%',
    value: '30%',
    detail: '下单会员绑定的实际成交服务人取得',
  },
  {
    title: '上层推荐贡献',
    rule: '可奖励基数 × 5%',
    value: '5%',
    detail: '依实际推荐关系与服务记录取得',
  },
  {
    title: '近30天品牌销售贡献分润',
    rule: '可奖励基数 × 65%',
    value: '65%',
    detail: '付款时按个人近30天推荐成交件数占品牌总成交件数的比例分配',
  },
  {
    title: '分润合计',
    rule: '30% + 5% + 65%',
    value: '100%',
    detail: '可奖励基数在订单成立时分配完毕',
  },
];

export const transactionSettlementSummary = [
  {
    title: '成交售价',
    value: '依订单',
  },
  {
    title: '品牌结算',
    value: '依 SKU',
  },
  {
    title: '可奖励基数',
    value: '依费率计算',
  },
  {
    title: '30天销售贡献分润',
    value: '可奖励基数 × 65%',
  },
];

export const revenuePoolRules = [
  {
    title: '品牌独立排行',
    detail: '每个品牌各自计算近30天销售贡献，不和其他品牌混合。',
  },
  {
    title: '付款时锁定比例',
    detail: '个人近30天推荐成交件数 ÷ 品牌近30天总成交件数。',
  },
  {
    title: '订单即时分完',
    detail: '分完品牌、平台、成本、直接推荐与上层推荐后，剩余分润按付款时的30天销售贡献比例分配。',
  },
];

export const productSettlementBasis = [
  {
    title: '订单实付',
    value: '依订单',
    detail: '以支付平台确认的实际付款金额为准。',
  },
  {
    title: '平台服务费',
    value: '0.6%',
    detail: '按订单实付金额计算。',
  },
  {
    title: '支付通道费',
    value: '待设置',
    detail: '由平台按实际支付通道成本设置百分比。',
  },
  {
    title: '风险准备金',
    value: '待设置',
    detail: '正式比例与退款期满后的处理方式尚待确认。',
  },
  {
    title: '可奖励基数',
    value: '依订单计算',
    detail: '实付减去品牌结算、平台服务费、支付通道费、风险准备金及其他有效成本。',
  },
];

export const deviceSettlementRows = [
  {
    title: '设备方',
    rule: '服务费 × 30%',
    value: '30%',
    detail: '设备投入、维护、系统与耗損',
  },
  {
    title: '场地方',
    rule: '服务费 × 25%',
    value: '25%',
    detail: '场地、接待、体验執行与会员服务',
  },
  {
    title: '销售方',
    rule: '服务费 × 25%',
    value: '25%',
    detail: '本次成交与现场转化服务',
  },
  {
    title: '业务推广方',
    rule: '服务费 × 10%',
    value: '10%',
    detail: '客源推广、邀约与推荐鏈路',
  },
  {
    title: '渠道伙伴',
    rule: '服务费 × 10%',
    value: '10%',
    detail: '跨城渠道拓展、培训、巡店与落地管理',
  },
];

export const cnLoginRoles = [
  {
    title: '用户',
    description: '到店办会员、看检测记录、接收产品推送、查看订单。',
    href: '/cn/experience',
    registerText: '新建会员',
    icon: HeartPulse,
  },
  {
    title: '业务',
    description: '用推荐码拓展客户，追踪会员、检测、推送与成交。',
    href: '/cn/promoter',
    registerText: '申请业务',
    icon: Megaphone,
  },
  {
    title: '品牌',
    description: '提交商品上架，查看商品销售、分润与推送表现。',
    href: '/vendor',
    registerText: '品牌入驻',
    icon: PackageCheck,
  },
  {
    title: '门店',
    description: '管理设备、会员、检测资料、AI 推送与门店分润。',
    href: '/cn/store',
    registerText: '门店加入',
    icon: Store,
  },
  {
    title: '渠道伙伴',
    description: '管理合作门店、业务、下级交易与跨城拓展成果。',
    href: '/cn/promoter',
    registerText: '申请渠道伙伴',
    icon: ShieldCheck,
  },
  {
    title: '糙米 / 公司',
    description: '管理全国规则、商品审核、分润、CRM 与总账。',
    href: '/cn/ops',
    registerText: '公司登录',
    icon: Crown,
  },
];

export const consumerSteps = [
  {
    title: '预约体验',
    description: '选目的、选门店和时间、留下手机号。',
    icon: CalendarCheck,
  },
  {
    title: '到店掃码',
    description: '掃设备或门店码，确认本次体验和安全筛查。',
    icon: ScanLine,
  },
  {
    title: '体验后推送',
    description: '看本次记录，买服务包或分享朋友。',
    icon: PackageCheck,
  },
];

export const storeTasks = [
  {
    title: '今日预约',
    value: '8',
    detail: '3 位待确认，2 位下午到店',
  },
  {
    title: '体验中',
    value: '2',
    detail: '需要完成服务记录',
  },
  {
    title: '待随访',
    value: '5',
    detail: '离店后 24 小时内回访',
  },
];

export const promoterPipeline = [
  {
    title: '已进入',
    value: '26',
    detail: '朋友点过分享链接',
  },
  {
    title: '已预约',
    value: '11',
    detail: '来源已锁定到推荐码',
  },
  {
    title: '已体验',
    value: '6',
    detail: '可进一步追踪成交',
  },
  {
    title: '可结算',
    value: '3',
    detail: '客服确认后列入奖励',
  },
];

export const opsMetrics = [
  {
    title: '有效预约',
    value: '42',
    detail: '本周可追踪来源的新预约',
    icon: CalendarCheck,
  },
  {
    title: '完成体验',
    value: '18',
    detail: '已到店並留下服务记录',
    icon: HeartPulse,
  },
  {
    title: '推荐带客',
    value: '14',
    detail: '由推荐码带来的有效线索',
    icon: QrCode,
  },
  {
    title: '待确认订单',
    value: '7',
    detail: '客服确认中',
    icon: BadgeDollarSign,
  },
];
