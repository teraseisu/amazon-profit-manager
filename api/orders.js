// api/orders.js - 複数アカウント対応
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // アカウント番号を取得（1〜5、デフォルトは1）
  const accountNum = req.query.account || '1';
  const suffix = accountNum === '1' ? '' : '_' + accountNum;

  const SELLER_ID     = process.env['SELLER_ID' + suffix];
  const CLIENT_ID     = process.env['CLIENT_ID' + suffix];
  const CLIENT_SECRET = process.env['CLIENT_SECRET' + suffix];
  const REFRESH_TOKEN = process.env['REFRESH_TOKEN' + suffix];
  const MARKETPLACE_ID = process.env['MARKETPLACE_ID' + suffix] || 'A1VC38T7YXB528';

  if (!SELLER_ID || !CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    return res.status(500).json({
      error: `アカウント${accountNum}の環境変数が設定されていません`,
      missing: {
        ['SELLER_ID'+suffix]: !SELLER_ID,
        ['CLIENT_ID'+suffix]: !CLIENT_ID,
        ['CLIENT_SECRET'+suffix]: !CLIENT_SECRET,
        ['REFRESH_TOKEN'+suffix]: !REFRESH_TOKEN,
      }
    });
  }

  try {
    // Step1: アクセストークン取得
    const tokenParams = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: REFRESH_TOKEN,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });
    const tokenRes = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      return res.status(400).json({ error: 'トークン取得失敗', detail: tokenData.error_description || tokenData });
    }
    const accessToken = tokenData.access_token;

    // Step2: 注文一覧取得（過去60日）
    const createdAfter = req.query.createdAfter ||
      new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

    const endpoint = 'https://sellingpartnerapi-fe.amazon.com';
    const ordersUrl = new URL(`${endpoint}/orders/v0/orders`);
    ordersUrl.searchParams.set('MarketplaceIds', MARKETPLACE_ID);
    ordersUrl.searchParams.set('CreatedAfter', createdAfter);
    ordersUrl.searchParams.set('OrderStatuses', 'Unshipped,PartiallyShipped,Shipped,Canceled');
    ordersUrl.searchParams.set('MaxResultsPerPage', '100');

    const ordersRes = await fetch(ordersUrl.toString(), {
      headers: { 'x-amz-access-token': accessToken, 'Content-Type': 'application/json' },
    });
    const ordersData = await ordersRes.json();
    if (!ordersRes.ok) {
      return res.status(ordersRes.status).json({ error: '注文取得失敗', detail: ordersData });
    }

    const orders = ordersData.payload?.Orders || [];

    // Step3: 各注文のOrderItemsを取得
    const enriched = await Promise.all(orders.map(async order => {
      try {
        const itemsRes = await fetch(
          `${endpoint}/orders/v0/orders/${order.AmazonOrderId}/orderItems`,
          { headers: { 'x-amz-access-token': accessToken } }
        );
        const itemsData = await itemsRes.json();
        const items = itemsData.payload?.OrderItems || [];
        return {
          id: order.AmazonOrderId,
          date: order.PurchaseDate?.slice(0, 10) || '',
          status: order.OrderStatus,
          items: items.map(item => ({
            asin: item.ASIN,
            sku: item.SellerSKU || '',
            title: item.Title || '',
            qty: item.QuantityOrdered || 1,
            price: parseFloat(item.ItemPrice?.Amount || 0),
          })),
        };
      } catch {
        return { id: order.AmazonOrderId, date: order.PurchaseDate?.slice(0,10)||'', status: order.OrderStatus, items: [] };
      }
    }));

    return res.status(200).json({ orders: enriched, total: enriched.length, account: accountNum });

  } catch (err) {
    return res.status(500).json({ error: 'サーバーエラー', detail: err.message });
  }
}
