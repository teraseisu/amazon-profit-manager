// api/orders.js
// Amazon SP-API から注文一覧を取得する

export default async function handler(req, res) {
  // CORS設定（同一Vercelドメインからのアクセスを許可）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { SELLER_ID, CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN } = process.env;
  const MARKETPLACE_ID = process.env.MARKETPLACE_ID || 'A1VC38T7YXB528'; // 日本

  if (!SELLER_ID || !CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    return res.status(500).json({
      error: '環境変数が不足しています',
      missing: {
        SELLER_ID: !SELLER_ID,
        CLIENT_ID: !CLIENT_ID,
        CLIENT_SECRET: !CLIENT_SECRET,
        REFRESH_TOKEN: !REFRESH_TOKEN,
      }
    });
  }

  try {
    // Step 1: アクセストークン取得
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
      return res.status(400).json({
        error: 'トークン取得失敗',
        detail: tokenData.error_description || tokenData
      });
    }

    const accessToken = tokenData.access_token;

    // Step 2: 注文一覧取得（過去30日）
    const createdAfter = req.query.createdAfter ||
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const endpoint = 'https://sellingpartnerapi-fe.amazon.com'; // 日本(FE)エンドポイント

    const ordersUrl = new URL(`${endpoint}/orders/v0/orders`);
    ordersUrl.searchParams.set('MarketplaceIds', MARKETPLACE_ID);
    ordersUrl.searchParams.set('CreatedAfter', createdAfter);
    ordersUrl.searchParams.set('OrderStatuses', 'Unshipped,PartiallyShipped,Shipped,Canceled');
    ordersUrl.searchParams.set('MaxResultsPerPage', '100');

    const ordersRes = await fetch(ordersUrl.toString(), {
      headers: {
        'x-amz-access-token': accessToken,
        'x-amz-date': new Date().toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z',
        'Content-Type': 'application/json',
      },
    });

    const ordersData = await ordersRes.json();

    if (!ordersRes.ok) {
      return res.status(ordersRes.status).json({
        error: '注文取得失敗',
        detail: ordersData
      });
    }

    const orders = ordersData.payload?.Orders || [];

    // Step 3: 各注文のOrderItemsを取得してSKUを得る
    const enriched = await Promise.all(
      orders.map(async (order) => {
        try {
          const itemsRes = await fetch(
            `${endpoint}/orders/v0/orders/${order.AmazonOrderId}/orderItems`,
            {
              headers: {
                'x-amz-access-token': accessToken,
                'Content-Type': 'application/json',
              },
            }
          );
          const itemsData = await itemsRes.json();
          const items = itemsData.payload?.OrderItems || [];

          return {
            id: order.AmazonOrderId,
            date: order.PurchaseDate?.slice(0, 10) || '',
            status: order.OrderStatus,
            buyerName: order.BuyerInfo?.BuyerName || '',
            items: items.map(item => ({
              asin: item.ASIN,
              sku: item.SellerSKU || '',
              title: item.Title || '',
              qty: item.QuantityOrdered || 1,
              price: parseFloat(item.ItemPrice?.Amount || 0),
              currency: item.ItemPrice?.CurrencyCode || 'JPY',
            })),
          };
        } catch {
          return {
            id: order.AmazonOrderId,
            date: order.PurchaseDate?.slice(0, 10) || '',
            status: order.OrderStatus,
            items: [],
          };
        }
      })
    );

    return res.status(200).json({ orders: enriched, total: enriched.length });

  } catch (err) {
    return res.status(500).json({ error: 'サーバーエラー', detail: err.message });
  }
}
