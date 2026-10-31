import chinaRegionData from '@province-city-china/data';

export type ChinaRegionOption = { code: string; name: string };

type RegionRecord = {
  code: string;
  name: string;
  province: string | number;
  city: string | number;
  area: string | number;
  town: string | number;
};

const records = chinaRegionData as RegionRecord[];
const municipalities = new Set(['11', '12', '31', '50']);

function zero(value: string | number) {
  return Number(value) === 0;
}

export function listChinaProvinces(): ChinaRegionOption[] {
  return records
    .filter((item) => zero(item.city) && zero(item.area) && zero(item.town))
    .map((item) => ({ code: item.code, name: item.name }));
}

export function listChinaCities(provinceCode: string): ChinaRegionOption[] {
  const province = provinceCode.slice(0, 2);
  const provinceName = records.find((item) => item.code === `${province}0000`)?.name || '';
  const cities = records
    .filter((item) => String(item.province) === province && !zero(item.city) && zero(item.area) && zero(item.town))
    .map((item) => ({ code: item.code, name: item.name }));
  const cityGroups = new Set(
    records
      .filter((item) => String(item.province) === province && !zero(item.city) && !zero(item.area) && zero(item.town))
      .map((item) => String(item.city).padStart(2, '0')),
  );
  const known = new Set(cities.map((item) => item.code.slice(0, 4)));
  for (const city of Array.from(cityGroups)) {
    if (known.has(`${province}${city}`)) continue;
    cities.push({
      code: `${province}${city}00`,
      name: municipalities.has(province) ? provinceName : '省直辖县级行政区划',
    });
  }
  return cities.sort((a, b) => a.code.localeCompare(b.code));
}

export function listChinaDistricts(cityCode: string): ChinaRegionOption[] {
  const province = cityCode.slice(0, 2);
  const city = cityCode.slice(2, 4);
  return records
    .filter((item) => String(item.province) === province && String(item.city).padStart(2, '0') === city && !zero(item.area) && zero(item.town))
    .map((item) => ({ code: item.code, name: item.name }));
}
