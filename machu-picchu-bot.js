const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const https = require('https');
const CryptoJS = require('crypto-js');

// ==========================================
// SETTINGS
// ==========================================

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8313303866:AAHnYBhxejha6oPiZlpK_oeJdeoZGny1220';
const ALLOWED_USERS = process.env.ALLOWED_USERS
  ? process.env.ALLOWED_USERS.split(',').map(id => parseInt(id.trim()))
  : [7575536082]; // Add user IDs separated by comma

// ==========================================
// API CONSTANTS
// ==========================================

const API_BASE = 'https://api-tuboleto.cultura.pe';
const HMAC_KEY = '5t4jPtv4LpmGgWU7ZYk8FhZf5LNTpk';
const AES_PASSWORD = 'Km4pDqgVZdLNXYdde5jypBysh9MzkL';
const AES_SALT = 'In5iAIxnHwMTLg9ldHFUb3';
const NID_LUGAR = 1;

// ==========================================
// ROUTES
// ==========================================

const ROUTES = {
  'C1': [
    { label: 'Ruta 1-A\n$75 USD\nMountain MP', nidcircuito: 1, nidruta: 7 },
    { label: 'Ruta 1-B\n$55 USD', nidcircuito: 1, nidruta: 8 },
    { label: 'Ruta 1-C\n$55 USD', nidcircuito: 1, nidruta: 9 },
    { label: 'Ruta 1-D\n$50 USD', nidcircuito: 1, nidruta: 10 }
  ],
  'C2': [
    { label: 'Ruta 2-A\n$55 USD', nidcircuito: 2, nidruta: 11 },
    { label: 'Ruta 2-B\n$55 USD', nidcircuito: 2, nidruta: 12 }
  ],
  'C3': [
    { label: 'Ruta 3-A\n$75 USD\nWayna Picchu', nidcircuito: 3, nidruta: 13 },
    { label: 'Ruta 3-B\n$55 USD', nidcircuito: 3, nidruta: 14 },
    { label: 'Ruta 3-C\n$75 USD', nidcircuito: 3, nidruta: 15 },
    { label: 'Ruta 3-D\n$55 USD\nHuchu Picchu', nidcircuito: 3, nidruta: 16 }
  ]
};

// ==========================================
// BOT INITIALIZATION
// ==========================================

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

console.log('✅ Machu Picchu Ticket Checker Bot Started!');

// ==========================================
// ACCESS CHECK
// ==========================================

function isAllowed(chatId) {
  return ALLOWED_USERS.indexOf(chatId) !== -1;
}

// ==========================================
// COMMAND HANDLERS
// ==========================================

bot.onText(/\/start|\/help/, (msg) => {
  const chatId = msg.chat.id;

  if (!isAllowed(chatId)) {
    bot.sendMessage(chatId, '⛔ Access denied to this bot.');
    return;
  }

  const helpText =
    '🏔 Machu Picchu Ticket Checker\n\n' +
    'Commands:\n' +
    '/check DD.MM.YYYY C1 — Check Circuit 1\n' +
    '/check DD.MM.YYYY C2 — Check Circuit 2\n' +
    '/check DD.MM.YYYY C3 — Check Circuit 3\n' +
    '/check DD.MM.YYYY all — Check all circuits\n\n' +
    'Example: /check 15.06.2026 C1';

  bot.sendMessage(chatId, helpText);
});

bot.onText(/\/check/, (msg) => {
  const chatId = msg.chat.id;

  if (!isAllowed(chatId)) {
    bot.sendMessage(chatId, '⛔ Access denied to this bot.');
    return;
  }

  handleCheck(chatId, msg.text);
});

// ==========================================
// HANDLE /check COMMAND
// ==========================================

async function handleCheck(chatId, text) {
  const parts = text.split(/\s+/);
  if (parts.length < 3) {
    bot.sendMessage(chatId, '❌ Format: /check DD.MM.YYYY C1\nExample: /check 15.06.2026 C1');
    return;
  }

  const dateStr = parts[1];
  const circuit = parts[2].toUpperCase();

  const dateMatch = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!dateMatch) {
    bot.sendMessage(chatId, '❌ Invalid date format. Use DD.MM.YYYY\nExample: 15.06.2026');
    return;
  }

  const day = dateMatch[1];
  const month = dateMatch[2];
  const year = dateMatch[3];
  const apiDate = year + '-' + month + '-' + day;
  const displayDate = day + '.' + month + '.' + year;

  // Send confirmation
  bot.sendMessage(chatId, '⏳ Received request. Starting ticket check...');

  let routesToCheck = [];
  let selectedCircuit = null;

  if (circuit === 'ALL') {
    routesToCheck = ROUTES['C1'].concat(ROUTES['C2']).concat(ROUTES['C3']);
  } else if (ROUTES[circuit]) {
    routesToCheck = ROUTES[circuit];
    selectedCircuit = circuit;
  } else {
    bot.sendMessage(chatId, '❌ Invalid circuit. Use C1, C2, C3, or all');
    return;
  }

  bot.sendMessage(chatId, '⏳ Checking tickets for ' + displayDate + '...');

  const resultLines = ['📅 ' + displayDate + '\n'];
  let totalFound = 0;

  for (const route of routesToCheck) {
    try {
      const slots = await getAvailableSlots(apiDate, route.nidcircuito, route.nidruta);

      if (slots === null || slots.length === 0) {
        continue;
      }

      // Determine which circuit this route belongs to
      let routeCircuit = null;
      if (ROUTES['C1'].includes(route)) routeCircuit = 'C1';
      else if (ROUTES['C2'].includes(route)) routeCircuit = 'C2';
      else if (ROUTES['C3'].includes(route)) routeCircuit = 'C3';

      // Add warning emoji for C2 circuits
      const prefix = routeCircuit === 'C2' ? '⚠️ ' : '🟢 ';
      resultLines.push(prefix + route.label + ':');
      for (const slot of slots) {
        const time = slot.dhora_ini.substring(0, 5);
        resultLines.push('   ' + time + ' — ' + slot.ncupo_actual + ' seats');
      }
      resultLines.push('');
      totalFound += slots.length;
    } catch (err) {
      console.error('Error checking route ' + route.nidruta + ':', err.message);
    }
  }

  if (totalFound === 0) {
    bot.sendMessage(chatId, '❌ No available tickets for ' + displayDate);
  } else {
    bot.sendMessage(chatId, resultLines.join('\n'));
  }
}

// ==========================================
// GET AVAILABLE SLOTS FOR ROUTE
// ==========================================

async function getAvailableSlots(apiDate, nidcircuito, nidruta) {
  try {
    // Get server time
    const timeData = await fetchJson(API_BASE + '/comunes/tiempo-servidor');
    const timestamp = timeData.tiempoServidor;

    // Calculate HMAC
    const code = computeHmac(HMAC_KEY, timestamp);
    console.log('Request for route ' + nidruta + ': timestamp=' + timestamp + ', code=' + code);

    // Prepare request body
    const body = JSON.stringify({
      nidruta: nidruta,
      nidcircuito: nidcircuito,
      nidlugar: NID_LUGAR,
      df_inicio: apiDate,
      valorPunto: 0,
      token: '',
      code: code,
      timestamp: timestamp
    });

    // Send request
    const respJson = await fetchJson(API_BASE + '/visita/consulta-horarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body
    });

    if (!respJson.estado) {
      console.log('API returned error for route ' + nidruta);
      console.log('Full API response:', JSON.stringify(respJson));
      return null;
    }

    // Decrypt data
    const encryptedData = respJson.data;
    const decrypted = aesDecrypt(encryptedData);

    if (!decrypted) {
      console.log('Decryption failed for route ' + nidruta);
      return null;
    }

    const slots = JSON.parse(decrypted);
    const available = slots.filter(s => s.ncupo_actual > 0);
    return available;

  } catch (err) {
    console.error('getAvailableSlots error:', err.message);
    return null;
  }
}

// ==========================================
// HTTP REQUESTS
// ==========================================

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = url.startsWith('https');
    const lib = isHttps ? require('https') : require('http');

    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'es-PE,es;q=0.9',
      'Origin': 'https://tuboleto.cultura.pe',
      'Referer': 'https://tuboleto.cultura.pe/',
      'Connection': 'keep-alive'
    };

    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: { ...defaultHeaders, ...options.headers }
    };

    const req = lib.request(reqOptions, (res) => {
      let data = '';
      console.log('HTTP ' + res.statusCode + ': ' + reqOptions.method + ' ' + reqOptions.path);
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

// ==========================================
// HMAC-SHA256
// ==========================================

function computeHmac(key, timestamp) {
  const message = key + ':' + String(timestamp);
  const hmac = crypto.createHmac('sha256', key);
  hmac.update(message);
  return hmac.digest('base64');
}

// ==========================================
// AES DECRYPTION
// ==========================================

function aesDecrypt(encryptedBase64) {
  try {
    const encryptedBytes = CryptoJS.enc.Base64.parse(encryptedBase64);

    // Extract IV (first 16 bytes)
    const iv = CryptoJS.lib.WordArray.create(encryptedBytes.words.slice(0, 4), 16);

    // Extract ciphertext (remaining bytes)
    const ciphertext = CryptoJS.lib.WordArray.create(
      encryptedBytes.words.slice(4),
      encryptedBytes.sigBytes - 16
    );

    // Generate key
    const key = CryptoJS.PBKDF2(AES_PASSWORD, CryptoJS.enc.Utf8.parse(AES_SALT), {
      keySize: 8,
      iterations: 65536
    });

    // Decrypt
    const decrypted = CryptoJS.AES.decrypt(
      { ciphertext: ciphertext },
      key,
      {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
      }
    );

    return decrypted.toString(CryptoJS.enc.Utf8);
  } catch (err) {
    console.error('aesDecrypt error:', err.message);
    return null;
  }
}

// ==========================================
// ERROR HANDLING
// ==========================================

bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

bot.on('error', (error) => {
  console.error('Bot error:', error.message);
});

console.log('Allowed users:', ALLOWED_USERS);
