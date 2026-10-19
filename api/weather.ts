export default async function handler(req: any, res: any) {
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const urlObj = new URL(req.url || '', 'http://localhost');
  const year = req.query?.year || urlObj.searchParams.get('year');
  const month = req.query?.month || urlObj.searchParams.get('month');

  if (!year || !month) {
    return res.status(400).json({ error: 'Year and month are required' });
  }

  try {
    // 牛深特別地域気象観測所（天草地方）の過去データURL（prec_no=86, block_no=47838）
    const jmaUrl = `https://www.data.jma.go.jp/obd/stats/etrn/view/daily_s1.php?prec_no=86&block_no=47838&year=${encodeURIComponent(
      String(year)
    )}&month=${encodeURIComponent(String(month))}&day=&view=`;
    console.log(`[Weather API] 気象庁へアクセス中... URL: ${jmaUrl}`);

    const response = await fetch(jmaUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      },
    });

    if (!response.ok) {
      console.error(
        `[Weather API] ❌ 気象庁へのアクセスに失敗しました。ステータス: ${response.status}`
      );
      return res.status(response.status).json({ error: 'Failed to fetch from JMA' });
    }

    const html = await response.text();
    const sunshineData: Record<number, number> = {};
    let rowCount = 0;

    // table.data2_s 内の tr / td を抽出して日照時間（インデックス16）を取得
    const tableMatch = html.match(
      /<table[^>]*class=["'][^"']*data2_s[^"']*["'][^>]*>([\s\S]*?)<\/table>/i
    );
    const tableHtml = tableMatch ? tableMatch[1] : html;
    const trMatches = tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);

    for (const trMatch of trMatches) {
      const trContent = trMatch[1];
      const tdMatches = Array.from(trContent.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi));
      if (tdMatches.length >= 17) {
        const stripTags = (s: string) =>
          s
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .trim();
        const dayStr = stripTags(tdMatches[0][1]);
        const sunshineStr = stripTags(tdMatches[16][1]);

        const day = parseInt(dayStr, 10);
        const sunshine = parseFloat(sunshineStr);

        if (!isNaN(day)) {
          rowCount++;
          sunshineData[day] = !isNaN(sunshine) ? sunshine : 0;
        }
      }
    }

    console.log(`[Weather API] ✅ 抽出完了: ${rowCount}日分の日照時間を取得しました。`);
    return res.status(200).json(sunshineData);
  } catch (error) {
    console.error('[Weather API] ❌ システムエラー:', error);
    return res.status(500).json({ error: 'System error' });
  }
}

