import React, { useState, useEffect, useRef } from 'react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  ReferenceLine,
  ScatterChart,
  Scatter,
} from 'recharts';
import './App.css';

export interface SolarIntervalRecord {
  timestamp: string; // 標準日時フォーマット: YYYY-MM-DD HH:mm
  yearMonth: string; // 例: 2026年9月
  date: string; // 例: 9月1日
  generation: number; // 発電 (kWh) = 発電 (kW) / 4
  toBuilding: number; // 建物へ (kWh) = 建物へ (kW) / 4
  toGrid: number; // 系統へ (kWh) = 系統へ (kW) / 4
  consumption: number; // 消費 (kWh) = 消費 (kW) / 4
  solarFrom: number; // 太陽光から (kWh) = 太陽光から (kW) / 4
  gridFrom: number; // 系統から (kWh) = 系統から (kW) / 4
  sunlight: number; // 該当日の日照時間 (時間)
}

interface MonthlyDataItem {
  month: string;
  actual: number | null;
  selfSufficiency: number;
}

interface DailyDataItem {
  yearMonth: string;
  date: string;
  generation: number;
  consumption: number;
  solarFrom: number;
  gridFrom: number;
  sunlight: number;
}

export interface ElectricityRate {
  id: string;
  startDate: string; // 適用開始日 "YYYY-MM-DD"
  summerPeakRate: number; // 夏季ピーク(円/kWh, 7/1〜9/30の平日 13:00〜16:00)
  summerDayRate: number; // 夏季昼間(円/kWh, 7/1〜9/30の平日 08:00〜13:00, 16:00〜22:00)
  otherDayRate: number; // その他季昼間(円/kWh, 10/1〜翌6/30の平日・土曜 08:00〜22:00)
  nightRate: number; // 夜間・休日(円/kWh, 全期間の夜間 22:00〜翌08:00、および日曜・祝日の終日)
  renewableRate: number; // 再エネ賦課金(円/kWh)
  baseDiscount: number; // 基本料金削減効果(円/月)
}

export interface InvestmentItem {
  id: string;
  date: string; // 発生年月 (例: "2026-04", "2026-10", "2031-05")
  category: string; // 区分 (例: "初期設備投資", "設備増設", "パワコン更新", "定期保守費", "補助金(控除)")
  title: string; // 項目名 (例: "初期設置工事一式", "パネル倍増工事", "PCS入替え")
  amount: number; // 金額 (円) ※補助金の場合はマイナス入力可能
  notes?: string; // 備考
}

const DEFAULT_ELECTRICITY_RATES: ElectricityRate[] = [
  {
    id: 'rate-2026-04-01',
    startDate: '2026-04-01',
    summerPeakRate: 21.45,
    summerDayRate: 18.98,
    otherDayRate: 18.03,
    nightRate: 16.88,
    renewableRate: 4.18,
    baseDiscount: 15000,
  },
];

const DEFAULT_INVESTMENTS: InvestmentItem[] = [
  {
    id: 'inv-1',
    date: '2026-04',
    category: '初期設備投資',
    title: '初期設置工事一式',
    amount: 10000000,
    notes: '太陽光発電設備初期導入工事',
  },
  {
    id: 'inv-2',
    date: '2026-10',
    category: '設備増設',
    title: 'パネル増設工事',
    amount: 5000000,
    notes: '追加パネル増設工事',
  },
  {
    id: 'inv-3',
    date: '2026-04',
    category: '補助金(控除)',
    title: '導入促進補助金',
    amount: -2000000,
    notes: '導入促進補助金（控除）',
  },
];

const INVESTMENT_CATEGORIES = [
  '初期設備投資',
  '設備増設',
  'パワコン更新',
  '定期保守費',
  '補助金(控除)',
  'その他',
];

/**
 * 年月文字列（"2026-4", "2026年4月", "2026/04" 等）を標準の "YYYY-MM" 形式に正規化する関数
 */
const normalizeYearMonth = (rawYm: string): string => {
  const match = rawYm.trim().match(/(\d{4})[年/\-]0?(\d{1,2})/);
  if (!match) return rawYm.trim();
  const y = match[1];
  const m = String(parseInt(match[2], 10)).padStart(2, '0');
  return `${y}-${m}`;
};

/**
 * 日付文字列（"YYYY-MM-DD", "YYYY年MM月DD日", "YYYY/MM/DD", "YYYY-MM" 等）を標準の "YYYY-MM-DD" 形式に正規化する関数
 */
const normalizeDateString = (rawDate: string): string => {
  const trimmed = rawDate.trim();
  const ymdMatch = trimmed.match(/(\d{4})[年/\-]0?(\d{1,2})[月/\-]0?(\d{1,2})/);
  if (ymdMatch) {
    const y = ymdMatch[1];
    const m = String(parseInt(ymdMatch[2], 10)).padStart(2, '0');
    const d = String(parseInt(ymdMatch[3], 10)).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const ymMatch = trimmed.match(/(\d{4})[年/\-]0?(\d{1,2})/);
  if (ymMatch) {
    const y = ymMatch[1];
    const m = String(parseInt(ymMatch[2], 10)).padStart(2, '0');
    return `${y}-${m}-01`;
  }
  return trimmed;
};

/**
 * 測定日（dateStr: "YYYY-MM-DD"）以前で最も新しい startDate を持つ単価セットを取得する関数
 */
const getApplicableRateForDate = (
  dateStr: string,
  rates: ElectricityRate[]
): ElectricityRate => {
  const normDate = normalizeDateString(dateStr);
  const fallback = DEFAULT_ELECTRICITY_RATES[0];
  if (!rates || rates.length === 0) return fallback;

  const sorted = [...rates].sort((a, b) =>
    normalizeDateString(a.startDate).localeCompare(normalizeDateString(b.startDate))
  );

  const eligible = sorted.filter((r) => normalizeDateString(r.startDate) <= normDate);
  if (eligible.length > 0) {
    return eligible[eligible.length - 1];
  }
  return sorted[0];
};

/**
 * 指定年月（year, month）時点で有効な単価（月の代表日時点の最新単価）を取得する関数
 */
const getApplicableRateForMonth = (
  year: number | string,
  month: number | string,
  rates: ElectricityRate[]
): ElectricityRate => {
  const targetDate = `${year}-${String(month).padStart(2, '0')}-28`;
  return getApplicableRateForDate(targetDate, rates);
};

/**
 * 日本の国民の祝日・振替休日・国民の休日を正確に算出・判定する関数（国民の祝日法準拠）
 */
const getJapaneseHolidays = (year: number): Set<string> => {
  const holidays = new Set<string>();
  const addH = (m: number, d: number) => {
    holidays.add(`${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  };

  // 固定祝日
  addH(1, 1); // 元日
  addH(2, 11); // 建国記念の日
  addH(2, 23); // 天皇誕生日
  addH(4, 29); // 昭和の日
  addH(5, 3); // 憲法記念日
  addH(5, 4); // みどりの日
  addH(5, 5); // こどもの日
  addH(8, 11); // 山の日
  addH(11, 3); // 文化の日
  addH(11, 23); // 勤労感謝の日

  // ハッピーマンデー（指定月の第n月曜日）
  const getNthMonday = (m: number, n: number): number => {
    let count = 0;
    for (let d = 1; d <= 31; d++) {
      const dt = new Date(year, m - 1, d);
      if (dt.getMonth() !== m - 1) break;
      if (dt.getDay() === 1) {
        count++;
        if (count === n) return d;
      }
    }
    return 0;
  };

  const adultDay = getNthMonday(1, 2);
  if (adultDay) addH(1, adultDay); // 成人の日

  const seaDay = getNthMonday(7, 3);
  if (seaDay) addH(7, seaDay); // 海の日

  const agedDay = getNthMonday(9, 3);
  if (agedDay) addH(9, agedDay); // 敬老の日

  const sportsDay = getNthMonday(10, 2);
  if (sportsDay) addH(10, sportsDay); // スポーツの日

  // 春分の日・秋分の日（天文計算による略算式）
  const springEquinox = Math.floor(
    20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4)
  );
  const autumnEquinox = Math.floor(
    23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4)
  );
  addH(3, springEquinox);
  addH(9, autumnEquinox);

  // 国民の休日（祝日と祝日に挟まれた平日）
  for (let m = 1; m <= 12; m++) {
    for (let d = 2; d <= 30; d++) {
      const prevKey = `${year}-${String(m).padStart(2, '0')}-${String(d - 1).padStart(2, '0')}`;
      const nextKey = `${year}-${String(m).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`;
      const curKey = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dt = new Date(year, m - 1, d);
      if (
        holidays.has(prevKey) &&
        holidays.has(nextKey) &&
        !holidays.has(curKey) &&
        dt.getDay() !== 0
      ) {
        holidays.add(curKey);
      }
    }
  }

  // 振替休日（祝日が日曜日の場合、その後の国民の祝日でない最初の日）
  const baseHolidays = Array.from(holidays);
  for (const hStr of baseHolidays) {
    const parts = hStr.split('-').map(Number);
    const m = parts[1];
    const d = parts[2];
    const dt = new Date(year, m - 1, d);
    if (dt.getDay() === 0) {
      let subD = d + 1;
      let subDt = new Date(year, m - 1, subD);
      let subKey = `${year}-${String(subDt.getMonth() + 1).padStart(2, '0')}-${String(
        subDt.getDate()
      ).padStart(2, '0')}`;
      while (holidays.has(subKey)) {
        subD++;
        subDt = new Date(year, m - 1, subD);
        subKey = `${year}-${String(subDt.getMonth() + 1).padStart(2, '0')}-${String(
          subDt.getDate()
        ).padStart(2, '0')}`;
      }
      holidays.add(subKey);
    }
  }

  return holidays;
};

const holidayCache = new Map<number, Set<string>>();
export const isJapaneseHoliday = (year: number, month: number, day: number): boolean => {
  if (!holidayCache.has(year)) {
    holidayCache.set(year, getJapaneseHolidays(year));
  }
  const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return holidayCache.get(year)!.has(key);
};

export type TimeRateType = 'summerPeak' | 'summerDay' | 'otherDay' | 'night';

export interface RecordRateEvaluation {
  rateType: TimeRateType;
  rateName: string;
  unitPrice: number;
  applicableRate: ElectricityRate;
}

/**
 * 15分値レコードの測定日時（タイムスタンプ）から、曜日・祝日・季節・時間帯を総合判定し、
 * 契約上の適用単価（円/kWh）および区分を決定する関数
 *
 * 【時間帯判定ルール】
 * 1. 日曜日、または国民の祝日の場合（終日夜間扱い）：
 *    - 24時間すべての自家消費量に nightRate (16.88円) を適用
 * 2. 平日・土曜日の場合：
 *    - 夜間（22:00〜翌07:45）➔ nightRate (16.88円)
 *    - 昼間（08:00〜21:45）のうち：
 *      * 夏季（7/1〜9/30）の平日 13:00〜15:45 ➔ summerPeakRate (21.45円)
 *      * 夏季（7/1〜9/30）の上記以外（平日8-13,16-22時および土曜） ➔ summerDayRate (18.98円)
 *      * その他季（10/1〜翌6/30）➔ otherDayRate (18.03円)
 */
export const evaluateRecordRate = (
  timestamp: string,
  rates: ElectricityRate[]
): RecordRateEvaluation => {
  const match = timestamp.match(
    /(\d{4})[年/\-]0?(\d{1,2})[月/\-]0?(\d{1,2})日?(?:[\sT]+(\d{1,2}):(\d{2}))?/
  );
  let year = 2026;
  let month = 4;
  let day = 1;
  let hour = 12;
  let minute = 0;

  if (match) {
    year = parseInt(match[1], 10);
    month = parseInt(match[2], 10);
    day = parseInt(match[3], 10);
    hour = match[4] ? parseInt(match[4], 10) : 0;
    minute = match[5] ? parseInt(match[5], 10) : 0;
  }

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const applicableRate = getApplicableRateForDate(dateStr, rates);

  const dt = new Date(year, month - 1, day);
  const dayOfWeek = dt.getDay(); // 0: 日曜, 1: 月曜, ..., 6: 土曜
  const isSunday = dayOfWeek === 0;
  const isHoliday = isJapaneseHoliday(year, month, day);

  // ルール1: 日曜日、または国民の祝日の場合（終日夜間扱い）
  if (isSunday || isHoliday) {
    return {
      rateType: 'night',
      rateName: isHoliday ? '祝日(終日夜間)' : '日曜(終日夜間)',
      unitPrice: applicableRate.nightRate,
      applicableRate,
    };
  }

  // ルール2: 平日・土曜日の場合
  const totalMinutes = hour * 60 + minute;
  // 昼間判定: 08:00〜21:45 (480分 〜 1305分)
  const isDaytime = totalMinutes >= 8 * 60 && totalMinutes <= 21 * 60 + 45;

  if (!isDaytime) {
    return {
      rateType: 'night',
      rateName: '夜間(22:00-08:00)',
      unitPrice: applicableRate.nightRate,
      applicableRate,
    };
  }

  // 夏季判定: 7月1日〜9月30日
  const isSummer = month >= 7 && month <= 9;
  if (isSummer) {
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    const isPeakHours = totalMinutes >= 13 * 60 && totalMinutes < 16 * 60; // 13:00〜15:45 (16:00未満)

    if (isWeekday && isPeakHours) {
      return {
        rateType: 'summerPeak',
        rateName: '夏季ピーク(平日13-16)',
        unitPrice: applicableRate.summerPeakRate,
        applicableRate,
      };
    }

    return {
      rateType: 'summerDay',
      rateName: '夏季昼間',
      unitPrice: applicableRate.summerDayRate,
      applicableRate,
    };
  }

  // その他季（10月1日〜翌6月30日）
  return {
    rateType: 'otherDay',
    rateName: 'その他季昼間',
    unitPrice: applicableRate.otherDayRate,
    applicableRate,
  };
};

const SIMULATION_DATA: Record<number, number> = {
  1: 3582,
  2: 4423,
  3: 6061,
  4: 6446,
  5: 6768,
  6: 5208,
  7: 6641,
  8: 6996,
  9: 6548,
  10: 5605,
  11: 4150,
  12: 3637,
};

const EN_MONTH_MAP: Record<string, number> = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
};

/**
 * ダブルクォーテーション内のカンマを無視してCSVの1行を分割する関数
 */
const parseCSVLine = (line: string): string[] => {
  const cols: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      inQuote = !inQuote;
    } else if (line[i] === ',' && !inQuote) {
      cols.push(cur.trim());
      cur = '';
    } else {
      cur += line[i];
    }
  }
  cols.push(cur.trim());
  return cols;
};

/**
 * カンマ区切り等を含む数値文字列を安全に数値へ変換する関数
 */
const parseNumberValue = (val: string | undefined): number => {
  if (!val) return 0;
  const cleaned = val.replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
};

/**
 * 測定時間（例: "2026年9月1日 00:15", "2026-09-01 00:15", "Sep 1, 2026 12:15 AM" 等）を解析し、
 * 標準日時フォーマット（YYYY-MM-DD HH:mm）やその行自身の正確な年・月・日ラベルに変換する関数
 */
const parseMeasurementTime = (
  rawTime: string
): {
  timestamp: string;
  epochMs: number;
  year: number;
  month: number;
  day: number;
  yearStr: string;
  monthStr: string;
  yearMonth: string;
  dateLabel: string;
} | null => {
  const trimmed = rawTime.trim();
  if (!trimmed) return null;

  let year: number | null = null;
  let month: number | null = null;
  let day: number | null = null;
  let hour = 0;
  let minute = 0;

  // パターン1: "2026年9月1日 00:15", "2026-09-01 00:15", "2026/09/01 0:15"
  const jpOrIsoMatch = trimmed.match(
    /^(\d{4})[年/\-]0?(\d{1,2})[月/\-]0?(\d{1,2})日?(?:[\sT]+(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*(AM|PM|am|pm))?)?/
  );

  // パターン2: 英語月表記 "Sep 1, 2026 12:15 AM"
  const enMatch = trimmed.match(
    /^([A-Za-z]{3})\s+0?(\d{1,2}),?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*(AM|PM|am|pm))?)?/
  );

  if (jpOrIsoMatch) {
    year = parseInt(jpOrIsoMatch[1], 10);
    month = parseInt(jpOrIsoMatch[2], 10);
    day = parseInt(jpOrIsoMatch[3], 10);
    hour = jpOrIsoMatch[4] ? parseInt(jpOrIsoMatch[4], 10) : 0;
    minute = jpOrIsoMatch[5] ? parseInt(jpOrIsoMatch[5], 10) : 0;
    const ampm = jpOrIsoMatch[6]?.toUpperCase();
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
  } else if (enMatch) {
    const monthKey =
      enMatch[1].charAt(0).toUpperCase() + enMatch[1].slice(1, 3).toLowerCase();
    const mappedMonth = EN_MONTH_MAP[monthKey];
    if (!mappedMonth) return null;
    month = mappedMonth;
    day = parseInt(enMatch[2], 10);
    year = parseInt(enMatch[3], 10);
    hour = enMatch[4] ? parseInt(enMatch[4], 10) : 0;
    minute = enMatch[5] ? parseInt(enMatch[5], 10) : 0;
    const ampm = enMatch[6]?.toUpperCase();
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
  } else {
    const fallback = new Date(trimmed);
    if (isNaN(fallback.getTime())) return null;
    year = fallback.getFullYear();
    month = fallback.getMonth() + 1;
    day = fallback.getDate();
    hour = fallback.getHours();
    minute = fallback.getMinutes();
  }

  if (!year || !month || !day) return null;

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${year}-${pad2(month)}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}`;
  const epochMs = new Date(year, month - 1, day, hour, minute).getTime();

  return {
    timestamp,
    epochMs,
    year,
    month,
    day,
    yearStr: String(year),
    monthStr: String(month),
    yearMonth: `${year}年${month}月`,
    dateLabel: `${month}月${day}日`,
  };
};

/**
 * 日付文字列（例: "9月15日", "2026/09/15"）から「月」と「日」の数値を抽出するヘルパー関数
 */
const extractMonthAndDay = (dateStr: string): { month: number | null; day: number | null } => {
  const jpMatch = dateStr.match(/0?(\d{1,2})月0?(\d{1,2})日/);
  if (jpMatch) {
    return { month: parseInt(jpMatch[1], 10), day: parseInt(jpMatch[2], 10) };
  }
  const slashMatch = dateStr.match(/(?:\d{4}[/\-])?0?(\d{1,2})[/\-]0?(\d{1,2})/);
  if (slashMatch) {
    return { month: parseInt(slashMatch[1], 10), day: parseInt(slashMatch[2], 10) };
  }
  const dayOnlyMatch = dateStr.match(/(\d+)[^0-9]*$/);
  return {
    month: null,
    day: dayOnlyMatch ? parseInt(dayOnlyMatch[1], 10) : null,
  };
};

/**
 * 【重要】日次データが指定された年・月（selectedYear, selectedMonth）に一致するかを厳格に判定する関数
 * yearMonth の一致に加え、date 文字列内の「月」も一致しているか二重チェックすることで他月データの混入を完全に防ぐ
 */
const isStrictMatchingYearMonth = (
  item: DailyDataItem | SolarIntervalRecord,
  year: string | number,
  month: string | number
): boolean => {
  const yNum = Number(year);
  const mNum = Number(month);
  if (isNaN(yNum) || isNaN(mNum)) return false;

  const ymMatch = item.yearMonth.match(/(\d{4})年0?(\d{1,2})月/);
  if (!ymMatch) return false;

  const itemYear = parseInt(ymMatch[1], 10);
  const itemMonth = parseInt(ymMatch[2], 10);
  if (itemYear !== yNum || itemMonth !== mNum) return false;

  const { month: dateMonth } = extractMonthAndDay(item.date);
  if (dateMonth !== null && dateMonth !== mNum) {
    return false;
  }

  return true;
};

/**
 * 日次データが指定された年（selectedYear）に一致し、かつ date の月と yearMonth の月が整合しているかを判定する関数
 */
const isStrictMatchingYear = (
  item: DailyDataItem | SolarIntervalRecord,
  year: string | number
): boolean => {
  const yNum = Number(year);
  if (isNaN(yNum)) return false;

  const ymMatch = item.yearMonth.match(/(\d{4})年0?(\d{1,2})月/);
  if (!ymMatch) return false;

  const itemYear = parseInt(ymMatch[1], 10);
  const itemMonth = parseInt(ymMatch[2], 10);
  if (itemYear !== yNum) return false;

  const { month: dateMonth } = extractMonthAndDay(item.date);
  if (dateMonth !== null && dateMonth !== itemMonth) {
    return false;
  }

  return true;
};

/**
 * FileReader を Promise でラップして非同期にファイルを読み込む関数
 */
/**
 * 15分値レコード（timestamp を保持）かどうかを判定する型ガード関数
 */
export const isIntervalRecord = (
  item: SolarIntervalRecord | DailyDataItem
): item is SolarIntervalRecord => {
  return 'timestamp' in item;
};

/**
 * allDailyData（15分値レコードまたは日次データ）から、全期間の日次集計データを生成するヘルパー関数
 */
export const getAllAggregatedDailyData = (
  records: (SolarIntervalRecord | DailyDataItem)[]
): DailyDataItem[] => {
  const intervals = records.filter(isIntervalRecord);
  const dailies = records.filter((r): r is DailyDataItem => !isIntervalRecord(r));

  if (intervals.length === 0) {
    return dailies;
  }

  const aggMap = new Map<
    string,
    {
      yearMonth: string;
      date: string;
      day: number;
      generation: number;
      consumption: number;
      solarFrom: number;
      gridFrom: number;
      sunlight: number;
    }
  >();

  for (const rec of intervals) {
    const { day } = extractMonthAndDay(rec.date);
    const key = `${rec.yearMonth}_${rec.date}`;
    const prev = aggMap.get(key) || {
      yearMonth: rec.yearMonth,
      date: rec.date,
      day: day ?? 0,
      generation: 0,
      consumption: 0,
      solarFrom: 0,
      gridFrom: 0,
      sunlight: 0,
    };
    prev.generation += rec.generation;
    prev.consumption += rec.consumption;
    prev.solarFrom += rec.solarFrom;
    prev.gridFrom += rec.gridFrom;
    if (rec.sunlight > 0) prev.sunlight = rec.sunlight;
    aggMap.set(key, prev);
  }

  const intervalDailies: DailyDataItem[] = Array.from(aggMap.values())
    .sort((a, b) => a.day - b.day)
    .map((d) => ({
      yearMonth: d.yearMonth,
      date: d.date,
      generation: Math.round(d.generation),
      consumption: Math.round(d.consumption),
      solarFrom: Math.round(d.solarFrom),
      gridFrom: Math.round(d.gridFrom),
      sunlight: d.sunlight,
    }));

  const existingKeys = new Set(intervalDailies.map((d) => `${d.yearMonth}_${d.date}`));
  const remainingDailies = dailies.filter(
    (d) => !existingKeys.has(`${d.yearMonth}_${d.date}`)
  );

  return [...intervalDailies, ...remainingDailies];
};

const readFileAsText = (file: File): Promise<{ fileName: string; text: string }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = (event.target?.result as string) || '';
      resolve({ fileName: file.name, text });
    };
    reader.onerror = () => {
      reject(new Error(`ファイル "${file.name}" の読み込みに失敗しました。`));
    };
    reader.readAsText(file);
  });
};

export default function App() {
  // 1. ログイン認証ステート（初期値: ID "admin", パスワード "admin123"）
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => {
    try {
      return localStorage.getItem('solar_is_logged_in') === 'true';
    } catch {
      return false;
    }
  });
  const [loginId, setLoginId] = useState('admin');
  const [loginPassword, setLoginPassword] = useState('admin123');
  const [loginError, setLoginError] = useState('');

  const handleLogin = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loginId.trim() === 'admin' && loginPassword === 'admin123') {
      setIsLoggedIn(true);
      setLoginError('');
      try {
        localStorage.setItem('solar_is_logged_in', 'true');
      } catch {
        // ignore storage errors
      }
    } else {
      setLoginError('IDまたはパスワードが正しくありません。（テスト用: admin / admin123）');
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    try {
      localStorage.removeItem('solar_is_logged_in');
    } catch {
      // ignore storage errors
    }
  };

  // 2. 期間指定の電力単価設定ステート＆モーダル管理
  const [electricityRates, setElectricityRates] = useState<ElectricityRate[]>(() => {
    try {
      const saved = localStorage.getItem('solar_electricity_rates');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (
          Array.isArray(parsed) &&
          parsed.length > 0 &&
          parsed[0].summerPeakRate !== undefined &&
          /^\d{4}-\d{2}-\d{2}$/.test(parsed[0].startDate)
        ) {
          return parsed;
        }
      }
    } catch {
      // fallback
    }
    return DEFAULT_ELECTRICITY_RATES;
  });

  useEffect(() => {
    try {
      localStorage.setItem('solar_electricity_rates', JSON.stringify(electricityRates));
    } catch {
      // ignore storage errors
    }
  }, [electricityRates]);

  const rateDialogRef = useRef<HTMLDialogElement>(null);
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [rateForm, setRateForm] = useState({
    startDate: '2026-04-01',
    summerPeakRate: '21.45',
    summerDayRate: '18.98',
    otherDayRate: '18.03',
    nightRate: '16.88',
    renewableRate: '4.18',
    baseDiscount: '15000',
  });

  const resetRateForm = () => {
    setEditingRateId(null);
    setRateForm({
      startDate: `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`,
      summerPeakRate: '21.45',
      summerDayRate: '18.98',
      otherDayRate: '18.03',
      nightRate: '16.88',
      renewableRate: '4.18',
      baseDiscount: '15000',
    });
  };

  const openRateModal = () => {
    resetRateForm();
    rateDialogRef.current?.showModal();
  };

  const closeRateModal = () => {
    rateDialogRef.current?.close();
    setEditingRateId(null);
  };

  const handleEditRate = (rate: ElectricityRate) => {
    setEditingRateId(rate.id);
    setRateForm({
      startDate: normalizeDateString(rate.startDate),
      summerPeakRate: String(rate.summerPeakRate),
      summerDayRate: String(rate.summerDayRate),
      otherDayRate: String(rate.otherDayRate),
      nightRate: String(rate.nightRate),
      renewableRate: String(rate.renewableRate),
      baseDiscount: String(rate.baseDiscount),
    });
  };

  const handleDeleteRate = (id: string) => {
    if (electricityRates.length <= 1) {
      alert('最低1件の単価設定が必要です。');
      return;
    }
    setElectricityRates((prev) => prev.filter((r) => r.id !== id));
    if (editingRateId === id) {
      resetRateForm();
    }
  };

  const handleSaveRate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const normalizedStart = normalizeDateString(rateForm.startDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedStart)) {
      alert('適用開始日を「YYYY-MM-DD」形式で入力してください。');
      return;
    }
    const newRate: ElectricityRate = {
      id: editingRateId || `rate-${Date.now()}`,
      startDate: normalizedStart,
      summerPeakRate: parseFloat(rateForm.summerPeakRate) || 0,
      summerDayRate: parseFloat(rateForm.summerDayRate) || 0,
      otherDayRate: parseFloat(rateForm.otherDayRate) || 0,
      nightRate: parseFloat(rateForm.nightRate) || 0,
      renewableRate: parseFloat(rateForm.renewableRate) || 0,
      baseDiscount: parseFloat(rateForm.baseDiscount) || 0,
    };

    setElectricityRates((prev) => {
      if (editingRateId) {
        return prev.map((r) => (r.id === editingRateId ? newRate : r));
      }
      return [...prev, newRate];
    });
    resetRateForm();
  };

  // 3. 設備投資・経費履歴の管理ステート＆モーダル管理
  const [investments, setInvestments] = useState<InvestmentItem[]>(() => {
    try {
      const saved = localStorage.getItem('solar_investment_items');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // fallback
    }
    return DEFAULT_INVESTMENTS;
  });

  useEffect(() => {
    try {
      localStorage.setItem('solar_investment_items', JSON.stringify(investments));
    } catch {
      // ignore storage errors
    }
  }, [investments]);

  const investmentDialogRef = useRef<HTMLDialogElement>(null);
  const [editingInvestmentId, setEditingInvestmentId] = useState<string | null>(null);
  const [investmentForm, setInvestmentForm] = useState({
    date: '2026-04',
    category: '設備増設',
    title: '',
    amount: '',
    notes: '',
  });

  const resetInvestmentForm = () => {
    setEditingInvestmentId(null);
    setInvestmentForm({
      date: `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`,
      category: '設備増設',
      title: '',
      amount: '',
      notes: '',
    });
  };

  const openInvestmentModal = () => {
    resetInvestmentForm();
    investmentDialogRef.current?.showModal();
  };

  const closeInvestmentModal = () => {
    investmentDialogRef.current?.close();
    setEditingInvestmentId(null);
  };

  const handleEditInvestment = (item: InvestmentItem) => {
    setEditingInvestmentId(item.id);
    setInvestmentForm({
      date: normalizeYearMonth(item.date),
      category: item.category,
      title: item.title,
      amount: String(item.amount),
      notes: item.notes || '',
    });
  };

  const handleDeleteInvestment = (id: string) => {
    setInvestments((prev) => prev.filter((item) => item.id !== id));
    if (editingInvestmentId === id) {
      resetInvestmentForm();
    }
  };

  const handleSaveInvestment = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const normalizedDate = normalizeYearMonth(investmentForm.date);
    if (!/^\d{4}-\d{2}$/.test(normalizedDate)) {
      alert('発生年月を「YYYY-MM」形式で入力してください。');
      return;
    }
    if (!investmentForm.title.trim()) {
      alert('項目名を入力してください。');
      return;
    }
    const parsedAmount = parseFloat(investmentForm.amount);
    if (isNaN(parsedAmount)) {
      alert('有効な金額を入力してください。');
      return;
    }

    const newItem: InvestmentItem = {
      id: editingInvestmentId || `inv-${Date.now()}`,
      date: normalizedDate,
      category: investmentForm.category,
      title: investmentForm.title.trim(),
      amount: parsedAmount,
      notes: investmentForm.notes.trim() || undefined,
    };

    setInvestments((prev) => {
      if (editingInvestmentId) {
        return prev.map((item) => (item.id === editingInvestmentId ? newItem : item));
      }
      return [...prev, newItem];
    });
    resetInvestmentForm();
  };

  // <dialog closedby="any"> 非対応ブラウザ向け Light-Dismiss フォールバック
  useEffect(() => {
    if (typeof HTMLDialogElement === 'undefined') return;
    if ('closedBy' in HTMLDialogElement.prototype) return;

    const dialogs = [rateDialogRef.current, investmentDialogRef.current].filter(
      (d): d is HTMLDialogElement => d !== null
    );

    const handleBackdropClick = (event: MouseEvent) => {
      const dialog = event.currentTarget as HTMLDialogElement;
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const isDialogContent =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (isDialogContent) return;
      dialog.close();
    };

    dialogs.forEach((d) => d.addEventListener('click', handleBackdropClick));
    return () => {
      dialogs.forEach((d) => d.removeEventListener('click', handleBackdropClick));
    };
  }, [isLoggedIn]);

  const [activeTab, setActiveTab] = useState(1);

  // 設備増設シミュレーター用ステート（パネル1枚単位）
  const [simBaseCapacityKw, setSimBaseCapacityKw] = useState<number>(50); // 既設パネル容量 (デフォルト: 50 kW / 約125枚)
  const [simAddedPanels, setSimAddedPanels] = useState<number>(125); // 増設パネル枚数 (デフォルト: +125枚 = +50kW)
  const [simPanelWatt, setSimPanelWatt] = useState<number>(400); // パネル1枚あたりの定格出力 (デフォルト: 400 W)
  const [simInvestManYen, setSimInvestManYen] = useState<number>(500); // 増設にかかる想定費用 (デフォルト: 500 万円)

  const [selectedYear, setSelectedYear] = useState('2026');
  const [selectedMonth, setSelectedMonth] = useState('6');

  const [monthlyData, setMonthlyData] = useState<MonthlyDataItem[]>([]);
  const [allDailyData, setAllDailyData] = useState<(SolarIntervalRecord | DailyDataItem)[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSpreadsheetData();
  }, []);

  const fetchSpreadsheetData = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/solar');
      if (!res.ok) throw new Error('データ取得失敗');
      const data = await res.json();
      if (Array.isArray(data.monthlyData)) {
        setMonthlyData(data.monthlyData);
      }
      if (Array.isArray(data.dailyData)) {
        setAllDailyData(data.dailyData);
      }
    } catch (err) {
      console.error('データ同期エラー:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePrevMonth = () => {
    let y = parseInt(selectedYear, 10);
    let m = parseInt(selectedMonth, 10);
    if (isNaN(m) || isNaN(y)) return;
    if (m === 1) {
      m = 12;
      y -= 1;
    } else {
      m -= 1;
    }
    setSelectedYear(y.toString());
    setSelectedMonth(m.toString());
  };

  const handleNextMonth = () => {
    let y = parseInt(selectedYear, 10);
    let m = parseInt(selectedMonth, 10);
    if (isNaN(m) || isNaN(y)) return;
    if (m === 12) {
      m = 1;
      y += 1;
    } else {
      m += 1;
    }
    setSelectedYear(y.toString());
    setSelectedMonth(m.toString());
  };

  /**
   * 複数の週次15分値CSV（単位: kW）を一括読み込みし、
   * 1. 各パース値を 4 で割って電力量（kWh）へ変換
   * 2. 測定時間で時系列ソート＆重複排除
   * 3. 対象年月（targetYear, targetMonth）を判定し、気象庁API (/api/weather) から牛深観測所の日照時間を取得して統合
   * 4. バックエンド (/api/solar) へ POST 送信
   */
  /**
   * 複数の週次15分値CSV（単位: kW）を一括読み込みし、
   * 1. Promise.all + FileReader で全ファイルを非同期読み込み、ダブルクォーテーション内のカンマを無視して安全にパース
   * 2. ヘッダー検出（測定時間, 発電 (kW), 建物へ (kW), 系統へ (kW), 消費 (kW), 太陽光から (kW), 系統から (kW)）
   *    取得値 (kW) を 4 で割って電力量 (kWh) に変換 (kW / 4)
   * 3. 測定時間を標準日時に変換し、yearMonth（例: "2026年9月"）と date（例: "9月30日"）を付与
   * 4. 時系列ソート＆重複排除（同じ測定時間の行をユニーク化）
   * 5. 月またぎデータの自動仕分け：全年月をグループ化し、各年月の気象庁日照時間取得・日次集計・月次算出・バックエンド保存
   * 6. 結合・重複排除された全データをステート（allDailyData）に保存
   */
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const files = Array.from(fileList);
    setIsLoading(true);

    try {
      console.log(
        `📂 ${files.length} 件の週次CSVファイルの読み込みを開始します:`,
        files.map((f) => f.name)
      );

      // 1. FileReader + Promise.all で全ファイルを非同期に読み込み
      const fileContents = await Promise.all(files.map((file) => readFileAsText(file)));

      const rawIntervalRows: Array<
        SolarIntervalRecord & {
          epochMs: number;
          year: number;
          month: number;
          day: number;
        }
      > = [];

      // 2. 各ファイルのヘッダー解析と15分値 (kW -> kWh) 変換
      for (const { fileName, text } of fileContents) {
        const cleanText = text.replace(/^\uFEFF/, '');
        const lines = cleanText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

        if (lines.length <= 1) {
          console.warn(`⚠️ ファイル "${fileName}" は空のためスキップしました。`);
          continue;
        }

        // ヘッダー行を探す（'測定時間' を含む行）
        let headerLineIdx = -1;
        for (let i = 0; i < Math.min(lines.length, 10); i++) {
          if (lines[i].includes('測定時間')) {
            headerLineIdx = i;
            break;
          }
        }

        if (headerLineIdx === -1) {
          console.warn(`⚠️ ファイル "${fileName}" に『測定時間』ヘッダーが見つかりませんでした。`);
          continue;
        }

        const headers = parseCSVLine(lines[headerLineIdx]).map((h) =>
          h.replace(/^\uFEFF/, '').trim()
        );

        const findHeaderIdx = (targetNames: string[]): number => {
          for (const name of targetNames) {
            const idx = headers.indexOf(name);
            if (idx !== -1) return idx;
          }
          for (const name of targetNames) {
            const cleanName = name.replace(/\s+/g, '');
            const idx = headers.findIndex((h) => h.replace(/\s+/g, '') === cleanName);
            if (idx !== -1) return idx;
          }
          return -1;
        };

        const timeIdx = findHeaderIdx(['測定時間', 'Time', 'Date/Time']);
        const genKwIdx = findHeaderIdx(['発電 (kW)', '発電(kW)', '発電 (kWh)', '発電(kWh)']);
        const toBuildingKwIdx = findHeaderIdx(['建物へ (kW)', '建物へ(kW)']);
        const toGridKwIdx = findHeaderIdx(['系統へ (kW)', '系統へ(kW)']);
        const consKwIdx = findHeaderIdx(['消費 (kW)', '消費(kW)', '消費 (kWh)', '消費(kWh)']);
        const solarKwIdx = findHeaderIdx(['太陽光から (kW)', '太陽光から(kW)', '太陽光から (kWh)']);
        const gridFromKwIdx = findHeaderIdx(['系統から (kW)', '系統から(kW)', '系統から (kWh)']);

        for (let i = headerLineIdx + 1; i < lines.length; i++) {
          const cols = parseCSVLine(lines[i]);
          if (cols.length <= timeIdx) continue;

          const parsedTime = parseMeasurementTime(cols[timeIdx]);
          if (!parsedTime) continue;

          // 取得値 (kW) を 4 で割って電力量 (kWh) に変換 (value * 0.25)
          const generation =
            genKwIdx !== -1 ? parseNumberValue(cols[genKwIdx]) * 0.25 : 0;
          const toBuilding =
            toBuildingKwIdx !== -1 ? parseNumberValue(cols[toBuildingKwIdx]) * 0.25 : 0;
          const toGrid =
            toGridKwIdx !== -1 ? parseNumberValue(cols[toGridKwIdx]) * 0.25 : 0;
          const consumption =
            consKwIdx !== -1 ? parseNumberValue(cols[consKwIdx]) * 0.25 : 0;
          const solarFrom =
            solarKwIdx !== -1 ? parseNumberValue(cols[solarKwIdx]) * 0.25 : 0;
          const gridFrom =
            gridFromKwIdx !== -1 ? parseNumberValue(cols[gridFromKwIdx]) * 0.25 : 0;

          rawIntervalRows.push({
            timestamp: parsedTime.timestamp,
            epochMs: parsedTime.epochMs,
            year: parsedTime.year,
            month: parsedTime.month,
            day: parsedTime.day,
            yearMonth: parsedTime.yearMonth,
            date: parsedTime.dateLabel,
            generation,
            toBuilding,
            toGrid,
            consumption,
            solarFrom,
            gridFrom,
            sunlight: 0,
          });
        }
      }

      if (rawIntervalRows.length === 0) {
        alert('エラー：CSVから有効な15分値データを読み取れませんでした。');
        return;
      }

      // 3. 測定時間の古い順（時系列順）にソート
      rawIntervalRows.sort((a, b) => a.epochMs - b.epochMs);

      // 4. 重複行（同じ測定時間の行）を排除（ユニーク化）
      const uniqueIntervalMap = new Map<
        string,
        SolarIntervalRecord & { year: number; month: number; day: number; epochMs: number }
      >();

      for (const row of rawIntervalRows) {
        const existing = uniqueIntervalMap.get(row.timestamp);
        if (!existing) {
          uniqueIntervalMap.set(row.timestamp, row);
        } else {
          uniqueIntervalMap.set(row.timestamp, {
            ...existing,
            generation: row.generation !== 0 ? row.generation : existing.generation,
            toBuilding: row.toBuilding !== 0 ? row.toBuilding : existing.toBuilding,
            toGrid: row.toGrid !== 0 ? row.toGrid : existing.toGrid,
            consumption: row.consumption !== 0 ? row.consumption : existing.consumption,
            solarFrom: row.solarFrom !== 0 ? row.solarFrom : existing.solarFrom,
            gridFrom: row.gridFrom !== 0 ? row.gridFrom : existing.gridFrom,
          });
        }
      }

      const mergedUniqueIntervals = Array.from(uniqueIntervalMap.values());

      // 5. 月またぎデータの自動仕分け：含まれるすべての年月（yearMonth）をグループ化
      const ymGroupMap = new Map<string, { year: number; month: number; count: number }>();
      for (const item of mergedUniqueIntervals) {
        const prev = ymGroupMap.get(item.yearMonth);
        ymGroupMap.set(item.yearMonth, {
          year: item.year,
          month: item.month,
          count: (prev?.count || 0) + 1,
        });
      }

      // 代表年月（最も行数が多い年月）を判定
      let primaryYear = mergedUniqueIntervals[0].year;
      let primaryMonth = mergedUniqueIntervals[0].month;
      let maxCount = 0;
      for (const [, info] of ymGroupMap.entries()) {
        if (info.count > maxCount) {
          maxCount = info.count;
          primaryYear = info.year;
          primaryMonth = info.month;
        }
      }

      // 6. 各年月ごとに気象庁APIから日照時間を取得、日次集計、バックエンドPOST
      const updatedMonthlyItems: MonthlyDataItem[] = [];
      const importedMonths: string[] = [];

      for (const [ym, info] of ymGroupMap.entries()) {
        importedMonths.push(ym);
        const { year: targetY, month: targetM } = info;

        // 気象庁API連携（日照時間）
        let sunshineMap: Record<number, number> = {};
        try {
          console.log(
            `☀️ 気象庁APIから日照時間を取得中... (/api/weather?year=${targetY}&month=${targetM})`
          );
          const weatherRes = await fetch(
            `/api/weather?year=${targetY}&month=${targetM}`
          );
          if (weatherRes.ok) {
            sunshineMap = await weatherRes.json();
            console.log(`☀️ [${ym}] 取得した日照時間データ:`, sunshineMap);
          } else {
            console.warn(
              `⚠️ [${ym}] 気象庁データの取得に失敗しました (HTTP ${weatherRes.status})`
            );
          }
        } catch (weatherErr) {
          console.warn(`⚠️ [${ym}] 気象庁データの取得に失敗しました:`, weatherErr);
        }

        // 該当する年月の15分値レコードに日照時間を付与
        const monthIntervals = mergedUniqueIntervals.filter((r) => r.yearMonth === ym);
        monthIntervals.forEach((r) => {
          if (sunshineMap[r.day] !== undefined) {
            r.sunlight = sunshineMap[r.day];
          }
        });

        // 日次集計データ算出
        const monthDailyAggMap = new Map<
          string,
          {
            yearMonth: string;
            date: string;
            day: number;
            generation: number;
            consumption: number;
            solarFrom: number;
            gridFrom: number;
            sunlight: number;
          }
        >();

        for (const rec of monthIntervals) {
          const key = rec.date;
          const prev = monthDailyAggMap.get(key) || {
            yearMonth: rec.yearMonth,
            date: rec.date,
            day: rec.day,
            generation: 0,
            consumption: 0,
            solarFrom: 0,
            gridFrom: 0,
            sunlight: 0,
          };
          prev.generation += rec.generation;
          prev.consumption += rec.consumption;
          prev.solarFrom += rec.solarFrom;
          prev.gridFrom += rec.gridFrom;
          if (rec.sunlight > 0) prev.sunlight = rec.sunlight;
          monthDailyAggMap.set(key, prev);
        }

        const monthDailyData: DailyDataItem[] = Array.from(monthDailyAggMap.values())
          .sort((a, b) => a.day - b.day)
          .map((d) => ({
            yearMonth: d.yearMonth,
            date: d.date,
            generation: Math.round(d.generation),
            consumption: Math.round(d.consumption),
            solarFrom: Math.round(d.solarFrom),
            gridFrom: Math.round(d.gridFrom),
            sunlight: d.sunlight,
          }));

        const totalGenKwh = Math.round(
          monthDailyData.reduce((sum, d) => sum + d.generation, 0)
        );
        const totalConsKwh = monthDailyData.reduce((sum, d) => sum + d.consumption, 0);
        const totalSolarKwh = monthDailyData.reduce((sum, d) => sum + d.solarFrom, 0);
        const selfSufficiency =
          totalConsKwh > 0
            ? parseFloat(((totalSolarKwh / totalConsKwh) * 100).toFixed(1))
            : 0;

        updatedMonthlyItems.push({
          month: ym,
          actual: totalGenKwh,
          selfSufficiency,
        });

        // バックエンド (/api/solar) へ POST 送信
        try {
          const cleanIntervals: SolarIntervalRecord[] = monthIntervals.map(
            ({ year: _y, month: _m, day: _d, epochMs: _e, ...rec }) => rec
          );
          const payload = {
            month: ym,
            actual: totalGenKwh,
            selfSufficiency,
            dailyData: monthDailyData,
            intervalData: cleanIntervals,
          };
          const res = await fetch('/api/solar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (res.ok) {
            console.log(`🚀 [${ym}] /api/solar POST 送信完了`);
          }
        } catch (postErr) {
          console.warn(`⚠️ [${ym}] /api/solar POST 送信エラー:`, postErr);
        }
      }

      // 7. ステート（allDailyData）の更新
      // 指示2: 結合・重複排除された全データをステート（allDailyData）に保存する
      const cleanAllIntervals: SolarIntervalRecord[] = mergedUniqueIntervals.map(
        ({ year: _y, month: _m, day: _d, epochMs: _e, ...rec }) => rec
      );

      // 指示3: 処理完了後、`console.log("仕分け完了データ:", ...)` を出力し、処理件数と抽出月がコンソールで確認できるようにすること
      console.log("仕分け完了データ:", {
        処理件数: cleanAllIntervals.length,
        抽出月: importedMonths,
        月別内訳: Object.fromEntries(
          Array.from(ymGroupMap.entries()).map(([ym, info]) => [ym, `${info.count} 件`])
        ),
        データ: cleanAllIntervals,
      });

      setAllDailyData((prev) => {
        const intervalMap = new Map<string, SolarIntervalRecord>();
        for (const item of prev) {
          if (isIntervalRecord(item)) {
            intervalMap.set(item.timestamp, item);
          }
        }
        for (const item of cleanAllIntervals) {
          intervalMap.set(item.timestamp, item);
        }
        const mergedIntervals = Array.from(intervalMap.values()).sort((a, b) =>
          a.timestamp.localeCompare(b.timestamp)
        );

        const importedYmSet = new Set(importedMonths);
        const remainingDailies = prev.filter(
          (item): item is DailyDataItem =>
            !isIntervalRecord(item) && !importedYmSet.has(item.yearMonth)
        );

        return [...mergedIntervals, ...remainingDailies];
      });

      // monthlyData の更新
      setMonthlyData((prev) => {
        const next = [...prev];
        for (const u of updatedMonthlyItems) {
          const idx = next.findIndex((m) => m.month === u.month);
          if (idx >= 0) {
            next[idx] = {
              ...next[idx],
              actual: u.actual,
              selfSufficiency: u.selfSufficiency,
            };
          } else {
            next.push(u);
          }
        }
        return next;
      });

      setSelectedYear(String(primaryYear));
      setSelectedMonth(String(primaryMonth));

      alert(
        `🎉 インポート成功！\n\n${files.length}件のCSVファイルを読み込み、月またぎデータ（${importedMonths.join(
          '、'
        )}）を仕分けて統合しました。\n合計 ${cleanAllIntervals.length} 件の15分値データを反映しました。`);
    } catch (err) {
      console.error('❌ CSVインポートエラー:', err);
      alert('スプレッドシートへの保存またはCSV解析中にエラーが発生しました。');
    } finally {
      setIsLoading(false);
      if (e.target) e.target.value = '';
    }
  };

  const currentTargetStr = `${selectedYear}年${selectedMonth}月`;
  const lastYearStr = String(Number(selectedYear) - 1);

  // 指示2: 画面に表示するグラフ用データは、現在画面のプルダウンで選択されている年・月に yearMonth が一致するデータのみを filter で抽出すること
  const currentMonthRecords = allDailyData.filter((item) =>
    isStrictMatchingYearMonth(item, selectedYear, selectedMonth)
  );

  // 指示3: 上記の15分値データをもとに、選択月の日別（1日〜末日）の「日次集計データ（各項目の合計値）」を算出する
  const currentMonthIntervals = currentMonthRecords.filter(isIntervalRecord);

  let dailyData: DailyDataItem[] = [];
  if (currentMonthIntervals.length > 0) {
    const dailyAggMap = new Map<
      string,
      {
        yearMonth: string;
        date: string;
        day: number;
        generation: number;
        consumption: number;
        solarFrom: number;
        gridFrom: number;
        sunlight: number;
      }
    >();

    for (const rec of currentMonthIntervals) {
      const { day } = extractMonthAndDay(rec.date);
      const dayNum = day ?? 0;
      const key = rec.date;
      const prev = dailyAggMap.get(key) || {
        yearMonth: rec.yearMonth,
        date: rec.date,
        day: dayNum,
        generation: 0,
        consumption: 0,
        solarFrom: 0,
        gridFrom: 0,
        sunlight: 0,
      };
      prev.generation += rec.generation;
      prev.consumption += rec.consumption;
      prev.solarFrom += rec.solarFrom;
      prev.gridFrom += rec.gridFrom;
      if (rec.sunlight > 0) {
        prev.sunlight = rec.sunlight;
      }
      dailyAggMap.set(key, prev);
    }

    dailyData = Array.from(dailyAggMap.values())
      .sort((a, b) => a.day - b.day)
      .map((d) => ({
        yearMonth: d.yearMonth,
        date: d.date,
        generation: Math.round(d.generation),
        consumption: Math.round(d.consumption),
        solarFrom: Math.round(d.solarFrom),
        gridFrom: Math.round(d.gridFrom),
        sunlight: d.sunlight,
      }));
  } else {
    // 15分値データがない場合（スプレッドシート等から取得した日次データのみの場合）のフォールバック
    dailyData = currentMonthRecords
      .filter((d): d is DailyDataItem => !isIntervalRecord(d))
      .sort((a, b) => {
        const dayA = extractMonthAndDay(a.date).day ?? 0;
        const dayB = extractMonthAndDay(b.date).day ?? 0;
        return dayA - dayB;
      });
  }

  // 全期間の日次集計データ（月次タブ、年間相関図、前年同月比較等で使用）
  const aggregatedAllDailyData = getAllAggregatedDailyData(allDailyData);

  // 選択された年（selectedYear）に属するデータのみを厳格にフィルター
  const dailyDataThisYear = aggregatedAllDailyData.filter((d) =>
    isStrictMatchingYear(d, selectedYear)
  );

  const maxDailyConsumption = Math.max(
    0,
    ...dailyDataThisYear.map((d) => d.consumption),
    ...dailyData.map((d) => d.consumption)
  );
  const maxDailyGeneration = Math.max(
    0,
    ...dailyDataThisYear.map((d) => d.generation),
    ...dailyData.map((d) => d.generation)
  );
  const maxDailySunlight = Math.max(
    0,
    ...dailyDataThisYear.map((d) => d.sunlight),
    ...dailyData.map((d) => d.sunlight)
  );

  const yMaxCons = maxDailyConsumption > 0 ? Math.ceil(maxDailyConsumption * 1.1) : 'auto';
  const yMaxGen = maxDailyGeneration > 0 ? Math.ceil(maxDailyGeneration * 1.1) : 'auto';
  const yMaxSun = maxDailySunlight > 0 ? Math.ceil(maxDailySunlight * 1.1) : 'auto';

  const aggregate = (data: DailyDataItem[]) =>
    data.reduce(
      (acc, curr) => ({
        generation: acc.generation + curr.generation,
        consumption: acc.consumption + curr.consumption,
        solarFrom: acc.solarFrom + curr.solarFrom,
        gridFrom: acc.gridFrom + curr.gridFrom,
      }),
      { generation: 0, consumption: 0, solarFrom: 0, gridFrom: 0 }
    );

  let maxMonthlyOverall = 0;
  for (let m = 1; m <= 12; m++) {
    const tData = aggregate(
      aggregatedAllDailyData.filter((d) => isStrictMatchingYearMonth(d, selectedYear, m))
    );
    const lData = aggregate(
      aggregatedAllDailyData.filter((d) => isStrictMatchingYearMonth(d, lastYearStr, m))
    );
    const maxInMonth = Math.max(
      tData.generation,
      tData.consumption,
      tData.solarFrom,
      tData.gridFrom,
      lData.generation,
      lData.consumption,
      lData.solarFrom,
      lData.gridFrom
    );
    if (maxInMonth > maxMonthlyOverall) maxMonthlyOverall = maxInMonth;
  }
  const yMaxSummary = maxMonthlyOverall > 0 ? Math.ceil(maxMonthlyOverall * 1.1) : 'auto';

  const monthlyChartDataExtended = Array.from({ length: 12 }, (_, i) => {
    const monthNum = i + 1;
    const monthDailies = aggregatedAllDailyData.filter((d) =>
      isStrictMatchingYearMonth(d, selectedYear, monthNum)
    );

    const agg = monthDailies.reduce(
      (acc, curr) => ({
        generation: acc.generation + curr.generation,
        consumption: acc.consumption + curr.consumption,
        solarFrom: acc.solarFrom + curr.solarFrom,
        gridFrom: acc.gridFrom + curr.gridFrom,
        sunlight: acc.sunlight + curr.sunlight,
      }),
      { generation: 0, consumption: 0, solarFrom: 0, gridFrom: 0, sunlight: 0 }
    );

    const hasData = monthDailies.length > 0;

    return {
      monthLabel: `${monthNum}月`,
      consumption: hasData ? agg.consumption : null,
      solarFrom: hasData ? agg.solarFrom : null,
      gridFrom: hasData ? agg.gridFrom : null,
      generation: hasData ? agg.generation : null,
      sunlight: hasData ? parseFloat(agg.sunlight.toFixed(1)) : null,
      sim: SIMULATION_DATA[monthNum],
    };
  });

  const maxMonthlyConsumption = Math.max(
    0,
    ...monthlyChartDataExtended.map((d) => d.consumption || 0)
  );
  const maxMonthlyGeneration = Math.max(
    0,
    ...monthlyChartDataExtended.map((d) => d.generation || 0)
  );
  const maxMonthlySunlight = Math.max(
    0,
    ...monthlyChartDataExtended.map((d) => d.sunlight || 0)
  );

  const yMaxMonthCons =
    maxMonthlyConsumption > 0 ? Math.ceil(maxMonthlyConsumption * 1.1) : 'auto';
  const yMaxMonthGen =
    maxMonthlyGeneration > 0 ? Math.ceil(maxMonthlyGeneration * 1.1) : 'auto';
  const yMaxMonthSun =
    maxMonthlySunlight > 0 ? Math.ceil(maxMonthlySunlight * 1.1) : 'auto';

  const getTrendLineData = (dataList: DailyDataItem[], maxSunVal: number | 'auto') => {
    const validData = dataList.filter((d) => d.sunlight > 0 && d.generation > 0);
    if (validData.length < 2) return [];

    const n = validData.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;

    validData.forEach((d) => {
      sumX += d.sunlight;
      sumY += d.generation;
      sumXY += d.sunlight * d.generation;
      sumXX += d.sunlight * d.sunlight;
    });

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    if (isNaN(slope) || isNaN(intercept)) return [];

    const xMax = maxSunVal === 'auto' ? 14 : Number(maxSunVal);
    return [
      { sunlight: 0, trend: Math.max(0, Math.round(intercept)) },
      { sunlight: xMax, trend: Math.max(0, Math.round(slope * xMax + intercept)) },
    ];
  };

  const monthTrend = getTrendLineData(dailyData, yMaxSun);
  const yearTrend = getTrendLineData(dailyDataThisYear, yMaxSun);

  const annualMonths = Array.from({ length: 12 }, (_, i) => i + 1);
  const annualChartData = annualMonths.map((monthNum) => {
    const mStr = `${selectedYear}年${monthNum}月`;
    const found = monthlyData.find((d) => d.month === mStr);
    return {
      monthLabel: `${monthNum}月`,
      sim: SIMULATION_DATA[monthNum],
      actual: found?.actual ?? null,
    };
  });

  const rawDailyThisYear = dailyData;
  const rawDailyLastYear = aggregatedAllDailyData.filter((d) =>
    isStrictMatchingYearMonth(d, lastYearStr, selectedMonth)
  );

  const aggThis = aggregate(rawDailyThisYear);
  const aggLast = aggregate(rawDailyLastYear);

  const yoySummaryData = [
    { name: '総発電量', 前年同月: aggLast.generation, 選択月: aggThis.generation },
    { name: '総消費量', 前年同月: aggLast.consumption, 選択月: aggThis.consumption },
    { name: '太陽光から(自家消費)', 前年同月: aggLast.solarFrom, 選択月: aggThis.solarFrom },
    { name: '系統から(買電)', 前年同月: aggLast.gridFrom, 選択月: aggThis.gridFrom },
  ];

  const currentTarget = monthlyData.find((d) => d.month === currentTargetStr);

  const currentGenTotal = dailyData.reduce((sum, d) => sum + d.generation, 0);
  const currentConsTotal = dailyData.reduce((sum, d) => sum + d.consumption, 0);
  const currentSolarTotal = dailyData.reduce((sum, d) => sum + d.solarFrom, 0);
  const calculatedSelfSufficiency =
    currentConsTotal > 0 ? (currentSolarTotal / currentConsTotal) * 100 : 0;

  const displayActual =
    currentTarget && currentTarget.actual !== null
      ? (currentTarget.actual / 1000).toFixed(2)
      : dailyData.length > 0
      ? (currentGenTotal / 1000).toFixed(2)
      : '0.00';
  const displaySufficiency = currentTarget
    ? currentTarget.selfSufficiency.toFixed(1)
    : dailyData.length > 0
    ? calculatedSelfSufficiency.toFixed(1)
    : '0.0';
  const currentSimValue = SIMULATION_DATA[parseInt(selectedMonth, 10)];
  const actualForRatio =
    currentTarget && currentTarget.actual !== null
      ? currentTarget.actual
      : dailyData.length > 0
      ? currentGenTotal
      : null;
  const displayRatio =
    actualForRatio !== null && currentSimValue > 0
      ? ((actualForRatio / currentSimValue - 1) * 100).toFixed(1)
      : '0.0';

  // 4. 15分値に基づく動的収益改善額・投資回収率の計算（休日・季節・時間帯別単価対応）
  const calculateMonthSavings = (year: number | string, month: number | string) => {
    const yNum = Number(year);
    const mNum = Number(month);
    const matchingRecords = allDailyData.filter((item) =>
      isStrictMatchingYearMonth(item, year, month)
    );
    const intervals = matchingRecords.filter(isIntervalRecord);
    const dailies = matchingRecords.filter(
      (item): item is DailyDataItem => !isIntervalRecord(item)
    );

    const monthLatestRate = getApplicableRateForMonth(year, month, electricityRates);

    if (intervals.length > 0) {
      let summerPeakKwh = 0;
      let summerDayKwh = 0;
      let otherDayKwh = 0;
      let nightKwh = 0;
      let energySavingsYen = 0;
      let renewableSavingsYen = 0;

      for (const rec of intervals) {
        const evalResult = evaluateRecordRate(rec.timestamp, electricityRates);
        const kwh = rec.solarFrom;
        if (evalResult.rateType === 'summerPeak') {
          summerPeakKwh += kwh;
        } else if (evalResult.rateType === 'summerDay') {
          summerDayKwh += kwh;
        } else if (evalResult.rateType === 'otherDay') {
          otherDayKwh += kwh;
        } else {
          nightKwh += kwh;
        }
        energySavingsYen += kwh * evalResult.unitPrice;
        renewableSavingsYen += kwh * evalResult.applicableRate.renewableRate;
      }

      const totalSolarKwh = summerPeakKwh + summerDayKwh + otherDayKwh + nightKwh;
      const baseDiscountYen = monthLatestRate.baseDiscount;
      const savingsYen = energySavingsYen + renewableSavingsYen + baseDiscountYen;

      return {
        hasData: true,
        summerPeakKwh,
        summerDayKwh,
        otherDayKwh,
        nightKwh,
        totalSolarKwh,
        energySavingsYen,
        renewableSavingsYen,
        baseDiscountYen,
        savingsYen,
        rate: monthLatestRate,
      };
    }

    if (dailies.length > 0) {
      let summerPeakKwh = 0;
      let summerDayKwh = 0;
      let otherDayKwh = 0;
      let nightKwh = 0;
      let energySavingsYen = 0;
      let renewableSavingsYen = 0;

      const isSummer = mNum >= 7 && mNum <= 9;

      for (const d of dailies) {
        const { day } = extractMonthAndDay(d.date);
        const dayVal = day || 1;
        const dt = new Date(yNum, mNum - 1, dayVal);
        const dayOfWeek = dt.getDay();
        const isSunday = dayOfWeek === 0;
        const isHoliday = isJapaneseHoliday(yNum, mNum, dayVal);
        const applicableRate = getApplicableRateForDate(
          `${yNum}-${String(mNum).padStart(2, '0')}-${String(dayVal).padStart(2, '0')}`,
          electricityRates
        );

        const kwh = d.solarFrom;
        if (isSunday || isHoliday) {
          nightKwh += kwh;
          energySavingsYen += kwh * applicableRate.nightRate;
        } else if (isSummer) {
          // 平日昼間のうち13-16時（約35%）をピーク、残りを昼間
          const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
          if (isWeekday) {
            const peakPart = kwh * 0.35;
            const dayPart = kwh * 0.65;
            summerPeakKwh += peakPart;
            summerDayKwh += dayPart;
            energySavingsYen +=
              peakPart * applicableRate.summerPeakRate + dayPart * applicableRate.summerDayRate;
          } else {
            summerDayKwh += kwh;
            energySavingsYen += kwh * applicableRate.summerDayRate;
          }
        } else {
          otherDayKwh += kwh;
          energySavingsYen += kwh * applicableRate.otherDayRate;
        }
        renewableSavingsYen += kwh * applicableRate.renewableRate;
      }

      const totalSolarKwh = summerPeakKwh + summerDayKwh + otherDayKwh + nightKwh;
      const baseDiscountYen = monthLatestRate.baseDiscount;
      const savingsYen = energySavingsYen + renewableSavingsYen + baseDiscountYen;

      return {
        hasData: true,
        summerPeakKwh,
        summerDayKwh,
        otherDayKwh,
        nightKwh,
        totalSolarKwh,
        energySavingsYen,
        renewableSavingsYen,
        baseDiscountYen,
        savingsYen,
        rate: monthLatestRate,
      };
    }

    return {
      hasData: false,
      summerPeakKwh: 0,
      summerDayKwh: 0,
      otherDayKwh: 0,
      nightKwh: 0,
      totalSolarKwh: 0,
      energySavingsYen: 0,
      renewableSavingsYen: 0,
      baseDiscountYen: 0,
      savingsYen: 0,
      rate: monthLatestRate,
    };
  };

  // 当月収益改善額の算出
  const currentMonthSavingsInfo = calculateMonthSavings(selectedYear, selectedMonth);
  const displayMonthlySavingsK = currentMonthSavingsInfo.hasData
    ? Math.round(currentMonthSavingsInfo.savingsYen / 1000).toLocaleString()
    : '0';

  // 選択年月時点（selectedYM）までの累計収益改善額および累計投資・経費額の算出
  const selectedYMNormalized = normalizeYearMonth(`${selectedYear}-${selectedMonth}`);

  // allDailyData に存在するすべてのユニークな (year, month) を抽出し、selectedYM 以前の月を合算
  const uniqueYearMonthsMap = new Map<string, { year: number; month: number }>();
  for (const item of allDailyData) {
    const ymMatch = item.yearMonth.match(/(\d{4})年0?(\d{1,2})月/);
    if (ymMatch) {
      const y = parseInt(ymMatch[1], 10);
      const m = parseInt(ymMatch[2], 10);
      const norm = normalizeYearMonth(`${y}-${m}`);
      if (!uniqueYearMonthsMap.has(norm)) {
        uniqueYearMonthsMap.set(norm, { year: y, month: m });
      }
    }
  }

  let cumulativeSavingsUpToSelectedYen = 0;
  for (const [normYm, { year, month }] of uniqueYearMonthsMap.entries()) {
    if (normYm <= selectedYMNormalized) {
      const mInfo = calculateMonthSavings(year, month);
      cumulativeSavingsUpToSelectedYen += mInfo.savingsYen;
    }
  }

  // 選択年月時点までに発生した累計投資・経費額（補助金マイナス分も合算）
  const investmentsUpToSelected = investments.filter(
    (inv) => normalizeYearMonth(inv.date) <= selectedYMNormalized
  );
  const cumulativeInvestmentUpToSelectedYen = investmentsUpToSelected.reduce(
    (sum, inv) => sum + inv.amount,
    0
  );
  const totalAllInvestmentsYen = investments.reduce((sum, inv) => sum + inv.amount, 0);
  const effectiveInvestmentYen =
    investmentsUpToSelected.length > 0
      ? cumulativeInvestmentUpToSelectedYen
      : totalAllInvestmentsYen;

  const displayDynamicRoiRate =
    effectiveInvestmentYen > 0
      ? ((cumulativeSavingsUpToSelectedYen / effectiveInvestmentYen) * 100).toFixed(1)
      : '0.0';

  // 投資回収タブ用データ（千円単位、設備投資・経費履歴と実績・シミュレーションに連動）
  const baseStartYear = 2026;
  const initialInvestmentsYen = investments
    .filter((inv) => normalizeYearMonth(inv.date) <= `${baseStartYear}-04`)
    .reduce((sum, inv) => sum + inv.amount, 0);
  const startOutlayK = Math.round((initialInvestmentsYen || totalAllInvestmentsYen) / 1000);

  const roiData = Array.from({ length: 5 }, (_, idx) => {
    if (idx === 0) {
      return {
        year: '0年',
        sim: -startOutlayK,
        actual: -startOutlayK,
      };
    }
    const targetYear = baseStartYear + idx - 1;
    const endOfYearYM = `${targetYear}-12`;

    // targetYear末までの累計投資額 (千円)
    const cumInvYen = investments
      .filter((inv) => normalizeYearMonth(inv.date) <= endOfYearYM)
      .reduce((sum, inv) => sum + inv.amount, 0);
    const cumInvK = Math.round((cumInvYen || totalAllInvestmentsYen) / 1000);

    // シミュレーション上の年間改善額を積み上げ
    let simCumSavingsYen = 0;
    for (let y = baseStartYear; y <= targetYear; y++) {
      for (let m = 1; m <= 12; m++) {
        const ym = normalizeYearMonth(`${y}-${m}`);
        if (ym < `${baseStartYear}-04`) continue;
        const r = getApplicableRateForMonth(y, m, electricityRates);
        const simSelfConsumeKwh = (SIMULATION_DATA[m] || 5000) * 0.85;
        const isSummer = m >= 7 && m <= 9;
        const avgRate = isSummer
          ? r.summerPeakRate * 0.25 + r.summerDayRate * 0.75
          : r.otherDayRate;
        simCumSavingsYen +=
          simSelfConsumeKwh * (avgRate + r.renewableRate) + r.baseDiscount;
      }
    }

    // 実績データが存在する月までの累計改善額
    let actualCumSavingsYen = 0;
    let hasActualInOrBeforeYear = false;
    for (const [normYm, { year, month }] of uniqueYearMonthsMap.entries()) {
      if (year === targetYear) hasActualInOrBeforeYear = true;
      if (normYm <= endOfYearYM) {
        actualCumSavingsYen += calculateMonthSavings(year, month).savingsYen;
      }
    }

    return {
      year: `${idx}年(${targetYear})`,
      sim: Math.round(simCumSavingsYen / 1000) - cumInvK,
      actual:
        hasActualInOrBeforeYear || targetYear <= Number(selectedYear)
          ? Math.round(actualCumSavingsYen / 1000) - cumInvK
          : null,
    };
  });

  // ============================================================================
  // 🚀 経営者向け5大管理機能の計算ロジック
  // ============================================================================

  // 【機能1】発電効率低下・異常検知アラート判定（日照4時間以上で標準期待値を20%以上下回る日）
  const anomalyAlertInfo = (() => {
    const regressionSource =
      dailyData.filter((d) => d.sunlight > 0 && d.generation > 0).length >= 3
        ? dailyData.filter((d) => d.sunlight > 0 && d.generation > 0)
        : dailyDataThisYear.filter((d) => d.sunlight > 0 && d.generation > 0);

    let slope = 42; // 50kW設備の標準期待値 (約42kWh / 日照1h)
    let intercept = 30;

    if (regressionSource.length >= 2) {
      const n = regressionSource.length;
      let sumX = 0;
      let sumY = 0;
      let sumXY = 0;
      let sumXX = 0;
      for (const d of regressionSource) {
        sumX += d.sunlight;
        sumY += d.generation;
        sumXY += d.sunlight * d.generation;
        sumXX += d.sunlight * d.sunlight;
      }
      const denom = n * sumXX - sumX * sumX;
      if (denom !== 0) {
        const calcSlope = (n * sumXY - sumX * sumY) / denom;
        const calcIntercept = (sumY - calcSlope * sumX) / n;
        if (!isNaN(calcSlope) && calcSlope > 5) {
          slope = calcSlope;
          intercept = calcIntercept;
        }
      }
    }

    // 直近7日（または当月データ）のうち日照時間4時間以上の日を検査
    const recentDays = dailyData.slice(-7);
    const sunnyCandidates = (recentDays.length > 0 ? recentDays : dailyData).filter(
      (d) => d.sunlight >= 4.0
    );

    let worstDropRate = 0;
    let worstDayLabel = '';
    for (const d of sunnyCandidates) {
      const expectedGen = Math.max(10, slope * d.sunlight + intercept);
      const ratio = d.generation / expectedGen;
      const dropRate = 1 - ratio;
      if (dropRate >= 0.2 && dropRate > worstDropRate) {
        worstDropRate = dropRate;
        worstDayLabel = d.date;
      }
    }

    const isAnomaly = worstDropRate >= 0.2;
    const dropPercent = isAnomaly ? Math.round(worstDropRate * 100) : 0;
    const avgUnitValue =
      currentMonthSavingsInfo.rate.otherDayRate + currentMonthSavingsInfo.rate.renewableRate;
    const baseExpectedMonthGen = actualForRatio ?? currentSimValue ?? 5208;
    const estimatedMonthlyLossK = isAnomaly
      ? Math.max(
          1,
          Math.round((baseExpectedMonthGen * (dropPercent / 100) * avgUnitValue) / 1000)
        )
      : 0;

    return {
      isAnomaly,
      dropPercent,
      estimatedMonthlyLossK,
      worstDayLabel,
    };
  })();

  // 【機能2】設備増設シミュレーター（パネル1枚単位・15分値ベース）
  const expansionSimResult = (() => {
    const baseCapKw = Math.max(1, simBaseCapacityKw);
    const addedCapKw = (simAddedPanels * simPanelWatt) / 1000;
    const totalCapKw = baseCapKw + addedCapKw;
    const scaleFactor = totalCapKw / baseCapKw;

    const allIntervals = allDailyData.filter(isIntervalRecord);
    const sampleIntervals =
      currentMonthIntervals.length > 0 ? currentMonthIntervals : allIntervals;

    const totalAnnualSimGenKwh = Object.values(SIMULATION_DATA).reduce((s, v) => s + v, 0); // 66,065 kWh

    let baseSampleGen = 0;
    let baseSampleCons = 0;
    let baseSampleSelf = 0;
    let baseSampleSurplus = 0;
    let baseSampleVarSavings = 0;

    let scaledSampleGen = 0;
    let scaledSampleSelf = 0;
    let scaledSampleSurplus = 0;
    let scaledSampleGrid = 0;
    let scaledSampleVarSavings = 0;

    if (sampleIntervals.length > 0) {
      for (const rec of sampleIntervals) {
        const gen0 = rec.generation;
        const cons = rec.consumption;
        const self0 = Math.min(cons, rec.solarFrom > 0 ? rec.solarFrom : gen0);
        const surp0 = Math.max(0, gen0 - self0);

        const gen1 = gen0 * scaleFactor;
        const self1 = Math.min(cons, gen1);
        const surp1 = Math.max(0, gen1 - cons);
        const grid1 = Math.max(0, cons - self1);

        const evalRes = evaluateRecordRate(rec.timestamp, electricityRates);
        const unitYen = evalRes.unitPrice + evalRes.applicableRate.renewableRate;

        baseSampleGen += gen0;
        baseSampleCons += cons;
        baseSampleSelf += self0;
        baseSampleSurplus += surp0;
        baseSampleVarSavings += self0 * unitYen;

        scaledSampleGen += gen1;
        scaledSampleSelf += self1;
        scaledSampleSurplus += surp1;
        scaledSampleGrid += grid1;
        scaledSampleVarSavings += self1 * unitYen;
      }
    } else {
      // 15分値CSV未インポート時の標準15分プロファイル推計モデル
      const r = currentMonthSavingsInfo.rate;
      const avgUnitYen = r.otherDayRate * 0.7 + r.summerDayRate * 0.3 + r.renewableRate;
      baseSampleGen = currentSimValue || 5208;
      baseSampleCons = baseSampleGen * 2.15; // 標準工場負荷
      baseSampleSelf = Math.min(baseSampleCons, baseSampleGen * 0.92);
      baseSampleSurplus = Math.max(0, baseSampleGen - baseSampleSelf);
      baseSampleVarSavings = baseSampleSelf * avgUnitYen;

      scaledSampleGen = baseSampleGen * scaleFactor;
      // 容量増加に伴い昼間ピーク時の余剰が徐々に増えるリアルな飽和カーブモデル
      const daytimeLoadCap = baseSampleCons * 0.62;
      scaledSampleSelf = Math.min(daytimeLoadCap, scaledSampleGen * 0.88);
      scaledSampleSurplus = Math.max(0, scaledSampleGen - scaledSampleSelf);
      scaledSampleGrid = Math.max(0, baseSampleCons - scaledSampleSelf);
      scaledSampleVarSavings = scaledSampleSelf * avgUnitYen;
    }

    // 年間換算係数（サンプル期間の発電量から通期66,065kWh基準へ換算）
    const annualizeMultiplier =
      baseSampleGen > 0 ? totalAnnualSimGenKwh / baseSampleGen : 12;

    const baseAnnualGenKwh = Math.round(baseSampleGen * annualizeMultiplier);
    const baseAnnualConsKwh = Math.round(baseSampleCons * annualizeMultiplier);
    const baseAnnualSelfKwh = Math.round(baseSampleSelf * annualizeMultiplier);
    const baseAnnualSurplusKwh = Math.round(baseSampleSurplus * annualizeMultiplier);
    const baseAnnualGridKwh = Math.max(0, baseAnnualConsKwh - baseAnnualSelfKwh);
    const baseAnnualSavingsYen = Math.round(
      baseSampleVarSavings * annualizeMultiplier +
        currentMonthSavingsInfo.rate.baseDiscount * 12
    );

    const scaledAnnualGenKwh = Math.round(scaledSampleGen * annualizeMultiplier);
    const scaledAnnualSelfKwh = Math.round(scaledSampleSelf * annualizeMultiplier);
    const scaledAnnualSurplusKwh = Math.round(scaledSampleSurplus * annualizeMultiplier);
    const scaledAnnualGridKwh = Math.max(0, baseAnnualConsKwh - scaledAnnualSelfKwh);
    const scaledAnnualSavingsYen = Math.round(
      scaledSampleVarSavings * annualizeMultiplier +
        currentMonthSavingsInfo.rate.baseDiscount * 12
    );

    const addedAnnualSavingsYen = Math.max(0, scaledAnnualSavingsYen - baseAnnualSavingsYen);
    const baseSelfSufficiency =
      baseAnnualConsKwh > 0 ? (baseAnnualSelfKwh / baseAnnualConsKwh) * 100 : 0;
    const scaledSelfSufficiency =
      baseAnnualConsKwh > 0 ? (scaledAnnualSelfKwh / baseAnnualConsKwh) * 100 : 0;

    const paybackYears =
      addedAnnualSavingsYen > 0
        ? ((simInvestManYen * 10000) / addedAnnualSavingsYen).toFixed(1)
        : '—';

    const comparisonChartData = [
      {
        stage: `既設 (${baseCapKw}kW)`,
        自家消費電力量: baseAnnualSelfKwh,
        系統買電量: baseAnnualGridKwh,
        余剰電力量: baseAnnualSurplusKwh,
        総発電量: baseAnnualGenKwh,
      },
      {
        stage: `増設後 (${totalCapKw.toFixed(1)}kW)`,
        自家消費電力量: scaledAnnualSelfKwh,
        系統買電量: scaledAnnualGridKwh,
        余剰電力量: scaledAnnualSurplusKwh,
        総発電量: scaledAnnualGenKwh,
      },
    ];

    return {
      baseCapKw,
      addedCapKw,
      totalCapKw,
      scaleFactor,
      baseAnnualSelfKwh,
      scaledAnnualSelfKwh,
      baseAnnualSurplusKwh,
      scaledAnnualSurplusKwh,
      baseAnnualSavingsYen,
      scaledAnnualSavingsYen,
      addedAnnualSavingsYen,
      baseSelfSufficiency,
      scaledSelfSufficiency,
      paybackYears,
      comparisonChartData,
      usingRealIntervals: sampleIntervals.length > 0,
      intervalCount: sampleIntervals.length,
    };
  })();

  // 【機能3】デマンドピーク監視と基本料金抑制効果
  const demandPeakInfo = (() => {
    const contractKw = 158;
    const defaultMaxDemandKw = 127;
    let measuredGridPeakKw = 0;
    let measuredSolarAtPeakKw = 0;

    if (currentMonthIntervals.length > 0) {
      for (const rec of currentMonthIntervals) {
        const gridKw = rec.gridFrom * 4;
        if (gridKw > measuredGridPeakKw) {
          measuredGridPeakKw = gridKw;
          measuredSolarAtPeakKw = rec.solarFrom * 4;
        }
      }
    }

    const maxDemandKw = defaultMaxDemandKw;
    const marginKw = contractKw - maxDemandKw; // 31 kW
    const peakCutContributionKw =
      measuredSolarAtPeakKw > 0 ? Math.round(measuredSolarAtPeakKw) : 31;

    return {
      contractKw,
      maxDemandKw,
      marginKw,
      peakCutContributionKw,
      measuredGridPeakKw: Math.round(measuredGridPeakKw),
      monthlyBaseDiscountYen: currentMonthSavingsInfo.rate.baseDiscount,
    };
  })();

  // 【機能4】機器更新タイマーとメンテナンス積立推奨（設備保全）
  const equipmentLifecycleInfo = (() => {
    const startYear = 2026;
    const currentY = Number(selectedYear) || 2026;
    const operatingYear = Math.max(1, currentY - startYear + 1);
    const panelLifeYears = 25;
    const panelDegradationRate = 0.5; // 年0.5%
    const currentPanelEfficiency = (100 - (operatingYear - 1) * panelDegradationRate).toFixed(1);
    const pcsMinLife = 10;
    const pcsMaxLife = 15;
    const estimatedAnnualSavingsManYen = Math.max(
      120,
      Math.round(expansionSimResult.baseAnnualSavingsYen / 10000)
    );

    return {
      operatingYear,
      panelLifeYears,
      panelDegradationRate,
      currentPanelEfficiency,
      pcsMinLife,
      pcsMaxLife,
      pcsReplacePeriod: '2035〜2038年',
      estimatedAnnualSavingsManYen,
    };
  })();

  // 【機能5】CO2削減量算出（係数: 0.000434 t-CO2/kWh、杉の木1本 = 年間約0.014 t-CO2吸収）
  const co2ReductionInfo = (() => {
    const CO2_FACTOR = 0.000434; // t-CO2 / kWh
    const CEDAR_TREE_FACTOR = 0.014; // t-CO2 / 本・年 (14kg-CO2)

    const monthGenKwh =
      actualForRatio !== null ? actualForRatio : currentGenTotal > 0 ? currentGenTotal : 0;
    const monthlyCo2Ton = monthGenKwh * CO2_FACTOR;
    const monthlyCedarTrees = Math.round(monthlyCo2Ton / CEDAR_TREE_FACTOR);

    const yearActualGenKwh = dailyDataThisYear.reduce((s, d) => s + d.generation, 0);
    const annualGenKwh =
      yearActualGenKwh > 0
        ? yearActualGenKwh
        : Object.values(SIMULATION_DATA).reduce((s, v) => s + v, 0);
    const annualCo2Ton = annualGenKwh * CO2_FACTOR;
    const annualCedarTrees = Math.round(annualCo2Ton / CEDAR_TREE_FACTOR);

    return {
      monthlyCo2Ton: monthlyCo2Ton.toFixed(2),
      monthlyCedarTrees,
      annualCo2Ton: annualCo2Ton.toFixed(1),
      annualCedarTrees,
      isAnnualActual: yearActualGenKwh > 0,
    };
  })();

  const getSliderCssVars = (val: number, min: number, max: number): React.CSSProperties =>
    ({
      '--attr-min': min,
      '--attr-max': max,
      '--control-value': val,
    }) as React.CSSProperties;

  const CustomScatterTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: Array<{ payload: DailyDataItem & { trend?: number } }>;
  }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      if (data.trend !== undefined) return null;
      return (
        <div className="bg-slate-900 text-white p-4 rounded-xl shadow-xl border border-slate-800 text-xs space-y-1">
          <p className="font-bold text-amber-400 text-sm">
            {data.yearMonth} {data.date}
          </p>
          <p>
            ☀️ 日照時間: <span className="font-bold text-sm">{data.sunlight}</span> 時間
          </p>
          <p>
            ⚡ 発電量: <span className="font-bold text-sm">{data.generation}</span> kWh
          </p>
        </div>
      );
    }
    return null;
  };

  // 未ログイン時はカード型ログイン画面を表示
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 p-8 md:p-10">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-500/10 text-amber-500 text-3xl mb-4">
              ☀️
            </div>
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              西岡勝次商店 分析レポート
            </h1>
            <p className="text-xs font-medium text-slate-400 mt-2">
              SolarEdge 太陽光発電・投資回収アナリティクス
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label
                htmlFor="login-username"
                className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2"
              >
                ログインID
              </label>
              <input
                id="login-username"
                name="username"
                type="text"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                autoComplete="username"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="none"
                required
                placeholder="admin"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 font-medium text-sm focus:bg-white focus:border-slate-900 focus:outline-none transition-colors"
              />
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2"
              >
                パスワード
              </label>
              <input
                id="login-password"
                name="current-password"
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                autoComplete="current-password"
                enterKeyHint="done"
                required
                placeholder="••••••••"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 font-medium text-sm focus:bg-white focus:border-slate-900 focus:outline-none transition-colors"
              />
            </div>

            {loginError && (
              <div
                role="alert"
                className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 text-xs font-bold"
              >
                {loginError}
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-3.5 px-6 rounded-xl text-sm shadow-lg transition-all cursor-pointer"
            >
              ログイン
            </button>

            <div className="pt-3 border-t border-slate-100 text-center">
              <p className="text-xs text-slate-400">
                テスト用初期値: ID <code className="font-bold text-slate-600">admin</code> ／ パスワード{' '}
                <code className="font-bold text-slate-600">admin123</code>
              </p>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-6 md:p-10 pt-0 md:pt-0">
      {/* 複数週次CSVファイル一括選択用 input */}
      <input
        type="file"
        accept=".csv"
        multiple
        ref={fileInputRef}
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* 📌 上部固定（Sticky）ヘッダー＆タブ＆KPIカード領域 */}
      <div className="sticky top-0 z-40 bg-slate-50/95 backdrop-blur-sm pt-6 md:pt-10 pb-6 border-b border-slate-200/60 -mx-6 md:-mx-10 px-6 md:px-10 mb-8 print:relative print:border-b print:border-slate-300 print:p-0 print:pb-4 print:m-0 print:mb-4">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 print:mb-2">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight print:text-2xl">
                西岡勝次商店 分析レポート
              </h1>
              <span className="hidden print:inline-block text-xs font-bold bg-slate-900 text-white px-3 py-1 rounded-full">
                {selectedYear}年{selectedMonth}月度 経営報告書（エグゼクティブ・サマリー）
              </span>
            </div>
            <div className="flex items-center gap-3 mt-3 print:hidden">
              <div className="flex items-center bg-white border border-slate-200 rounded-lg shadow-sm">
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  className="px-3 py-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded-l-lg border-r border-slate-200 transition-colors cursor-pointer"
                >
                  ◀
                </button>
                <div className="flex items-center px-3">
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(e.target.value)}
                    className="bg-transparent font-bold outline-none cursor-pointer text-sm"
                  >
                    {[2025, 2026, 2027, 2028, 2029, 2030].map((y) => (
                      <option key={y} value={y}>
                        {y}年
                      </option>
                    ))}
                  </select>
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="bg-transparent font-bold outline-none cursor-pointer text-sm ml-1"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                      <option key={m} value={m}>
                        {m}月度実績
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleNextMonth}
                  className="px-3 py-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded-r-lg border-l border-slate-200 transition-colors cursor-pointer"
                >
                  ▶
                </button>
              </div>
              <button
                type="button"
                onClick={fetchSpreadsheetData}
                disabled={isLoading}
                className="text-xs bg-slate-200 hover:bg-slate-300 px-3 py-2 rounded-lg font-bold text-slate-700 transition-all cursor-pointer disabled:opacity-50"
              >
                🔄 同期
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 print:hidden">
            <button
              type="button"
              onClick={() => window.print()}
              className="bg-emerald-600 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-emerald-700 transition-all shadow-sm cursor-pointer"
            >
              📄 経営レポート出力
            </button>
            <button
              type="button"
              onClick={openRateModal}
              className="bg-white text-slate-700 border border-slate-200 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-slate-100 transition-all shadow-sm cursor-pointer"
            >
              ⚡ 単価設定
            </button>
            <button
              type="button"
              onClick={openInvestmentModal}
              className="bg-white text-slate-700 border border-slate-200 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-slate-100 transition-all shadow-sm cursor-pointer"
            >
              💰 投資・経費管理
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="bg-slate-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-slate-800 transition-all shadow-lg cursor-pointer disabled:opacity-50"
            >
              {isLoading ? '処理中...' : 'データインポート'}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="bg-rose-50 text-rose-600 border border-rose-200 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-rose-100 transition-all cursor-pointer"
            >
              ログアウト
            </button>
          </div>
        </header>

        {/* 🚨 【機能1】発電効率低下・異常検知アラートバナー（ヘッダー直下） */}
        <div className="mt-4 print-avoid-break">
          {anomalyAlertInfo.isAnomaly ? (
            <div
              role="alert"
              className="px-4 py-3 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 text-xs md:text-sm font-bold flex items-center justify-between gap-3 shadow-sm"
            >
              <span>
                ⚠️ 【点検推奨】発電効率の低下を検知しました。日照に対して発電量が約
                {anomalyAlertInfo.dropPercent}%低下しています（想定機会損失: 月間約
                {anomalyAlertInfo.estimatedMonthlyLossK}
                千円）。パネル汚れやパワコン停止の確認を推奨します。
              </span>
              {anomalyAlertInfo.worstDayLabel && (
                <span className="shrink-0 text-[11px] bg-amber-200/80 text-amber-900 px-2.5 py-1 rounded-full font-extrabold">
                  検知日: {anomalyAlertInfo.worstDayLabel}
                </span>
              )}
            </div>
          ) : (
            <div className="px-4 py-2.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs md:text-sm font-bold flex items-center justify-between gap-3">
              <span>✅ 太陽光設備は正常に稼働しています（期待発電効率を維持）</span>
              <span className="text-[11px] text-emerald-600 font-semibold hidden sm:inline">
                日照4h以上の直近稼働日：標準期待値クリア
              </span>
            </div>
          )}
        </div>

        {/* タブ選択ボタン群 */}
        <div className="flex flex-wrap gap-3 mt-5 print:hidden">
          {[
            '日次データ',
            '月次データ',
            '相関図',
            '前年同月比較',
            '年間:発電予実',
            '投資回収',
            '増設シミュレーター',
          ].map((t, i) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTab(i + 1)}
              className={`py-2 px-4 rounded-xl text-sm font-bold transition-all border cursor-pointer ${
                activeTab === i + 1
                  ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                  : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* 📊 KPI表示枠（4枚のKPIカード） */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-5 print:grid-cols-4 print:gap-3 print-avoid-break">
          {[
            {
              label: '選択月総発電量',
              val: displayActual,
              unit: 'MWh',
              sub: `計画比 ${Number(displayRatio) >= 0 ? '+' : ''}${displayRatio}%`,
              color: 'text-emerald-600',
            },
            {
              label: '電力自給率',
              val: displaySufficiency,
              unit: '%',
              sub: '自家消費モデル',
              color: 'text-amber-600',
            },
            {
              label: '収益改善額',
              val: displayMonthlySavingsK,
              unit: '千円',
              sub: currentMonthSavingsInfo.hasData
                ? `単価 ${currentMonthSavingsInfo.rate.startDate}〜 (${Math.round(
                    currentMonthSavingsInfo.savingsYen
                  ).toLocaleString()}円)`
                : `適用単価: ${currentMonthSavingsInfo.rate.startDate}〜`,
              color: 'text-slate-800',
            },
            {
              label: '投資回収率',
              val: displayDynamicRoiRate,
              unit: '%',
              sub: `累計投資 ${(effectiveInvestmentYen / 10000).toLocaleString()}万円対比`,
              color: 'text-blue-600',
            },
          ].map((kpi) => (
            <div
              key={kpi.label}
              className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm print:p-3 print:rounded-xl"
            >
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                {kpi.label}
              </p>
              <p className={`text-3xl font-black mt-1.5 print:text-xl ${kpi.color}`}>
                {kpi.val}{' '}
                <span className="text-sm font-medium text-slate-400">{kpi.unit}</span>
              </p>
              {kpi.sub && (
                <p className="text-xs font-medium text-slate-400 mt-1">{kpi.sub}</p>
              )}
            </div>
          ))}
        </div>

        {/* ⚡ 【機能3】デマンドピーク状況 ＆ 🌿 【機能5】CO2削減実績サマリーバー */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4 print:grid-cols-2 print:gap-3 print-avoid-break">
          <div className="bg-white px-5 py-3.5 rounded-2xl border border-slate-100 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold text-slate-700">
                  ⚡ デマンドピーク監視（高圧基本料金抑制）
                </span>
                <span className="text-[11px] font-bold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                  マージン: {demandPeakInfo.marginKw} kW
                </span>
              </div>
              <p className="text-xs font-bold text-slate-900 mt-1">
                契約電力: <span className="text-blue-600">{demandPeakInfo.contractKw} kW</span> ／ 当月最大デマンド:{' '}
                <span className="text-slate-900">{demandPeakInfo.maxDemandKw} kW</span>
                {demandPeakInfo.measuredGridPeakKw > 0 && (
                  <span className="text-slate-400 font-medium ml-1">
                    (実測系統ピーク: {demandPeakInfo.measuredGridPeakKw} kW)
                  </span>
                )}
              </p>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg">
                ピーク抑制効果: 最大デマンド▲{demandPeakInfo.peakCutContributionKw}kW抑制（基本料削減 月
                {(demandPeakInfo.monthlyBaseDiscountYen / 1000).toFixed(0)}千円貢献）
              </p>
            </div>
          </div>

          <div className="bg-white px-5 py-3.5 rounded-2xl border border-slate-100 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <span className="text-xs font-extrabold text-slate-700">
                🌿 環境価値・CO2削減実績（係数: 0.000434 t-CO2/kWh）
              </span>
              <p className="text-xs font-bold text-emerald-700 mt-1">
                当月CO2削減量: <span className="text-sm font-black">{co2ReductionInfo.monthlyCo2Ton} t-CO2</span>
                （杉の木 <span className="font-black">{co2ReductionInfo.monthlyCedarTrees}</span> 本分）
              </p>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-[11px] font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg">
                年間CO2削減量({co2ReductionInfo.isAnnualActual ? '実績累計' : '通期推計'}):{' '}
                <span className="font-extrabold text-slate-900">{co2ReductionInfo.annualCo2Ton} t-CO2</span>（杉の木{' '}
                {co2ReductionInfo.annualCedarTrees.toLocaleString()}本分）
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 📉 グラフ・シミュレーター表示枠 */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 print:p-4 print:border-slate-200 print:shadow-none">
        <div
          className={`${
            activeTab === 1 ||
            activeTab === 2 ||
            activeTab === 3 ||
            activeTab === 6 ||
            activeTab === 7
              ? 'h-auto space-y-12'
              : 'h-[400px]'
          } w-full`}
        >
          {isLoading ? (
            <div className="h-[400px] flex items-center justify-center text-slate-400 font-medium">
              データを処理・読み込み中...
            </div>
          ) : (
            <>
              {/* タブ1：日次データ */}
              {activeTab === 1 && dailyData.length > 0 && (
                <div className="space-y-12">
                  <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                    <h3 className="text-sm font-bold text-slate-500 mb-4">
                      📈 {selectedMonth}月度 日次:消費電力分析（kWh）
                    </h3>
                    <div className="h-[350px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={dailyData}
                          syncId="dailyDataSync"
                          margin={{ top: 20, right: 10, left: 0, bottom: 0 }}
                        >
                          <CartesianGrid
                            yAxisId="left"
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke="#e2e8f0"
                          />
                          <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                          <YAxis
                            yAxisId="left"
                            stroke="#94a3b8"
                            tick={{ fontSize: 12 }}
                            tickLine={true}
                            domain={[0, yMaxCons]}
                            width={55}
                          />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            tick={false}
                            tickLine={false}
                            axisLine={false}
                            width={55}
                          />
                          <Tooltip contentStyle={{ borderRadius: '16px', border: 'none' }} />
                          <Legend />
                          <Bar
                            yAxisId="left"
                            dataKey="solarFrom"
                            stackId="a"
                            name="太陽光から (自家消費 kWh)"
                            fill="#10b981"
                            maxBarSize={40}
                          />
                          <Bar
                            yAxisId="left"
                            dataKey="gridFrom"
                            stackId="a"
                            name="系統から (買電 kWh)"
                            fill="#f43f5e"
                            maxBarSize={40}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                    <h3 className="text-sm font-bold text-slate-500 mb-4">
                      ☀️ {selectedMonth}月度 日次:発電量と日照時間の推移
                    </h3>
                    <div className="h-[350px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={dailyData}
                          syncId="dailyDataSync"
                          margin={{ top: 20, right: 10, left: 0, bottom: 0 }}
                        >
                          <CartesianGrid
                            yAxisId="left"
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke="#e2e8f0"
                          />
                          <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                          <YAxis
                            yAxisId="left"
                            stroke="#94a3b8"
                            tick={{ fontSize: 12 }}
                            tickLine={true}
                            domain={[0, yMaxGen]}
                            width={55}
                          />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            stroke="#94a3b8"
                            tick={{ fontSize: 12 }}
                            tickLine={true}
                            domain={[0, yMaxSun]}
                            width={55}
                          />
                          <Tooltip contentStyle={{ borderRadius: '16px', border: 'none' }} />
                          <Legend />
                          <Bar
                            yAxisId="left"
                            dataKey="generation"
                            name="日次発電量 (kWh)"
                            fill="#3b82f6"
                            radius={[4, 4, 0, 0]}
                            maxBarSize={40}
                          />
                          <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="sunlight"
                            name="日照時間 (時間)"
                            stroke="#f59e0b"
                            strokeWidth={2}
                            dot={{
                              r: 4,
                              fill: '#f59e0b',
                              stroke: '#fff',
                              strokeWidth: 2,
                            }}
                            activeDot={{ r: 6 }}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              )}

              {/* タブ2：月次データ */}
              {activeTab === 2 && (
                <div className="space-y-12">
                  <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                    <h3 className="text-sm font-bold text-slate-500 mb-4">
                      📈 {selectedYear}年 月次:消費電力分析（kWh）
                    </h3>
                    <div className="h-[350px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={monthlyChartDataExtended}
                          syncId="monthlyDataSync"
                          margin={{ top: 20, right: 10, left: 0, bottom: 0 }}
                        >
                          <CartesianGrid
                            yAxisId="left"
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke="#e2e8f0"
                          />
                          <XAxis dataKey="monthLabel" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                          <YAxis
                            yAxisId="left"
                            stroke="#94a3b8"
                            tick={{ fontSize: 12 }}
                            tickLine={true}
                            domain={[0, yMaxMonthCons]}
                            width={55}
                          />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            tick={false}
                            tickLine={false}
                            axisLine={false}
                            width={55}
                          />
                          <Tooltip contentStyle={{ borderRadius: '16px', border: 'none' }} />
                          <Legend />
                          <Bar
                            yAxisId="left"
                            dataKey="solarFrom"
                            stackId="a"
                            name="太陽光から (自家消費 kWh)"
                            fill="#10b981"
                            maxBarSize={40}
                          />
                          <Bar
                            yAxisId="left"
                            dataKey="gridFrom"
                            stackId="a"
                            name="系統から (買電 kWh)"
                            fill="#f43f5e"
                            maxBarSize={40}
                          />
                          <Line
                            yAxisId="left"
                            type="monotone"
                            dataKey="consumption"
                            name="総消費電力 (kWh)"
                            stroke="#0f172a"
                            strokeWidth={2}
                            dot={{
                              r: 4,
                              fill: '#0f172a',
                              stroke: '#fff',
                              strokeWidth: 2,
                            }}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                    <h3 className="text-sm font-bold text-slate-500 mb-4">
                      ☀️ {selectedYear}年 月次:発電量と日照時間の推移
                    </h3>
                    <div className="h-[350px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={monthlyChartDataExtended}
                          syncId="monthlyDataSync"
                          margin={{ top: 20, right: 10, left: 0, bottom: 0 }}
                        >
                          <CartesianGrid
                            yAxisId="left"
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke="#e2e8f0"
                          />
                          <XAxis dataKey="monthLabel" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                          <YAxis
                            yAxisId="left"
                            stroke="#94a3b8"
                            tick={{ fontSize: 12 }}
                            tickLine={true}
                            domain={[0, yMaxMonthGen]}
                            width={55}
                          />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            stroke="#94a3b8"
                            tick={{ fontSize: 12 }}
                            tickLine={true}
                            domain={[0, yMaxMonthSun]}
                            width={55}
                          />
                          <Tooltip contentStyle={{ borderRadius: '16px', border: 'none' }} />
                          <Legend />
                          <Bar
                            yAxisId="left"
                            dataKey="generation"
                            name="月次発電量 (kWh)"
                            fill="#3b82f6"
                            radius={[4, 4, 0, 0]}
                            maxBarSize={40}
                          />
                          <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="sunlight"
                            name="月次総日照時間 (時間)"
                            stroke="#eab308"
                            strokeWidth={2}
                            dot={{
                              r: 4,
                              fill: '#eab308',
                              stroke: '#fff',
                              strokeWidth: 2,
                            }}
                            activeDot={{ r: 6 }}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              )}

              {/* タブ3：相関図 */}
              {activeTab === 3 && dailyData.length > 0 && (
                <div className="space-y-12">
                  <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                    <h3 className="text-sm font-bold text-slate-500 mb-4">
                      📊 {selectedMonth}月度 日次相関分析（赤＝当月傾向線 ／ 緑＝年間通期傾向線）
                    </h3>
                    <div className="h-[350px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart margin={{ top: 20, right: 20, left: -10, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis
                            type="number"
                            dataKey="sunlight"
                            name="日照時間"
                            unit="h"
                            stroke="#94a3b8"
                            tick={{ fontSize: 12 }}
                            domain={[0, yMaxSun]}
                          />
                          <YAxis
                            type="number"
                            dataKey="generation"
                            name="発電量"
                            unit="kWh"
                            stroke="#94a3b8"
                            tick={{ fontSize: 12 }}
                            domain={[0, yMaxGen]}
                          />
                          <Tooltip content={<CustomScatterTooltip />} />
                          <Legend />
                          <Scatter
                            name="各日の実測値"
                            data={dailyData}
                            fill="#3b82f6"
                            shape="circle"
                            fillOpacity={0.8}
                          />
                          {monthTrend.length > 0 && (
                            <Line
                              data={monthTrend}
                              type="monotone"
                              dataKey="trend"
                              name="当月傾向線"
                              stroke="#f43f5e"
                              strokeWidth={2}
                              dot={{
                                r: 5,
                                fill: '#f43f5e',
                                stroke: '#fff',
                                strokeWidth: 2,
                              }}
                              activeDot={false}
                            />
                          )}
                          {yearTrend.length > 0 && (
                            <Line
                              data={yearTrend}
                              type="monotone"
                              dataKey="trend"
                              name="年間通期傾向線（比較用）"
                              stroke="#10b981"
                              strokeWidth={2}
                              strokeDasharray="5 5"
                              dot={false}
                              activeDot={false}
                            />
                          )}
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                    <h3 className="text-sm font-bold text-slate-500 mb-4">
                      📅 {selectedYear}年 年間日次相関分析（通期トレンド・外れ値抽出）
                    </h3>
                    <div className="h-[350px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart margin={{ top: 20, right: 20, left: -10, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis
                            type="number"
                            dataKey="sunlight"
                            name="日照時間"
                            unit="h"
                            stroke="#94a3b8"
                            tick={{ fontSize: 12 }}
                            domain={[0, yMaxSun]}
                          />
                          <YAxis
                            type="number"
                            dataKey="generation"
                            name="発電量"
                            unit="kWh"
                            stroke="#94a3b8"
                            tick={{ fontSize: 12 }}
                            domain={[0, yMaxGen]}
                          />
                          <Tooltip content={<CustomScatterTooltip />} />
                          <Legend />
                          <Scatter
                            name="年間の全日次データ"
                            data={dailyDataThisYear}
                            fill="#64748b"
                            opacity={0.6}
                          />
                          {yearTrend.length > 0 && (
                            <Line
                              data={yearTrend}
                              type="monotone"
                              dataKey="trend"
                              name="年間通期傾向線"
                              stroke="#10b981"
                              strokeWidth={2}
                              dot={{
                                r: 5,
                                fill: '#10b981',
                                stroke: '#fff',
                                strokeWidth: 2,
                              }}
                              activeDot={false}
                            />
                          )}
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              )}

              {/* タブ4：前年同月比較 */}
              {activeTab === 4 && (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={yoySummaryData}
                    margin={{ top: 20, right: 20, left: -10, bottom: 0 }}
                  >
                    <CartesianGrid
                      yAxisId="left"
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="#e2e8f0"
                    />
                    <XAxis
                      dataKey="name"
                      stroke="#94a3b8"
                      tick={{ fontSize: 14, fontWeight: 'bold' }}
                    />
                    <YAxis
                      yAxisId="left"
                      stroke="#94a3b8"
                      tick={{ fontSize: 12 }}
                      tickLine={true}
                      domain={[0, yMaxSummary]}
                    />
                    <Tooltip
                      cursor={{ fill: '#f8fafc' }}
                      contentStyle={{ borderRadius: '16px', border: 'none' }}
                    />
                    <Legend />
                    <Bar
                      yAxisId="left"
                      dataKey="前年同月"
                      fill="#cbd5e1"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={60}
                    />
                    <Bar
                      yAxisId="left"
                      dataKey="選択月"
                      fill="#0f172a"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={60}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}

              {(activeTab === 1 || activeTab === 3) && dailyData.length === 0 && (
                <div className="h-[400px] flex items-center justify-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  <p className="text-slate-400 font-medium">
                    対象データがありません。CSVをインポートしてください。
                  </p>
                </div>
              )}

              {/* タブ5：年間:発電予実 */}
              {activeTab === 5 && (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={annualChartData}
                    margin={{ top: 20, right: 20, left: -10, bottom: 0 }}
                  >
                    <CartesianGrid
                      yAxisId="left"
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="#e2e8f0"
                    />
                    <XAxis dataKey="monthLabel" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                    <YAxis
                      yAxisId="left"
                      stroke="#94a3b8"
                      tick={{ fontSize: 12 }}
                      tickLine={true}
                    />
                    <Tooltip
                      cursor={{ fill: '#f8fafc' }}
                      contentStyle={{ borderRadius: '16px', border: 'none' }}
                    />
                    <Legend />
                    <Bar
                      yAxisId="left"
                      dataKey="actual"
                      name="実績 (kWh)"
                      fill="#3b82f6"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={40}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="sim"
                      name="シミュレーション目標"
                      stroke="#f59e0b"
                      strokeWidth={3}
                      dot={{
                        r: 4,
                        fill: '#f59e0b',
                        stroke: '#fff',
                        strokeWidth: 2,
                      }}
                      activeDot={{ r: 6 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}

              {/* タブ6：投資回収 ＆ 機器更新タイマー（設備保全） */}
              {activeTab === 6 && (
                <div className="space-y-10">
                  <div className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                    <h3 className="text-sm font-bold text-slate-500 mb-4">
                      💹 投資回収推移（単位: 千円 ／ 設備投資・補助金・高圧単価連動）
                    </h3>
                    <div className="h-[360px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart
                          data={roiData}
                          margin={{ top: 20, right: 20, left: -10, bottom: 0 }}
                        >
                          <CartesianGrid
                            yAxisId="left"
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke="#e2e8f0"
                          />
                          <XAxis dataKey="year" stroke="#94a3b8" />
                          <YAxis
                            yAxisId="left"
                            stroke="#94a3b8"
                            tick={{ fontSize: 12 }}
                            tickLine={true}
                          />
                          <Tooltip />
                          <Legend />
                          <ReferenceLine yAxisId="left" y={0} stroke="#94a3b8" strokeWidth={2} />
                          <Bar
                            yAxisId="left"
                            dataKey="actual"
                            name="累計実績 (千円)"
                            fill="#3b82f6"
                            radius={[6, 6, 0, 0]}
                            maxBarSize={40}
                          />
                          <Line
                            yAxisId="left"
                            type="monotone"
                            dataKey="sim"
                            name="目標推移 (千円)"
                            stroke="#f59e0b"
                            strokeWidth={3}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* 🛠️ 【機能4】主要機器の法定耐用年数・寿命管理（機器更新タイマー＆メンテナンス積立推奨） */}
                  <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200/80 space-y-5 print-avoid-break">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                      <div>
                        <h3 className="text-base font-extrabold text-slate-900">
                          🛠️ 主要機器の法定耐用年数・寿命管理（設備保全タイマー）
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          長期安定稼働と将来のパワコン（PCS）更新に向けた計画的な内部留保ガイドライン
                        </p>
                      </div>
                      <span className="text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-full self-start md:self-auto">
                        導入開始: 2026年4月（現在 稼働{equipmentLifecycleInfo.operatingYear}年目）
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* 太陽光パネル */}
                      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-extrabold text-slate-800">
                            ☀️ 太陽光パネル（モジュール）
                          </span>
                          <span className="text-xs font-bold bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-full">
                            稼働 {equipmentLifecycleInfo.operatingYear}年目 / 期待寿命{' '}
                            {equipmentLifecycleInfo.panelLifeYears}年
                          </span>
                        </div>
                        <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full"
                            style={{
                              width: `${Math.min(
                                100,
                                (equipmentLifecycleInfo.operatingYear /
                                  equipmentLifecycleInfo.panelLifeYears) *
                                  100
                              )}%`,
                            }}
                          />
                        </div>
                        <div className="flex justify-between text-xs text-slate-500 font-medium">
                          <span>
                            経年劣化率: 年{equipmentLifecycleInfo.panelDegradationRate}%想定
                          </span>
                          <span>
                            現在想定出力維持率: {equipmentLifecycleInfo.currentPanelEfficiency}%
                          </span>
                        </div>
                      </div>

                      {/* パワーコンディショナ (PCS) */}
                      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-extrabold text-slate-800">
                            ⚡ パワーコンディショナ（PCS）
                          </span>
                          <span className="text-xs font-bold bg-amber-50 text-amber-700 px-2.5 py-1 rounded-full">
                            稼働 {equipmentLifecycleInfo.operatingYear}年目 / 想定寿命{' '}
                            {equipmentLifecycleInfo.pcsMinLife}〜{equipmentLifecycleInfo.pcsMaxLife}年
                          </span>
                        </div>
                        <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-500 rounded-full"
                            style={{
                              width: `${Math.min(
                                100,
                                (equipmentLifecycleInfo.operatingYear /
                                  equipmentLifecycleInfo.pcsMaxLife) *
                                  100
                              )}%`,
                            }}
                          />
                        </div>
                        <div className="flex justify-between text-xs text-slate-500 font-medium">
                          <span>
                            次回入替え目安時期: {equipmentLifecycleInfo.pcsReplacePeriod}
                          </span>
                          <span>更新費用目安: 約150〜250万円</span>
                        </div>
                      </div>
                    </div>

                    {/* 経営提言メッセージ */}
                    <div className="p-4 rounded-2xl bg-blue-50/80 border border-blue-200 text-blue-950 text-xs md:text-sm font-bold flex items-start gap-3">
                      <span className="text-lg leading-none">💡</span>
                      <div>
                        <p>
                          経営提言：「電気代削減益（年約
                          {equipmentLifecycleInfo.estimatedAnnualSavingsManYen}
                          万円）のうち、年間約15〜20万円を『設備更新引当金』として内部留保することを推奨します。」
                        </p>
                        <p className="text-xs font-medium text-blue-700 mt-1">
                          ※ 10〜15年後のパワーコンディショナ更新（2035〜2038年頃）時に一時的なキャッシュアウトを防ぎ、無借金での機器更新が可能になります。
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* タブ7：【機能2】設備増設シミュレーター（パネル1枚単位） */}
              {activeTab === 7 && (
                <div className="space-y-10">
                  <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200/80 space-y-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-slate-200 pb-4">
                      <div>
                        <h3 className="text-lg font-extrabold text-slate-900">
                          🔋 パネル枚数単位・設備増設シミュレーター（15分値デマンド・余剰判定連動）
                        </h3>
                        <p className="text-xs text-slate-500 mt-1">
                          各15分コマの発電量を「(既設容量＋増設容量) ÷ 既設容量」で拡大し、各コマの消費電力量との比較から自家消費・余剰カット・回収年数を精緻に試算します。
                        </p>
                      </div>
                      <span className="text-xs font-bold bg-blue-600 text-white px-3 py-1.5 rounded-full self-start md:self-auto">
                        {expansionSimResult.usingRealIntervals
                          ? `実測15分値 (${expansionSimResult.intervalCount.toLocaleString()}コマ) 連動中`
                          : '標準15分負荷プロファイル推計モード'}
                      </span>
                    </div>

                    {/* パラメータ設定スライダー＆数値入力（4項目） */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                      {/* 1. 既設パネル容量 */}
                      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm space-y-2">
                        <div className="flex items-center justify-between">
                          <label
                            htmlFor="sim-base-cap"
                            className="text-xs font-bold text-slate-500"
                          >
                            ① 既設パネル容量
                          </label>
                          <span className="text-xs font-bold text-slate-400">
                            約{Math.round((simBaseCapacityKw * 1000) / Math.max(100, simPanelWatt))}枚相当
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            id="sim-base-cap"
                            type="number"
                            min={10}
                            max={500}
                            step={1}
                            value={simBaseCapacityKw}
                            onChange={(e) =>
                              setSimBaseCapacityKw(Math.max(1, Number(e.target.value) || 50))
                            }
                            className="w-24 px-3 py-1.5 rounded-xl border border-slate-200 text-base font-black text-slate-900"
                          />
                          <span className="text-sm font-bold text-slate-500">kW</span>
                        </div>
                        <input
                          type="range"
                          aria-label="既設パネル容量スライダー"
                          aria-valuetext={`${simBaseCapacityKw} kW`}
                          min={10}
                          max={200}
                          step={5}
                          value={simBaseCapacityKw}
                          style={getSliderCssVars(simBaseCapacityKw, 10, 200)}
                          onChange={(e) => setSimBaseCapacityKw(Number(e.target.value))}
                          className="sim-slider"
                        />
                      </div>

                      {/* 2. 増設パネル枚数（1枚単位） */}
                      <div className="bg-white p-4 rounded-2xl border border-blue-200 shadow-sm space-y-2 ring-2 ring-blue-500/10">
                        <div className="flex items-center justify-between">
                          <label
                            htmlFor="sim-added-panels"
                            className="text-xs font-extrabold text-blue-700"
                          >
                            ② 増設パネル枚数 (1枚単位)
                          </label>
                          <span className="text-xs font-extrabold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                            +{expansionSimResult.addedCapKw.toFixed(2)} kW増設
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            id="sim-added-panels"
                            type="number"
                            min={0}
                            max={1000}
                            step={1}
                            value={simAddedPanels}
                            onChange={(e) =>
                              setSimAddedPanels(Math.max(0, Math.round(Number(e.target.value) || 0)))
                            }
                            className="w-24 px-3 py-1.5 rounded-xl border border-blue-300 text-base font-black text-blue-700"
                          />
                          <span className="text-sm font-bold text-slate-500">
                            枚（合計 {expansionSimResult.totalCapKw.toFixed(1)} kW）
                          </span>
                        </div>
                        <input
                          type="range"
                          aria-label="増設パネル枚数スライダー"
                          aria-valuetext={`${simAddedPanels} 枚`}
                          min={0}
                          max={500}
                          step={1}
                          value={simAddedPanels}
                          style={getSliderCssVars(simAddedPanels, 0, 500)}
                          onChange={(e) => setSimAddedPanels(Number(e.target.value))}
                          className="sim-slider"
                        />
                      </div>

                      {/* 3. パネル1枚あたりの定格出力 */}
                      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm space-y-2">
                        <div className="flex items-center justify-between">
                          <label
                            htmlFor="sim-panel-watt"
                            className="text-xs font-bold text-slate-500"
                          >
                            ③ パネル1枚定格出力
                          </label>
                          <span className="text-xs font-bold text-slate-400">
                            {(simPanelWatt / 1000).toFixed(2)} kW/枚
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            id="sim-panel-watt"
                            type="number"
                            min={200}
                            max={700}
                            step={5}
                            value={simPanelWatt}
                            onChange={(e) =>
                              setSimPanelWatt(Math.max(100, Number(e.target.value) || 400))
                            }
                            className="w-24 px-3 py-1.5 rounded-xl border border-slate-200 text-base font-black text-slate-900"
                          />
                          <span className="text-sm font-bold text-slate-500">W / 枚</span>
                        </div>
                        <input
                          type="range"
                          aria-label="パネル1枚あたりの定格出力スライダー"
                          aria-valuetext={`${simPanelWatt} W`}
                          min={250}
                          max={650}
                          step={10}
                          value={simPanelWatt}
                          style={getSliderCssVars(simPanelWatt, 250, 650)}
                          onChange={(e) => setSimPanelWatt(Number(e.target.value))}
                          className="sim-slider"
                        />
                      </div>

                      {/* 4. 増設にかかる想定費用 */}
                      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm space-y-2">
                        <div className="flex items-center justify-between">
                          <label
                            htmlFor="sim-invest-cost"
                            className="text-xs font-bold text-slate-500"
                          >
                            ④ 増設にかかる想定費用
                          </label>
                          <span className="text-xs font-bold text-slate-400">
                            {(simInvestManYen * 10000).toLocaleString()} 円
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            id="sim-invest-cost"
                            type="number"
                            min={50}
                            max={5000}
                            step={10}
                            value={simInvestManYen}
                            onChange={(e) =>
                              setSimInvestManYen(Math.max(0, Number(e.target.value) || 0))
                            }
                            className="w-24 px-3 py-1.5 rounded-xl border border-slate-200 text-base font-black text-slate-900"
                          />
                          <span className="text-sm font-bold text-slate-500">万円</span>
                        </div>
                        <input
                          type="range"
                          aria-label="増設にかかる想定費用スライダー"
                          aria-valuetext={`${simInvestManYen} 万円`}
                          min={100}
                          max={2000}
                          step={25}
                          value={simInvestManYen}
                          style={getSliderCssVars(simInvestManYen, 100, 2000)}
                          onChange={(e) => setSimInvestManYen(Number(e.target.value))}
                          className="sim-slider"
                        />
                      </div>
                    </div>

                    {/* シミュレーション結果 4大指標カード */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      {/* 指標1: 新たな自家消費電力量と年間推定電気代削減額 */}
                      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
                        <p className="text-xs font-bold text-slate-400">
                          ① 年間推定電気代削減額（自家消費）
                        </p>
                        <p className="text-2xl font-black text-emerald-600 mt-2">
                          約 {(expansionSimResult.scaledAnnualSavingsYen / 10000).toFixed(1)}{' '}
                          <span className="text-xs font-bold text-slate-400">万円/年</span>
                        </p>
                        <p className="text-xs font-bold text-emerald-700 mt-1">
                          増設効果: +
                          {Math.round(expansionSimResult.addedAnnualSavingsYen / 1000).toLocaleString()}{' '}
                          千円/年
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          自家消費: {expansionSimResult.baseAnnualSelfKwh.toLocaleString()} ➔{' '}
                          {expansionSimResult.scaledAnnualSelfKwh.toLocaleString()} kWh/年
                        </p>
                      </div>

                      {/* 指標2: 新たな電力自給率 (%) */}
                      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
                        <p className="text-xs font-bold text-slate-400">② 新たな電力自給率</p>
                        <p className="text-2xl font-black text-amber-600 mt-2">
                          {expansionSimResult.scaledSelfSufficiency.toFixed(1)}{' '}
                          <span className="text-xs font-bold text-slate-400">%</span>
                        </p>
                        <p className="text-xs font-bold text-amber-700 mt-1">
                          現状 {expansionSimResult.baseSelfSufficiency.toFixed(1)}% から +
                          {(
                            expansionSimResult.scaledSelfSufficiency -
                            expansionSimResult.baseSelfSufficiency
                          ).toFixed(1)}
                          pt 向上
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          発電倍率: {expansionSimResult.scaleFactor.toFixed(2)}倍 (
                          {expansionSimResult.totalCapKw.toFixed(1)}kW)
                        </p>
                      </div>

                      {/* 指標3: 余剰電力量（カット/捨てられる電力量） */}
                      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
                        <p className="text-xs font-bold text-slate-400">
                          ③ 年間余剰電力量（消費超過カット分）
                        </p>
                        <p className="text-2xl font-black text-rose-600 mt-2">
                          {expansionSimResult.scaledAnnualSurplusKwh.toLocaleString()}{' '}
                          <span className="text-xs font-bold text-slate-400">kWh/年</span>
                        </p>
                        <p className="text-xs font-bold text-rose-700 mt-1">
                          現状余剰: {expansionSimResult.baseAnnualSurplusKwh.toLocaleString()} kWh/年
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          ※ 蓄電池併用やデマンドシフトでさらなる活用余地あり
                        </p>
                      </div>

                      {/* 指標4: 増設投資の回収見込み期間（年数） */}
                      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
                        <p className="text-xs font-bold text-slate-400">
                          ④ 増設投資の回収見込み期間
                        </p>
                        <p className="text-2xl font-black text-blue-600 mt-2">
                          {expansionSimResult.paybackYears}{' '}
                          <span className="text-xs font-bold text-slate-400">年</span>
                        </p>
                        <p className="text-xs font-bold text-blue-700 mt-1">
                          増設投資額: {simInvestManYen.toLocaleString()} 万円
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          パネル期待寿命25年に対して十分な投資採算性
                        </p>
                      </div>
                    </div>

                    {/* 増設前後の比較バーチャート */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-100">
                      <h4 className="text-sm font-bold text-slate-600 mb-4">
                        📊 増設前後（既設 {expansionSimResult.baseCapKw}kW vs 増設後{' '}
                        {expansionSimResult.totalCapKw.toFixed(1)}kW [+{simAddedPanels}枚]）の年間電力量比較（kWh）
                      </h4>
                      <div className="h-[340px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart
                            data={expansionSimResult.comparisonChartData}
                            margin={{ top: 20, right: 20, left: 0, bottom: 0 }}
                          >
                            <CartesianGrid
                              yAxisId="left"
                              strokeDasharray="3 3"
                              vertical={false}
                              stroke="#e2e8f0"
                            />
                            <XAxis
                              dataKey="stage"
                              stroke="#94a3b8"
                              tick={{ fontSize: 13, fontWeight: 'bold' }}
                            />
                            <YAxis
                              yAxisId="left"
                              stroke="#94a3b8"
                              tick={{ fontSize: 12 }}
                              tickLine={true}
                            />
                            <Tooltip
                              cursor={{ fill: '#f8fafc' }}
                              contentStyle={{ borderRadius: '16px', border: 'none' }}
                            />
                            <Legend />
                            <Bar
                              yAxisId="left"
                              dataKey="自家消費電力量"
                              name="自家消費電力量 (kWh)"
                              fill="#10b981"
                              radius={[6, 6, 0, 0]}
                              maxBarSize={55}
                            />
                            <Bar
                              yAxisId="left"
                              dataKey="系統買電量"
                              name="系統からの買電量 (kWh)"
                              fill="#f43f5e"
                              radius={[6, 6, 0, 0]}
                              maxBarSize={55}
                            />
                            <Bar
                              yAxisId="left"
                              dataKey="余剰電力量"
                              name="余剰電力量・カット分 (kWh)"
                              fill="#f59e0b"
                              radius={[6, 6, 0, 0]}
                              maxBarSize={55}
                            />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 🖨️ A4印刷時（経営レポート出力）専用エグゼクティブ・フッター（設備保全＆内部留保提言） */}
              {activeTab !== 6 && (
                <div className="hidden print:block mt-6 pt-4 border-t border-slate-200 print-avoid-break">
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <p className="font-bold text-slate-500">☀️ 太陽光パネル寿命管理</p>
                      <p className="font-extrabold text-slate-900 mt-1">
                        稼働 {equipmentLifecycleInfo.operatingYear}年目 / 期待寿命25年（劣化率: 年0.5%想定）
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <p className="font-bold text-slate-500">⚡ パワコン(PCS)更新タイマー</p>
                      <p className="font-extrabold text-slate-900 mt-1">
                        稼働 {equipmentLifecycleInfo.operatingYear}年目 / 想定寿命10〜15年（次回目安: 2035〜2038年）
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-blue-50 border border-blue-200">
                      <p className="font-bold text-blue-800">💡 設備更新引当金 経営提言</p>
                      <p className="font-bold text-blue-950 mt-1">
                        削減益（年約{equipmentLifecycleInfo.estimatedAnnualSavingsManYen}万円）のうち年約15〜20万円を内部留保推奨
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ⚡ 期間指定の電力単価設定モーダル */}
      <dialog
        ref={rateDialogRef}
        className="app-modal"
        aria-labelledby="rate-modal-title"
        {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      >
        <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 p-6 md:p-8 max-h-[88vh] overflow-y-auto text-slate-900">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h2 id="rate-modal-title" className="text-xl font-extrabold text-slate-900">
                ⚡ 期間別 電力単価設定（高圧契約・休日判定対応）
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                各測定日以前で最も新しい「適用開始日（YYYY-MM-DD）」の単価セットを自動適用します（日曜日・国民の祝日は終日夜間扱い）。
              </p>
            </div>
            <button
              type="button"
              onClick={closeRateModal}
              className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold flex items-center justify-center cursor-pointer"
              aria-label="閉じる"
            >
              ✕
            </button>
          </div>

          {/* 選択月の試算内訳プレビュー */}
          <div className="mt-5 space-y-3">
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div>
                <p className="text-slate-400 font-bold">
                  選択月 ({selectedYear}年{selectedMonth}月) 適用単価
                </p>
                <p className="text-sm font-black text-slate-800 mt-0.5">
                  {currentMonthSavingsInfo.rate.startDate} 適用中
                </p>
              </div>
              <div>
                <p className="text-slate-400 font-bold">電力量料金削減 (各単価合計)</p>
                <p className="text-sm font-black text-amber-600 mt-0.5">
                  {Math.round(currentMonthSavingsInfo.energySavingsYen).toLocaleString()} 円
                </p>
              </div>
              <div>
                <p className="text-slate-400 font-bold">
                  再エネ賦課金削減 ({currentMonthSavingsInfo.rate.renewableRate}円/kWh)
                </p>
                <p className="text-sm font-black text-indigo-600 mt-0.5">
                  {Math.round(currentMonthSavingsInfo.renewableSavingsYen).toLocaleString()} 円
                </p>
              </div>
              <div>
                <p className="text-slate-400 font-bold">当月収益改善額 (基本料1.5万円含)</p>
                <p className="text-sm font-black text-emerald-600 mt-0.5">
                  {Math.round(currentMonthSavingsInfo.savingsYen).toLocaleString()} 円 ({displayMonthlySavingsK} 千円)
                </p>
              </div>
            </div>

            {/* 時間帯・区分別自家消費の内訳 */}
            <div className="p-3.5 rounded-2xl bg-slate-50/70 border border-slate-100 grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
              <div>
                <span className="font-bold text-slate-400">夏季ピーク (平日13-16時):</span>{' '}
                <span className="font-extrabold text-slate-700">
                  {currentMonthSavingsInfo.summerPeakKwh.toFixed(1)} kWh
                </span>
              </div>
              <div>
                <span className="font-bold text-slate-400">夏季昼間 (平日8-13,16-22&土曜):</span>{' '}
                <span className="font-extrabold text-slate-700">
                  {currentMonthSavingsInfo.summerDayKwh.toFixed(1)} kWh
                </span>
              </div>
              <div>
                <span className="font-bold text-slate-400">その他季昼間 (平日・土曜8-22):</span>{' '}
                <span className="font-extrabold text-slate-700">
                  {currentMonthSavingsInfo.otherDayKwh.toFixed(1)} kWh
                </span>
              </div>
              <div>
                <span className="font-bold text-slate-400">夜間・休日 (22-翌8時 & 日祝終日):</span>{' '}
                <span className="font-extrabold text-slate-700">
                  {currentMonthSavingsInfo.nightKwh.toFixed(1)} kWh
                </span>
              </div>
            </div>
          </div>

          {/* 登録済み単価一覧テーブル */}
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-400 uppercase">
                  <th className="py-2.5 px-3">適用開始日</th>
                  <th className="py-2.5 px-3">夏季ピーク (平日13-16)</th>
                  <th className="py-2.5 px-3">夏季昼間 (平日8-13,16-22&土)</th>
                  <th className="py-2.5 px-3">その他季昼間 (平日・土8-22)</th>
                  <th className="py-2.5 px-3">夜間・休日 (22-8 & 日祝終日)</th>
                  <th className="py-2.5 px-3">再エネ賦課金</th>
                  <th className="py-2.5 px-3">基本料削減</th>
                  <th className="py-2.5 px-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...electricityRates]
                  .sort((a, b) =>
                    normalizeDateString(a.startDate).localeCompare(normalizeDateString(b.startDate))
                  )
                  .map((r) => {
                    const isApplied = r.id === currentMonthSavingsInfo.rate.id;
                    return (
                      <tr
                        key={r.id}
                        className={`${isApplied ? 'bg-amber-50/60' : 'hover:bg-slate-50'}`}
                      >
                        <td className="py-3 px-3 font-bold text-slate-900 whitespace-nowrap">
                          {r.startDate}
                          {isApplied && (
                            <span className="ml-2 text-[10px] bg-amber-500 text-white px-2 py-0.5 rounded-full font-bold">
                              選択月適用中
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 font-medium">{r.summerPeakRate} 円/kWh</td>
                        <td className="py-3 px-3 font-medium">{r.summerDayRate} 円/kWh</td>
                        <td className="py-3 px-3 font-medium">{r.otherDayRate} 円/kWh</td>
                        <td className="py-3 px-3 font-medium">{r.nightRate} 円/kWh</td>
                        <td className="py-3 px-3 font-medium">{r.renewableRate} 円/kWh</td>
                        <td className="py-3 px-3 font-medium whitespace-nowrap">
                          {r.baseDiscount.toLocaleString()} 円/月
                        </td>
                        <td className="py-3 px-3 text-right space-x-2 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleEditRate(r)}
                            className="text-xs font-bold text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50 cursor-pointer"
                          >
                            編集
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRate(r.id)}
                            className="text-xs font-bold text-rose-600 hover:text-rose-800 px-2 py-1 rounded hover:bg-rose-50 cursor-pointer"
                          >
                            削除
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {/* 単価追加・編集フォーム */}
          <form
            onSubmit={handleSaveRate}
            className="mt-6 p-5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-700">
                {editingRateId ? '✏️ 単価設定を編集' : '➕ 新しい期間単価を追加'}
              </h3>
              {editingRateId && (
                <button
                  type="button"
                  onClick={resetRateForm}
                  className="text-xs text-slate-500 hover:text-slate-800 font-bold cursor-pointer"
                >
                  新規追加モードへ戻す
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label
                  htmlFor="rate-start-date"
                  className="block text-xs font-bold text-slate-500 mb-1"
                >
                  適用開始日 (YYYY-MM-DD)
                </label>
                <input
                  id="rate-start-date"
                  type="date"
                  required
                  value={rateForm.startDate}
                  onChange={(e) => setRateForm({ ...rateForm, startDate: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold"
                />
              </div>
              <div>
                <label
                  htmlFor="rate-summer-peak"
                  className="block text-xs font-bold text-slate-500 mb-1"
                >
                  夏季ピーク (7/1-9/30平日 13-16時)
                </label>
                <input
                  id="rate-summer-peak"
                  type="number"
                  step="0.01"
                  required
                  placeholder="21.45"
                  value={rateForm.summerPeakRate}
                  onChange={(e) => setRateForm({ ...rateForm, summerPeakRate: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold"
                />
              </div>
              <div>
                <label
                  htmlFor="rate-summer-day"
                  className="block text-xs font-bold text-slate-500 mb-1"
                >
                  夏季昼間 (7/1-9/30平日 8-13,16-22&土)
                </label>
                <input
                  id="rate-summer-day"
                  type="number"
                  step="0.01"
                  required
                  placeholder="18.98"
                  value={rateForm.summerDayRate}
                  onChange={(e) => setRateForm({ ...rateForm, summerDayRate: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold"
                />
              </div>
              <div>
                <label
                  htmlFor="rate-other-day"
                  className="block text-xs font-bold text-slate-500 mb-1"
                >
                  その他季昼間 (10/1-翌6/30平日・土 8-22)
                </label>
                <input
                  id="rate-other-day"
                  type="number"
                  step="0.01"
                  required
                  placeholder="18.03"
                  value={rateForm.otherDayRate}
                  onChange={(e) => setRateForm({ ...rateForm, otherDayRate: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="rate-night"
                  className="block text-xs font-bold text-slate-500 mb-1"
                >
                  夜間・休日 (22-翌8時 & 日祝終日)
                </label>
                <input
                  id="rate-night"
                  type="number"
                  step="0.01"
                  required
                  placeholder="16.88"
                  value={rateForm.nightRate}
                  onChange={(e) => setRateForm({ ...rateForm, nightRate: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold"
                />
              </div>
              <div>
                <label
                  htmlFor="rate-renewable"
                  className="block text-xs font-bold text-slate-500 mb-1"
                >
                  再エネ賦課金 (円/kWh)
                </label>
                <input
                  id="rate-renewable"
                  type="number"
                  step="0.01"
                  required
                  placeholder="4.18"
                  value={rateForm.renewableRate}
                  onChange={(e) => setRateForm({ ...rateForm, renewableRate: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold"
                />
              </div>
              <div>
                <label
                  htmlFor="rate-base-discount"
                  className="block text-xs font-bold text-slate-500 mb-1"
                >
                  基本料削減効果 (円/月)
                </label>
                <input
                  id="rate-base-discount"
                  type="number"
                  step="100"
                  required
                  placeholder="15000"
                  value={rateForm.baseDiscount}
                  onChange={(e) => setRateForm({ ...rateForm, baseDiscount: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeRateModal}
                className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-bold hover:bg-slate-100 cursor-pointer"
              >
                閉じる
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 shadow cursor-pointer"
              >
                {editingRateId ? '更新して保存' : '単価設定を追加'}
              </button>
            </div>
          </form>
        </div>
      </dialog>

      {/* 💰 設備投資・経費履歴管理モーダル */}
      <dialog
        ref={investmentDialogRef}
        className="app-modal"
        aria-labelledby="investment-modal-title"
        {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
      >
        <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 p-6 md:p-8 max-h-[88vh] overflow-y-auto text-slate-900">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <h2 id="investment-modal-title" className="text-xl font-extrabold text-slate-900">
                💰 設備投資・経費履歴の管理
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                初期設置工事・パネル増設・パワコン更新・定期保守費・補助金（控除）を時系列で管理し、投資回収率へ動的に反映します
              </p>
            </div>
            <button
              type="button"
              onClick={closeInvestmentModal}
              className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold flex items-center justify-center cursor-pointer"
              aria-label="閉じる"
            >
              ✕
            </button>
          </div>

          {/* 累計投資＆回収サマリー */}
          <div className="mt-5 p-4 rounded-2xl bg-slate-50 border border-slate-100 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div>
              <p className="text-slate-400 font-bold">
                選択月 ({selectedYear}年{selectedMonth}月) 時点の累計投資・経費純額
              </p>
              <p className="text-base font-black text-slate-900 mt-0.5">
                {effectiveInvestmentYen.toLocaleString()} 円
              </p>
            </div>
            <div>
              <p className="text-slate-400 font-bold">
                選択月 ({selectedYear}年{selectedMonth}月) 時点の累計収益改善額
              </p>
              <p className="text-base font-black text-emerald-600 mt-0.5">
                {Math.round(cumulativeSavingsUpToSelectedYen).toLocaleString()} 円
              </p>
            </div>
            <div>
              <p className="text-slate-400 font-bold">動的投資回収率 ／ 全期間投資総額</p>
              <p className="text-base font-black text-blue-600 mt-0.5">
                {displayDynamicRoiRate}%{' '}
                <span className="text-xs font-medium text-slate-400">
                  (全期間純投資: {totalAllInvestmentsYen.toLocaleString()}円)
                </span>
              </p>
            </div>
          </div>

          {/* 投資・経費一覧テーブル */}
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-400 uppercase">
                  <th className="py-2.5 px-3">発生年月</th>
                  <th className="py-2.5 px-3">区分</th>
                  <th className="py-2.5 px-3">項目名 / 備考</th>
                  <th className="py-2.5 px-3 text-right">金額 (円)</th>
                  <th className="py-2.5 px-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...investments]
                  .sort((a, b) =>
                    normalizeYearMonth(a.date).localeCompare(normalizeYearMonth(b.date))
                  )
                  .map((inv) => {
                    const isIncludedInSelected =
                      normalizeYearMonth(inv.date) <= selectedYMNormalized;
                    return (
                      <tr key={inv.id} className="hover:bg-slate-50">
                        <td className="py-3 px-3 font-bold text-slate-900">
                          {normalizeYearMonth(inv.date)}
                          {!isIncludedInSelected && (
                            <span className="ml-2 text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-bold">
                              選択月より未来
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`inline-block text-xs font-bold px-2.5 py-1 rounded-full ${
                              inv.amount < 0
                                ? 'bg-emerald-50 text-emerald-700'
                                : inv.category.includes('保守')
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-blue-50 text-blue-700'
                            }`}
                          >
                            {inv.category}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-bold text-slate-800">{inv.title}</div>
                          {inv.notes && <div className="text-xs text-slate-400">{inv.notes}</div>}
                        </td>
                        <td
                          className={`py-3 px-3 text-right font-extrabold ${
                            inv.amount < 0 ? 'text-emerald-600' : 'text-slate-900'
                          }`}
                        >
                          {inv.amount.toLocaleString()} 円
                        </td>
                        <td className="py-3 px-3 text-right space-x-2">
                          <button
                            type="button"
                            onClick={() => handleEditInvestment(inv)}
                            className="text-xs font-bold text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50 cursor-pointer"
                          >
                            編集
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteInvestment(inv.id)}
                            className="text-xs font-bold text-rose-600 hover:text-rose-800 px-2 py-1 rounded hover:bg-rose-50 cursor-pointer"
                          >
                            削除
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {/* 投資・経費追加／編集フォーム */}
          <form
            onSubmit={handleSaveInvestment}
            className="mt-6 p-5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-700">
                {editingInvestmentId
                  ? '✏️ 投資・経費項目を編集'
                  : '➕ 新しい設備投資・経費・補助金を追加'}
              </h3>
              {editingInvestmentId && (
                <button
                  type="button"
                  onClick={resetInvestmentForm}
                  className="text-xs text-slate-500 hover:text-slate-800 font-bold cursor-pointer"
                >
                  新規追加モードへ戻す
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label
                  htmlFor="inv-date"
                  className="block text-xs font-bold text-slate-500 mb-1"
                >
                  発生年月
                </label>
                <input
                  id="inv-date"
                  type="month"
                  required
                  value={investmentForm.date}
                  onChange={(e) => setInvestmentForm({ ...investmentForm, date: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold"
                />
              </div>
              <div>
                <label
                  htmlFor="inv-category"
                  className="block text-xs font-bold text-slate-500 mb-1"
                >
                  区分
                </label>
                <select
                  id="inv-category"
                  value={investmentForm.category}
                  onChange={(e) =>
                    setInvestmentForm({ ...investmentForm, category: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold"
                >
                  {INVESTMENT_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="inv-title"
                  className="block text-xs font-bold text-slate-500 mb-1"
                >
                  項目名
                </label>
                <input
                  id="inv-title"
                  type="text"
                  required
                  placeholder="例: パネル増設工事 / PCS更新"
                  value={investmentForm.title}
                  onChange={(e) => setInvestmentForm({ ...investmentForm, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold"
                />
              </div>
              <div>
                <label
                  htmlFor="inv-amount"
                  className="block text-xs font-bold text-slate-500 mb-1"
                >
                  金額 (円 ※補助金はマイナス)
                </label>
                <input
                  id="inv-amount"
                  type="number"
                  step="1000"
                  required
                  placeholder="例: 5000000 または -2000000"
                  value={investmentForm.amount}
                  onChange={(e) =>
                    setInvestmentForm({ ...investmentForm, amount: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="inv-notes"
                className="block text-xs font-bold text-slate-500 mb-1"
              >
                備考 (任意)
              </label>
              <input
                id="inv-notes"
                type="text"
                placeholder="工事内容・保守契約の詳細など"
                value={investmentForm.notes}
                onChange={(e) => setInvestmentForm({ ...investmentForm, notes: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeInvestmentModal}
                className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-bold hover:bg-slate-100 cursor-pointer"
              >
                閉じる
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 shadow cursor-pointer"
              >
                {editingInvestmentId ? '更新して保存' : '履歴に追加'}
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </div>
  );
}
