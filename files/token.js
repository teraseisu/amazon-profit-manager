// api/token.js
// Amazon LWA (Login with Amazon) アクセストークン取得
// Refresh Token → Access Token に交換する

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN } = process.env;

  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    return res.status(500).json({
      error: '環境変数が設定されていません。VercelのEnvironment Variablesを確認してください。'
    });
  }

  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: REFRESH_TOKEN,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });

    const response = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(400).json({ error: data.error_description || 'トークン取得失敗', detail: data });
    }

    return res.status(200).json({ access_token: data.access_token });

  } catch (err) {
    return res.status(500).json({ error: 'トークン取得エラー', detail: err.message });
  }
}
