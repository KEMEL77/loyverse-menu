const express = require('express');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL;
const REDIRECT_PATH = '/callback';
const REDIRECT_URI = BASE_URL + REDIRECT_PATH;

const AUTH_URL = 'https://api.loyverse.com/oauth/authorize';
const TOKEN_URL = 'https://api.loyverse.com/oauth/token';
const ITEMS_URL = 'https://api.loyverse.com/v1/items';

let ACCESS_TOKEN = null;
let REFRESH_TOKEN = null;
let EXPIRES_AT = 0;
let CACHED_MENU = [];

async function ensureAccessToken() {
  if (ACCESS_TOKEN && Date.now()/1000 + 60 < EXPIRES_AT) return ACCESS_TOKEN;
  if (!REFRESH_TOKEN) throw new Error('No refresh token. Autoriza la app.');
  const params = new URLSearchParams();
  params.append('grant_type', 'refresh_token');
  params.append('refresh_token', REFRESH_TOKEN);
  params.append('client_id', CLIENT_ID);
  params.append('client_secret', CLIENT_SECRET);
  const res = await fetch(TOKEN_URL, { method: 'POST', body: params });
  const body = await res.json();
  if (!res.ok) throw new Error('Refresh failed: ' + JSON.stringify(body));
  ACCESS_TOKEN = body.access_token;
  REFRESH_TOKEN = body.refresh_token || REFRESH_TOKEN;
  EXPIRES_AT = Date.now()/1000 + Number(body.expires_in || 3600);
  return ACCESS_TOKEN;
}

app.get('/auth', (req, res) => {
  const url = ${AUTH_URL}?response_type=code&client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)};
  res.redirect(url);
});

app.get(REDIRECT_PATH, async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send('No code');
    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('client_id', CLIENT_ID);
    params.append('client_secret', CLIENT_SECRET);
    params.append('redirect_uri', REDIRECT_URI);
    const tokenResp = await fetch(TOKEN_URL, { method: 'POST', body: params });
    const tokenBody = await tokenResp.json();
    if (!tokenResp.ok) return res.status(500).send('Token error: ' + JSON.stringify(tokenBody));
    ACCESS_TOKEN = tokenBody.access_token;
    REFRESH_TOKEN = tokenBody.refresh_token;
    EXPIRES_AT = Date.now()/1000 + Number(tokenBody.expires_in || 3600);
    await syncProducts();
    return res.send('Autorización exitosa. Cierra esta ventana.');
  } catch (err) {
    console.error(err);
    return res.status(500).send('Error en callback: ' + err.message);
  }
});

app.get('/menu', async (req, res) => {
  try {
    return res.json(CACHED_MENU);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

async function syncProducts() {
  try {
    const token = await ensureAccessToken();
    const resp = await fetch(ITEMS_URL, { method: 'GET', headers: { Authorization: 'Bearer ' + token } });
    const data = await resp.json();
    if (!resp.ok) throw new Error('Items error: ' + JSON.stringify(data));
    const items = data.items || [];
    const results = [];
    items.forEach(it => {
      const stock = (it.stock_total !== undefined) ? Number(it.stock_total) : null;
      if (stock === null || stock > 0) {
        let image = '';
        if (it.images && it.images.length) image = (typeof it.images[0] === 'string') ? it.images[0] : it.images[0].url;
        if (!image && it.image_url) image = it.image_url;
        const price = (it.price !== undefined) ? it.price : (it.price_without_tax !== undefined ? it.price_without_tax : null);
        results.push({ id: it.id || it.item_id, name: it.name, price: price, image: image });
      }
    });
    CACHED_MENU = results;
    console.log('Sync OK, items:', CACHED_MENU.length);
  } catch (err) {
    console.error('Sync failed:', err.message);
  }
}

setInterval(() => { syncProducts(); }, 5 * 60 * 1000);

app.get('/health', (req, res) => res.send('ok'));

app.listen(PORT, () => { console.log('Server listening on', PORT); });

