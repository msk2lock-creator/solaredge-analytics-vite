import { google } from 'googleapis';

function getGoogleSheetsClient() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = process.env.SPREADSHEET_ID;

  if (!clientEmail || !privateKey || !spreadsheetId) {
    throw new Error(
      'Google Sheets環境変数 (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, SPREADSHEET_ID) が設定されていません。'
    );
  }

  // エスケープされた \n を実際の改行コードに復元
  if (privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  return { sheets, spreadsheetId };
}

export default async function handler(req: any, res: any) {
  try {
    const { sheets, spreadsheetId } = getGoogleSheetsClient();

    // ----------------------------------------------------
    // GET: スプレッドシートから既存の月次・日次データを取得
    // ----------------------------------------------------
    if (req.method === 'GET') {
      try {
        const [monthlyRes, dailyRes] = await Promise.all([
          sheets.spreadsheets.values
            .get({
              spreadsheetId,
              range: 'monthly_data!A2:D100',
            })
            .catch(() => ({ data: { values: [] } })),
          sheets.spreadsheets.values
            .get({
              spreadsheetId,
              range: 'daily_data!A2:G3000',
            })
            .catch(() => ({ data: { values: [] } })),
        ]);

        const monthlyRows = monthlyRes.data?.values || [];
        const formattedMonthly = monthlyRows.map((row: any) => ({
          month: row[0] || '',
          sim: row[1] ? Number(row[1]) : 0,
          actual: row[2] && row[2] !== '' ? Number(row[2]) : null,
          selfSufficiency: row[3] ? Number(row[3]) : 0,
        }));

        const dailyRows = dailyRes.data?.values || [];
        const formattedDaily = dailyRows.map((row: any) => ({
          yearMonth: row[0] || '',
          date: row[1] || '',
          generation: Number(row[2]) || 0,
          consumption: Number(row[3]) || 0,
          solarFrom: Number(row[4]) || 0,
          gridFrom: Number(row[5]) || 0,
          sunlight: Number(row[6]) || 0,
        }));

        return res.status(200).json({
          status: 'success',
          monthlyData: formattedMonthly,
          dailyData: formattedDaily,
        });
      } catch (getErr) {
        console.warn('⚠️ スプレッドシートからの初期データ取得に失敗しました (空データ返却):', getErr);
        return res.status(200).json({
          status: 'success',
          monthlyData: [],
          dailyData: [],
        });
      }
    }

    // ----------------------------------------------------
    // POST: 受信した15分値データ・日次集計データをスプレッドシートに追記・保存
    // ----------------------------------------------------
    if (req.method === 'POST') {
      const body = req.body || {};

      // 1. 15分値データの抽出 (intervalData / records / 配列直接)
      const rawIntervals: any[] = Array.isArray(body)
        ? body
        : body.intervalData || body.records || [];

      // 2. 日次集計データ・月次データの抽出
      const rawDailies: any[] = Array.isArray(body.dailyData) ? body.dailyData : [];
      const { month, actual, selfSufficiency } = body;

      if (rawIntervals.length === 0 && rawDailies.length === 0 && !month) {
        return res.status(400).json({
          status: 'error',
          message: '保存対象のデータ (intervalData, dailyData, または month) が含まれていません。',
        });
      }

      // シート一覧を取得
      const metaRes = await sheets.spreadsheets.get({ spreadsheetId });
      const sheetTitles = (metaRes.data.sheets || []).map((s) => s.properties?.title || '');

      let appendedIntervalCount = 0;

      // ----------------------------------------------------
      // A. 15分値データ (intervalData) の末尾追記 (append)
      // ----------------------------------------------------
      if (rawIntervals.length > 0) {
        const targetIntervalSheet =
          body.sheetName ||
          (sheetTitles.includes('interval_data') ? 'interval_data' : sheetTitles[0] || 'Sheet1');

        // interval_data シートが存在しない場合は自動作成
        if (!sheetTitles.includes(targetIntervalSheet)) {
          console.log(`📄 新規シート "${targetIntervalSheet}" を作成します...`);
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [{ addSheet: { properties: { title: targetIntervalSheet } } }],
            },
          });
          // ヘッダー行を追加
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${targetIntervalSheet}!A1:J1`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [
                [
                  '測定時間',
                  '年月',
                  '日付',
                  '発電 (kWh)',
                  '建物へ (kWh)',
                  '系統へ (kWh)',
                  '消費 (kWh)',
                  '太陽光から (kWh)',
                  '系統から (kWh)',
                  '日照時間 (時間)',
                ],
              ],
            },
          });
        }

        // 15分値の2次元配列に整形
        const intervalRows = rawIntervals.map((item: any) => {
          if (Array.isArray(item)) return item;
          return [
            item.timestamp || item['測定時間'] || '',
            item.yearMonth || item['年月'] || '',
            item.date || item['日付'] || '',
            item.generation ?? item['発電 (kWh)'] ?? item['発電'] ?? 0,
            item.toBuilding ?? item['建物へ (kWh)'] ?? item['建物へ'] ?? 0,
            item.toGrid ?? item['系統へ (kWh)'] ?? item['系統へ'] ?? 0,
            item.consumption ?? item['消費 (kWh)'] ?? item['消費'] ?? 0,
            item.solarFrom ?? item['太陽光から (kWh)'] ?? item['太陽光から'] ?? 0,
            item.gridFrom ?? item['系統から (kWh)'] ?? item['系統から'] ?? 0,
            item.sunlight ?? item['日照時間'] ?? 0,
          ];
        });

        console.log(
          `📝 [Google Sheets] "${targetIntervalSheet}" の末尾に 15分値 ${intervalRows.length} 件を追記中...`
        );

        const appendRes = await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `${targetIntervalSheet}!A1`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: {
            values: intervalRows,
          },
        });

        appendedIntervalCount = appendRes.data.updates?.updatedRows || intervalRows.length;
        console.log(`✅ [Google Sheets] 15分値の追記が完了しました (${appendedIntervalCount} 行)`);
      }

      // ----------------------------------------------------
      // B. 日次集計データ (dailyData) の保存・更新
      // ----------------------------------------------------
      if (rawDailies.length > 0 && sheetTitles.includes('daily_data')) {
        console.log(`📝 [Google Sheets] "daily_data" シートを更新中 (${rawDailies.length} 日分)...`);
        const existingDailyRes = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: 'daily_data!A2:G',
        });
        const existingRows = existingDailyRes.data.values || [];
        const dailyMap = new Map<string, any[]>();

        // 既存データをMapに格納（年月_日付 をキーにして重複排除）
        existingRows.forEach((row: any) => {
          if (row.length > 1) {
            dailyMap.set(`${row[0]}_${row[1]}`, row);
          }
        });

        // 新規日次データで上書き
        rawDailies.forEach((d: any) => {
          dailyMap.set(`${d.yearMonth}_${d.date}`, [
            d.yearMonth,
            d.date,
            d.generation,
            d.consumption,
            d.solarFrom,
            d.gridFrom,
            d.sunlight || 0,
          ]);
        });

        // 年月・日付順にソート
        const mergedRows = Array.from(dailyMap.values()).sort((a, b) => {
          const ym1 = String(a[0]).match(/(\d{4})年(\d+)月/);
          const ym2 = String(b[0]).match(/(\d{4})年(\d+)月/);
          const d1Match = String(a[1]).match(/(\d+)日/);
          const d2Match = String(b[1]).match(/(\d+)日/);
          const t1 = ym1 ? parseInt(ym1[1], 10) * 10000 + parseInt(ym1[2], 10) * 100 + parseInt(d1Match?.[1] || '0', 10) : 0;
          const t2 = ym2 ? parseInt(ym2[1], 10) * 10000 + parseInt(ym2[2], 10) * 100 + parseInt(d2Match?.[1] || '0', 10) : 0;
          return t1 - t2;
        });

        await sheets.spreadsheets.values.clear({
          spreadsheetId,
          range: 'daily_data!A2:G',
        });
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'daily_data!A2',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: mergedRows },
        });
        console.log(`✅ [Google Sheets] "daily_data" の保存が完了しました (全 ${mergedRows.length} 行)`);
      }

      // ----------------------------------------------------
      // C. 月次サマリー (monthly_data) の更新
      // ----------------------------------------------------
      if (month && actual !== undefined && sheetTitles.includes('monthly_data')) {
        console.log(`📝 [Google Sheets] "monthly_data" の "${month}" 実績を更新中...`);
        const monthlyRes = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: 'monthly_data!A1:A100',
        });
        const rows = monthlyRes.data.values || [];
        let rowIndex = rows.findIndex((row) => row[0] === month) + 1;

        if (rowIndex <= 1) {
          rowIndex = rows.length + 1;
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `monthly_data!A${rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[month]] },
          });
        }

        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `monthly_data!C${rowIndex}:D${rowIndex}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[actual, selfSufficiency || 0]] },
        });
        console.log(`✅ [Google Sheets] "monthly_data" の行 ${rowIndex} を更新完了`);
      }

      return res.status(200).json({
        status: 'success',
        message: 'Googleスプレッドシートへのデータ保存・追記が完了しました。',
        appendedIntervalCount,
        dailyCount: rawDailies.length,
      });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({
      status: 'error',
      message: `Method ${req.method} Not Allowed`,
    });
  } catch (error: any) {
    // 要件4: 詳細なエラーログ（スタックトレースやGoogle APIのエラー詳細）を出力し、ステータス500でエラーを返却
    console.error('❌ Google Sheets API エラー詳細:', {
      message: error?.message,
      stack: error?.stack,
      responseErrors: error?.response?.data?.error?.errors,
      responseData: error?.response?.data,
    });

    return res.status(500).json({
      status: 'error',
      message: error?.message || 'Googleスプレッドシートの処理中にエラーが発生しました。',
      details: error?.response?.data || error?.stack || String(error),
    });
  }
}
