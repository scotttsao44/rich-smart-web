export type StoreLocation = {
  id: string;
  name: string;
  country: string;
  city: string;
  district: string;
  address: string;
  description: string;
  latitude: number;
  longitude: number;
};

export type ResourceAsset = {
  id: string;
  title: string;
  description: string;
  audience: 'member' | 'partner' | 'store' | 'all';
  category: string;
  href: string;
  type: 'file' | 'video' | 'image' | 'link';
  thumbnailUrl?: string;
};

export type StoryHighlight = {
  id: string;
  title: string;
  description: string;
  category: string;
  date: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
};

export type ShowcaseAsset = {
  id: string;
  title: string;
  description: string;
  href: string;
  type: 'video' | 'image' | 'file';
  thumbnailUrl?: string;
};

export const storeLocations: StoreLocation[] = [
  {
    id: 'legacy-store-1',
    name: '上海市金山区富皿皿医疗器械',
    country: '中国大陆',
    city: '上海',
    district: '上海市',
    address: '中国大陆 上海 上海市',
    description: '中国大陆 / 上海',
    latitude: 30.8259821,
    longitude: 121.1739017,
  },
  {
    id: 'legacy-store-2',
    name: '苏州市永金商业广场',
    country: '中国大陆',
    city: '苏州',
    district: '苏州市',
    address: '中国大陆 苏州 苏州市',
    description: '中国大陆 / 苏州',
    latitude: 31.35246,
    longitude: 120.62248,
  },
  {
    id: 'legacy-store-3',
    name: '福建平潭',
    country: '中国大陆',
    city: '福建',
    district: '中国大陆',
    address: '中国大陆 福建',
    description: '中国大陆 / 福建',
    latitude: 25.4987599,
    longitude: 119.7901,
  },
  {
    id: 'legacy-store-4',
    name: '屏东万巒身心障礙福利中心',
    country: '台湾',
    city: '屏东',
    district: '糙米-南公司分佈',
    address: '糙米-南公司分佈 屏东',
    description: '糙米-南公司分佈 / 屏东',
    latitude: 22.5747743,
    longitude: 120.591202,
  },
  {
    id: 'legacy-store-5',
    name: '嘉义中和路吴民意代表',
    country: '台湾',
    city: '嘉义',
    district: '糙米-南公司分佈',
    address: '糙米-南公司分佈 嘉义',
    description: '糙米-南公司分佈 / 嘉义',
    latitude: 23.4292246,
    longitude: 120.3992176,
  },
  {
    id: 'legacy-store-6',
    name: '屏东内埔',
    country: '台湾',
    city: '屏东',
    district: '屏东县内埔乡',
    address: '屏东县内埔乡新胜路85号',
    description: '屏东县内埔乡新胜路85号',
    latitude: 22.6016203,
    longitude: 120.5807952,
  },
  {
    id: 'legacy-store-7',
    name: '屏东新胜路',
    country: '台湾',
    city: '屏东',
    district: '糙米-南公司分佈',
    address: '糙米-南公司分佈 屏东',
    description: '糙米-南公司分佈 / 屏东',
    latitude: 22.6728998,
    longitude: 120.5979065,
  },
  {
    id: 'legacy-store-8',
    name: '精明二街63号总管理处',
    country: '台湾',
    city: '台中',
    district: '台中西区',
    address: '台中市西区精明二街63号',
    description: '糙米-中公司分佈 / 台中',
    latitude: 24.1559789,
    longitude: 120.6552493,
  },
  {
    id: 'legacy-store-9',
    name: '乐群街11号',
    country: '台湾',
    city: '台中',
    district: '台中西区',
    address: '台中市西区乐群街11号',
    description: '糙米-中公司分佈 / 台中',
    latitude: 24.1399965,
    longitude: 120.6736919,
  },
  {
    id: 'legacy-store-10',
    name: '市府路安親协会',
    country: '台湾',
    city: '台中',
    district: '台中中区',
    address: '台中市中区市府路',
    description: '糙米-中公司分佈 / 台中',
    latitude: 24.1414569,
    longitude: 120.6819412,
  },
  {
    id: 'legacy-store-11',
    name: '台中和平区環山天主堂',
    country: '台湾',
    city: '台中',
    district: '台中和平区',
    address: '糙米-中公司分佈 台中 台中和平区',
    description: '糙米-中公司分佈 / 台中',
    latitude: 24.3189581,
    longitude: 121.2950788,
  },
  {
    id: 'legacy-store-12',
    name: '彰化溪州',
    country: '台湾',
    city: '彰化',
    district: '糙米-中公司分佈',
    address: '糙米-中公司分佈 彰化',
    description: '糙米-中公司分佈 / 彰化',
    latitude: 23.8519937,
    longitude: 120.494826,
  },
  {
    id: 'legacy-store-13',
    name: '金檜传说',
    country: '台湾',
    city: '糙米-中公司分佈',
    district: '糙米-中公司分佈',
    address: '糙米-中公司分佈',
    description: '糙米-中公司分佈',
    latitude: 24.148437,
    longitude: 120.6488259,
  },
  {
    id: 'legacy-store-14',
    name: '台北中和',
    country: '台湾',
    city: '台北',
    district: '糙米-北公司分佈',
    address: '糙米-北公司分佈 台北',
    description: '糙米-北公司分佈 / 台北',
    latitude: 25.0975577,
    longitude: 121.4450217,
  },
  {
    id: 'legacy-store-15',
    name: '中坜順德幼儿园',
    country: '台湾',
    city: '糙米-北公司分佈',
    district: '糙米-北公司分佈',
    address: '糙米-北公司分佈',
    description: '糙米-北公司分佈',
    latitude: 24.9876264,
    longitude: 121.2218358,
  },
  {
    id: 'legacy-store-16',
    name: '台北信义区',
    country: '台湾',
    city: '台北',
    district: '台北信义区',
    address: '糙米-北公司分佈 台北 台北信义区',
    description: '糙米-北公司分佈 / 台北',
    latitude: 25.1484678,
    longitude: 121.729339,
  },
  {
    id: 'legacy-store-17',
    name: '師大路光之寓所',
    country: '台湾',
    city: '糙米-北公司分佈',
    district: '糙米-北公司分佈',
    address: '糙米-北公司分佈',
    description: '糙米-北公司分佈',
    latitude: 36.2439925,
    longitude: 120.0791511,
  },
  {
    id: 'legacy-store-18',
    name: 'Green Star Building',
    country: '越南',
    city: '越南',
    district: '越南',
    address: '越南',
    description: '越南',
    latitude: 10.8077911,
    longitude: 106.6092663,
  },
  {
    id: 'legacy-store-19',
    name: '花蓮順興路',
    country: '台湾',
    city: '花蓮',
    district: '糙米-东公司分佈',
    address: '糙米-东公司分佈 花蓮',
    description: '糙米-东公司分佈 / 花蓮',
    latitude: 23.9944442,
    longitude: 121.6254555,
  },
  {
    id: 'legacy-store-20',
    name: '台东知本大師体验点',
    country: '台湾',
    city: '台东',
    district: '糙米-东公司分佈',
    address: '糙米-东公司分佈 台东',
    description: '糙米-东公司分佈 / 台东',
    latitude: 22.7100299,
    longitude: 121.0247769,
  },
];

export const showcaseAssets: ShowcaseAsset[] = [
  {
    id: 'device-showcase',
    title: '产品展示影片',
    description: '原主页产品展示影片，作为首页第一印象素材。',
    href: '/device-showcase.mp4',
    type: 'video',
  },
  {
    id: 'frequency-health-talk',
    title: '频率密码健康仪演讲影片',
    description: '对外简报、代理说明与门店教育可使用的演讲素材。',
    href: '/legacy-assets/videos/frequency-health-talk.mp4',
    type: 'video',
  },
  {
    id: 'health-guard-polish-test',
    title: 'AI 健康卫兵展示影片',
    description: '去字与质感强化影片，保留作为花絮与展示素材。',
    href: '/legacy-assets/videos/health-guard-polish-test.mp4',
    type: 'video',
  },
  {
    id: 'wavelength-report-preview',
    title: '波长检测报告照片',
    description: '检测报告页面预览，可作为产品佐证素材。',
    href: '/legacy-assets/images/wavelength-report-01.jpg',
    type: 'image',
    thumbnailUrl: '/legacy-assets/images/wavelength-report-01.jpg',
  },
];

export const storyHighlights: StoryHighlight[] = [
  {
    id: 'device-showcase-story',
    title: '产品展示影片回到主页',
    description: '原本主页喜歡的设备展示影片已恢复，首页可直接播放並导向网点体验。',
    category: '产品展示',
    date: '2026-07-17',
    mediaUrl: '/device-showcase.mp4',
    mediaType: 'video',
  },
  {
    id: 'frequency-talk-story',
    title: '频率密码健康仪演讲素材',
    description: '保留对外说明、代理招商、门店教育训练可用的影片内容。',
    category: '活动影片',
    date: '2026-07-17',
    mediaUrl: '/legacy-assets/videos/frequency-health-talk.mp4',
    mediaType: 'video',
  },
  {
    id: 'certificate-story',
    title: '检测报告与专利素材',
    description: '重新放回波长检测、EMC 报告、专利证书与非医疗器械证明等资料入口。',
    category: '资料佐证',
    date: '2026-07-17',
    mediaUrl: '/legacy-assets/images/patent-certificate-01.jpg',
    mediaType: 'image',
  },
];

export const resourceAssets: ResourceAsset[] = [
  {
    id: 'richsmart-brochure',
    title: '糙米三折页 DM',
    description: '品牌介紹、产品定位与对外展示资料。',
    audience: 'all',
    category: '品牌素材',
    href: '/legacy-assets/docs/richsmart-brochure.pdf',
    type: 'file',
  },
  {
    id: 'frequency-health-cooperation-plan',
    title: '频率密码健康科技合作计划书',
    description: '合作模式、设备投放、代理与销售沟通可用文件。',
    audience: 'partner',
    category: '合作文件',
    href: '/legacy-assets/docs/frequency-health-cooperation-plan.pdf',
    type: 'file',
  },
  {
    id: 'non-medical-device-proof',
    title: '卫福部健康卫兵 1.0 非医疗器械监管证明',
    description: '对外说明产品合规定位时可引用的证明资料。',
    audience: 'partner',
    category: '合规证明',
    href: '/legacy-assets/docs/non-medical-device-proof.pdf',
    type: 'file',
  },
  {
    id: 'emc-report',
    title: '产品 EMC 检测报告 EN55014',
    description: '产品检测佐证文件，提供给代理、店家与合作方查阅。',
    audience: 'store',
    category: '检测报告',
    href: '/legacy-assets/docs/emc-report-en55014.pdf',
    type: 'file',
  },
  {
    id: 'wavelength-report-image',
    title: '波长检测报告预览',
    description: '检测报告图片预览，适合首页、花絮墙与简报引用。',
    audience: 'all',
    category: '检测报告',
    href: '/legacy-assets/images/wavelength-report-01.jpg',
    type: 'image',
    thumbnailUrl: '/legacy-assets/images/wavelength-report-01.jpg',
  },
  {
    id: 'patent-certificate-image',
    title: '经济部专利证书预览',
    description: '专利证书图片素材，作为产品与品牌信任资料。',
    audience: 'all',
    category: '专利证书',
    href: '/legacy-assets/images/patent-certificate-01.jpg',
    type: 'image',
    thumbnailUrl: '/legacy-assets/images/patent-certificate-01.jpg',
  },
  {
    id: 'frequency-health-talk-video',
    title: '频率密码健康仪演讲影片',
    description: '可播放影片素材，供代理招商、活动回顾与门店培训使用。',
    audience: 'partner',
    category: '活动影片',
    href: '/legacy-assets/videos/frequency-health-talk.mp4',
    type: 'video',
  },
  {
    id: 'wechat-official-account',
    title: '信海 9318 公众号 QR',
    description: '微信公众号入口图片，供大陆站、公众号导流与客服入口使用。',
    audience: 'all',
    category: '微信整合',
    href: '/legacy-assets/images/wechat-official-account-qr.jpg',
    type: 'image',
    thumbnailUrl: '/legacy-assets/images/wechat-official-account-qr.jpg',
  },
  {
    id: 'vendor-product-submit',
    title: '厂商自主上架入口',
    description: '厂商可自行上架商品、填价格、设定推荐利润、撰写产品页，送平台审核。',
    audience: 'partner',
    category: '商城上架',
    href: '/vendor/products/new',
    type: 'link',
  },
];

export function buildMapUrl(store: StoreLocation) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${store.latitude},${store.longitude}`
  )}`;
}
