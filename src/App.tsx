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
  const [activeTab, setActiveTab] = useState(1);

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

        const timeIdx = headers.indexOf('測定時間');
        const genKwIdx = headers.indexOf('発電 (kW)');
        const toBuildingKwIdx = headers.indexOf('建物へ (kW)');
        const toGridKwIdx = headers.indexOf('系統へ (kW)');
        const consKwIdx = headers.indexOf('消費 (kW)');
        const solarKwIdx = headers.indexOf('太陽光から (kW)');
        const gridFromKwIdx = headers.indexOf('系統から (kW)');

        for (let i = headerLineIdx + 1; i < lines.length; i++) {
          const cols = parseCSVLine(lines[i]);
          if (cols.length <= timeIdx) continue;

          const parsedTime = parseMeasurementTime(cols[timeIdx]);
          if (!parsedTime) continue;

          // 取得値 (kW) を 4 で割って電力量 (kWh) に変換 (kW / 4)
          const generation =
            genKwIdx !== -1 ? parseNumberValue(cols[genKwIdx]) / 4 : 0;
          const toBuilding =
            toBuildingKwIdx !== -1 ? parseNumberValue(cols[toBuildingKwIdx]) / 4 : 0;
          const toGrid =
            toGridKwIdx !== -1 ? parseNumberValue(cols[toGridKwIdx]) / 4 : 0;
          const consumption =
            consKwIdx !== -1 ? parseNumberValue(cols[consKwIdx]) / 4 : 0;
          const solarFrom =
            solarKwIdx !== -1 ? parseNumberValue(cols[solarKwIdx]) / 4 : 0;
          const gridFrom =
            gridFromKwIdx !== -1 ? parseNumberValue(cols[gridFromKwIdx]) / 4 : 0;

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

  const roiData = [
    { year: '0年', sim: -10000, actual: -10000 },
    { year: '1年', sim: -8547, actual: -8200 },
    { year: '2年', sim: -7099, actual: -6500 },
    { year: '3年', sim: -5658, actual: -5000 },
    { year: '4年', sim: -4223, actual: null },
  ];

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
      <div className="sticky top-0 z-50 bg-slate-50/95 backdrop-blur-sm pt-6 md:pt-10 pb-6 border-b border-slate-200/60 -mx-6 md:-mx-10 px-6 md:px-10 mb-8 print:relative print:border-none print:p-0 print:m-0">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 print:mb-0">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
              西岡勝次商店 分析レポート
            </h1>
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
          <div className="flex gap-3 print:hidden">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="bg-slate-900 text-white px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-slate-800 transition-all shadow-lg cursor-pointer disabled:opacity-50"
            >
              {isLoading ? '処理中...' : 'データインポート'}
            </button>
          </div>
        </header>

        {/* タブ選択ボタン群 */}
        <div className="flex flex-wrap gap-3 mt-6 print:hidden">
          {['日次データ', '月次データ', '相関図', '前年同月比較', '年間:発電予実', '投資回収'].map(
            (t, i) => (
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
            )
          )}
        </div>

        {/* 📊 KPI表示枠（4枚のKPIカード） */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-6 print:grid-cols-4">
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
              val: '442',
              unit: '千円',
              sub: '当月推定値',
              color: 'text-slate-800',
            },
            {
              label: '投資回収率',
              val: '50.0',
              unit: '%',
              sub: '初期投資比',
              color: 'text-blue-600',
            },
          ].map((kpi) => (
            <div
              key={kpi.label}
              className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm"
            >
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                {kpi.label}
              </p>
              <p className={`text-3xl font-black mt-2 ${kpi.color}`}>
                {kpi.val}{' '}
                <span className="text-sm font-medium text-slate-400">{kpi.unit}</span>
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 📉 グラフ表示枠 */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8">
        <div
          className={`${
            activeTab === 1 || activeTab === 2 || activeTab === 3
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
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke="#f1f5f9"
                          />
                          <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                          <YAxis
                            yAxisId="left"
                            stroke="#94a3b8"
                            tick={{ fontSize: 12 }}
                            domain={[0, yMaxCons]}
                            width={55}
                          />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            tick={false}
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
                            dot={false}
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
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke="#f1f5f9"
                          />
                          <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                          <YAxis
                            yAxisId="left"
                            stroke="#94a3b8"
                            tick={{ fontSize: 12 }}
                            domain={[0, yMaxGen]}
                            width={55}
                          />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            stroke="#94a3b8"
                            tick={{ fontSize: 12 }}
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
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke="#f1f5f9"
                          />
                          <XAxis dataKey="monthLabel" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                          <YAxis
                            yAxisId="left"
                            stroke="#94a3b8"
                            tick={{ fontSize: 12 }}
                            domain={[0, yMaxMonthCons]}
                            width={55}
                          />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            tick={false}
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
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke="#f1f5f9"
                          />
                          <XAxis dataKey="monthLabel" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                          <YAxis
                            yAxisId="left"
                            stroke="#94a3b8"
                            tick={{ fontSize: 12 }}
                            domain={[0, yMaxMonthGen]}
                            width={55}
                          />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            stroke="#94a3b8"
                            tick={{ fontSize: 12 }}
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
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="#f1f5f9"
                    />
                    <XAxis
                      dataKey="name"
                      stroke="#94a3b8"
                      tick={{ fontSize: 14, fontWeight: 'bold' }}
                    />
                    <YAxis stroke="#94a3b8" tick={{ fontSize: 12 }} domain={[0, yMaxSummary]} />
                    <Tooltip
                      cursor={{ fill: '#f8fafc' }}
                      contentStyle={{ borderRadius: '16px', border: 'none' }}
                    />
                    <Legend />
                    <Bar
                      dataKey="前年同月"
                      fill="#cbd5e1"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={60}
                    />
                    <Bar
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
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="#f1f5f9"
                    />
                    <XAxis dataKey="monthLabel" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                    <YAxis stroke="#94a3b8" tick={{ fontSize: 12 }} />
                    <Tooltip
                      cursor={{ fill: '#f8fafc' }}
                      contentStyle={{ borderRadius: '16px', border: 'none' }}
                    />
                    <Legend />
                    <Bar
                      dataKey="actual"
                      name="実績 (kWh)"
                      fill="#3b82f6"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={40}
                    />
                    <Line
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

              {/* タブ6：投資回収 */}
              {activeTab === 6 && (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={roiData}
                    margin={{ top: 20, right: 20, left: -10, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="#f1f5f9"
                    />
                    <XAxis dataKey="year" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip />
                    <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={2} />
                    <Bar
                      dataKey="actual"
                      name="累計実績"
                      fill="#3b82f6"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={40}
                    />
                    <Line
                      type="monotone"
                      dataKey="sim"
                      name="目標推移"
                      stroke="#f59e0b"
                      strokeWidth={3}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
