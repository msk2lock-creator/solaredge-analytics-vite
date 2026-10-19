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
  item: DailyDataItem,
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
const isStrictMatchingYear = (item: DailyDataItem, year: string | number): boolean => {
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
  const [allDailyData, setAllDailyData] = useState<DailyDataItem[]>([]);
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
          yearStr: string;
          monthStr: string;
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

        const headers = parseCSVLine(lines[0]).map((h) => h.replace(/^\uFEFF/, '').trim());

        const timeIdx = headers.indexOf('測定時間');
        const genKwIdx = headers.indexOf('発電 (kW)');
        const toBuildingKwIdx = headers.indexOf('建物へ (kW)');
        const toGridKwIdx = headers.indexOf('系統へ (kW)');
        const consKwIdx = headers.indexOf('消費 (kW)');
        const solarKwIdx = headers.indexOf('太陽光から (kW)');
        const gridFromKwIdx = headers.indexOf('系統から (kW)');

        if (timeIdx === -1) {
          throw new Error(
            `ファイル "${fileName}" に『測定時間』ヘッダーが見つかりません。\n検出ヘッダー: ${headers.join(', ')}`
          );
        }

        for (let i = 1; i < lines.length; i++) {
          const cols = parseCSVLine(lines[i]);
          if (cols.length <= timeIdx) continue;

          const parsedTime = parseMeasurementTime(cols[timeIdx]);
          if (!parsedTime) continue;

          // 15分間の平均電力 (kW) を 4 で割って電力量 (kWh) に変換 (value * 0.25)
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
            yearStr: parsedTime.yearStr,
            monthStr: parsedTime.monthStr,
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

      // 4. 週をまたぐ際の重複行を排除（ユニーク化）
      const uniqueIntervalMap = new Map<
        string,
        SolarIntervalRecord & { yearStr: string; monthStr: string; day: number }
      >();

      for (const row of rawIntervalRows) {
        const existing = uniqueIntervalMap.get(row.timestamp);
        if (!existing) {
          uniqueIntervalMap.set(row.timestamp, {
            timestamp: row.timestamp,
            yearMonth: row.yearMonth,
            date: row.date,
            generation: row.generation,
            toBuilding: row.toBuilding,
            toGrid: row.toGrid,
            consumption: row.consumption,
            solarFrom: row.solarFrom,
            gridFrom: row.gridFrom,
            sunlight: row.sunlight,
            yearStr: row.yearStr,
            monthStr: row.monthStr,
            day: row.day,
          });
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

      const mergedWithMeta = Array.from(uniqueIntervalMap.values());

      // 5. インポートされたデータが属する主要年月（targetYear, targetMonth）を判定
      // （週次CSVで前月末・翌月初が数日分含まれていても、最もデータ行数が多い年月を対象月とする）
      const ymCountMap = new Map<string, { count: number; yearStr: string; monthStr: string }>();
      for (const item of mergedWithMeta) {
        const prev = ymCountMap.get(item.yearMonth);
        ymCountMap.set(item.yearMonth, {
          count: (prev?.count || 0) + 1,
          yearStr: item.yearStr,
          monthStr: item.monthStr,
        });
      }

      let targetYear = mergedWithMeta[0].yearStr;
      let targetMonth = mergedWithMeta[0].monthStr;
      let maxCount = 0;
      for (const [, info] of ymCountMap.entries()) {
        if (info.count > maxCount) {
          maxCount = info.count;
          targetYear = info.yearStr;
          targetMonth = info.monthStr;
        }
      }

      if (!targetYear || !targetMonth) {
        alert('エラー：CSVから年月を正しく読み取れませんでした。データ形式をご確認ください。');
        return;
      }

      const targetYearMonth = `${targetYear}年${targetMonth}月`;

      // 対象月（targetYear, targetMonth）に属する15分値データのみに絞り込み（他月の端数日の混入を防止）
      const targetMonthIntervalsWithMeta = mergedWithMeta.filter(
        (r) => r.yearStr === targetYear && r.monthStr === targetMonth
      );

      // 日次データへの集計（対象月のみを厳格に集計）
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
        }
      >();

      for (const rec of targetMonthIntervalsWithMeta) {
        const key = `${rec.yearMonth}_${rec.date}`;
        const prev = dailyAggMap.get(key) || {
          yearMonth: rec.yearMonth,
          date: rec.date,
          day: rec.day,
          generation: 0,
          consumption: 0,
          solarFrom: 0,
          gridFrom: 0,
        };
        prev.generation += rec.generation;
        prev.consumption += rec.consumption;
        prev.solarFrom += rec.solarFrom;
        prev.gridFrom += rec.gridFrom;
        dailyAggMap.set(key, prev);
      }

      const parsedDailyData: DailyDataItem[] = Array.from(dailyAggMap.values())
        .sort((a, b) => a.day - b.day)
        .map((d) => ({
          yearMonth: d.yearMonth,
          date: d.date,
          generation: Math.round(d.generation),
          consumption: Math.round(d.consumption),
          solarFrom: Math.round(d.solarFrom),
          gridFrom: Math.round(d.gridFrom),
          sunlight: 0,
        }));

      // 6. 気象庁API連携（牛深観測所の日照時間データを取得して統合）
      try {
        console.log(
          `☀️ 気象庁APIから日照時間を取得中... (/api/weather?year=${targetYear}&month=${targetMonth})`
        );
        const weatherRes = await fetch(
          `/api/weather?year=${targetYear}&month=${targetMonth}`
        );
        if (weatherRes.ok) {
          const sunshineData: Record<string, number> = await weatherRes.json();
          console.log('☀️ 取得した日照時間データ:', sunshineData);

          // 日次集計データの該当日に日照時間をマッピング
          parsedDailyData.forEach((d) => {
            const { day } = extractMonthAndDay(d.date);
            if (day !== null && sunshineData[day] !== undefined) {
              d.sunlight = sunshineData[day];
            }
          });

          // 結合済み15分値データの該当日に日照時間をマッピング
          targetMonthIntervalsWithMeta.forEach((r) => {
            if (sunshineData[r.day] !== undefined) {
              r.sunlight = sunshineData[r.day];
            }
          });
        } else {
          console.warn(
            `⚠️ 気象庁データの取得に失敗しました (HTTP ${weatherRes.status})`
          );
        }
      } catch (weatherErr) {
        console.warn('⚠️ 気象庁データの取得に失敗しました:', weatherErr);
      }

      const mergedIntervalData: SolarIntervalRecord[] = targetMonthIntervalsWithMeta.map(
        ({ yearStr: _y, monthStr: _m, day: _d, ...record }) => record
      );

      const totalGenKwh = Math.round(
        mergedIntervalData.reduce((sum, r) => sum + r.generation, 0)
      );
      const totalConsKwh = mergedIntervalData.reduce((sum, r) => sum + r.consumption, 0);
      const totalSolarKwh = mergedIntervalData.reduce((sum, r) => sum + r.solarFrom, 0);
      const selfSufficiency =
        totalConsKwh > 0 ? parseFloat(((totalSolarKwh / totalConsKwh) * 100).toFixed(1)) : 0;

      console.log('✅ 15分値CSV パース・ソート・重複排除・日照時間統合完了:', {
        対象年月: targetYearMonth,
        読み込みファイル数: files.length,
        全ファイル結合行数: rawIntervalRows.length,
        対象月ユニーク15分値件数: mergedIntervalData.length,
        対象月日次データ日数: parsedDailyData.length,
        月間総発電量_kWh: totalGenKwh,
        電力自給率_pct: selfSufficiency,
      });
      console.log('📊 結合済み15分値データ (kWh, 日照時間統合済):', mergedIntervalData);
      console.log('📅 日次集計データ (kWh, 日照時間統合済):', parsedDailyData);

      // 7. バックエンド (/api/solar) へ POST 送信
      const payload = {
        month: targetYearMonth,
        actual: totalGenKwh,
        selfSufficiency,
        dailyData: parsedDailyData,
        intervalData: mergedIntervalData,
      };

      const res = await fetch('/api/solar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error('データ保存失敗');
      }

      const postResult = await res.json();
      console.log('🚀 /api/solar POST 送信結果:', postResult);

      // 画面側のステートを更新（他月のデータを汚さず、対象月のデータのみを正確に反映）
      setAllDailyData((prev) => {
        const filteredPrev = prev.filter(
          (item) => !isStrictMatchingYearMonth(item, targetYear, targetMonth)
        );
        return [...filteredPrev, ...parsedDailyData];
      });

      setMonthlyData((prev) => {
        const exists = prev.some((m) => m.month === targetYearMonth);
        if (exists) {
          return prev.map((m) =>
            m.month === targetYearMonth
              ? { ...m, actual: totalGenKwh, selfSufficiency }
              : m
          );
        }
        return [...prev, { month: targetYearMonth, actual: totalGenKwh, selfSufficiency }];
      });

      setSelectedYear(targetYear);
      setSelectedMonth(targetMonth);

      alert(
        `🎉 インポート成功！\n\n気象庁のデータベースから牛深周辺の実測日照時間を自動取得し、${targetYearMonth}のデータ（${parsedDailyData.length}日分 / 15分値 ${mergedIntervalData.length}件）に統合しました。`
      );
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

  // 選択された年（selectedYear）に属するデータのみを厳格にフィルター
  const dailyDataThisYear = allDailyData.filter((d) =>
    isStrictMatchingYear(d, selectedYear)
  );

  // 【修正1】現在プルダウンで選択されている年・月（selectedYear, selectedMonth）に一致するデータのみを厳格にフィルター＆日付順ソート
  const dailyData = allDailyData
    .filter((d) => isStrictMatchingYearMonth(d, selectedYear, selectedMonth))
    .sort((a, b) => {
      const dayA = extractMonthAndDay(a.date).day ?? 0;
      const dayB = extractMonthAndDay(b.date).day ?? 0;
      return dayA - dayB;
    });

  const maxDailyConsumption = Math.max(0, ...dailyDataThisYear.map((d) => d.consumption));
  const maxDailyGeneration = Math.max(0, ...dailyDataThisYear.map((d) => d.generation));
  const maxDailySunlight = Math.max(0, ...dailyDataThisYear.map((d) => d.sunlight));

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
      allDailyData.filter((d) => isStrictMatchingYearMonth(d, selectedYear, m))
    );
    const lData = aggregate(
      allDailyData.filter((d) => isStrictMatchingYearMonth(d, lastYearStr, m))
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
    const monthDailies = allDailyData.filter((d) =>
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
  const rawDailyLastYear = allDailyData.filter((d) =>
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

  const displayActual =
    currentTarget && currentTarget.actual !== null
      ? (currentTarget.actual / 1000).toFixed(2)
      : '0.00';
  const displaySufficiency = currentTarget ? currentTarget.selfSufficiency.toFixed(1) : '0.0';
  const currentSimValue = SIMULATION_DATA[parseInt(selectedMonth, 10)];
  const displayRatio =
    currentTarget && currentTarget.actual !== null && currentSimValue > 0
      ? ((currentTarget.actual / currentSimValue - 1) * 100).toFixed(1)
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
