const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const https = require('https');
const CryptoJS = require('crypto-js');

// ==========================================
// НАСТРОЙКИ — ЗАМЕНИ НА СВОИ
// ==========================================

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8313303866:AAHnYBhxejha6oPiZlpK_oeJdeoZGny1220';
const ALLOWED_USERS = process.env.ALLOWED_USERS
  ? process.env.ALLOWED_USERS.split(',').map(id => parseInt(id.trim()))
  : [7575536082]; // добавь нужные ID через запятую

// ==========================================
// КОНСТАНТЫ API
// ==========================================

const API_BASE = 'https://api-tuboleto.cultura.pe';
const HMAC_KEY = '5t4jPtv4LpmGgWU7ZYk8FhZf5LNTpk';
const AES_PASSWORD = 'Km4pDqgVZdLNXYdde5jypBysh9MzkL';
const AES_SALT = 'In5iAIxnHwMTLg9ldHFUb3';
const NID_LUGAR = 1;

// ==========================================
// МАРШРУТЫ
// ==========================================

const ROUTES = {
  'C1': [
    { label: 'C1, Ruta 1-A', nidcircuito: 1, nidruta: 7 },
    { label: 'C1, Ruta 1-B', nidcircuito: 1, nidruta: 8 },
    { label: 'C1, Ruta 1-C', nidcircuito: 1, nidruta: 9 },
    { label: 'C1, Ruta 1-D', nidcircuito: 1, nidruta: 10 }
  ],
  'C2': [
    { label: 'C2, Ruta 2-A', nidcircuito: 2, nidruta: 11 },
    { label: 'C2, Ruta 2-B', nidcircuito: 2, nidruta: 12 }
  ],
  'C3': [
    { label: 'C3, Ruta 3-A', nidcircuito: 3, nidruta: 13 },
    { label: 'C3, Ruta 3-B', nidcircuito: 3, nidruta: 14 },
    { label: 'C3, Ruta 3-C', nidcircuito: 3, nidruta: 15 },
    { label: 'C3, Ruta 3-D', nidcircuito: 3, nidruta: 16 }
  ]
};

// ==========================================
// ИНИЦИАЛИЗАЦИЯ БОТА
// ==========================================

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

console.log('✅ Бот проверки билетов Мачу-Пикчу запущен!');

// ==========================================
// ПРОВЕРКА ДОСТУПА
// ==========================================

function isAllowed(chatId) {
  return ALLOWED_USERS.indexOf(chatId) !== -1;
}

// ==========================================
// ОБРАБОТЧИКИ КОМАНД
// ==========================================

bot.onText(/\/start|\/help/, (msg) => {
  const chatId = msg.chat.id;

  if (!isAllowed(chatId)) {
    bot.sendMessage(chatId, '⛔ У вас нет доступа к этому боту.');
    return;
  }

  const helpText =
    '🏔 Бот проверки билетов Мачу-Пикчу\n\n' +
    'Команды:\n' +
    '/check ДД.ММ.ГГГГ C1 — проверить Circuito 1\n' +
    '/check ДД.ММ.ГГГГ C2 — проверить Circuito 2\n' +
    '/check ДД.ММ.ГГГГ C3 — проверить Circuito 3\n' +
    '/check ДД.ММ.ГГГГ all — все маршруты\n\n' +
    'Пример: /check 15.06.2026 C1';

  bot.sendMessage(chatId, helpText);
});

bot.onText(/\/check/, (msg) => {
  const chatId = msg.chat.id;

  if (!isAllowed(chatId)) {
    bot.sendMessage(chatId, '⛔ У вас нет доступа к этому боту.');
    return;
  }

  handleCheck(chatId, msg.text);
});

// ==========================================
// ОБРАБОТКА КОМАНДЫ /check
// ==========================================

async function handleCheck(chatId, text) {
  const parts = text.split(/\s+/);
  if (parts.length < 3) {
    bot.sendMessage(chatId, '❌ Формат: /check ДД.ММ.ГГГГ C1\nПример: /check 15.06.2026 C1');
    return;
  }

  const dateStr = parts[1];
  const circuit = parts[2].toUpperCase();

  const dateMatch = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!dateMatch) {
    bot.sendMessage(chatId, '❌ Неверный формат даты. Используй ДД.ММ.ГГГГ\nПример: 15.06.2026');
    return;
  }

  const day = dateMatch[1];
  const month = dateMatch[2];
  const year = dateMatch[3];
  const apiDate = year + '-' + month + '-' + day;
  const displayDate = day + '.' + month + '.' + year;

  // Отправить подтверждение
  bot.sendMessage(chatId, '⏳ Сообщение принято в работу. Начинаю проверку...');

  let routesToCheck = [];
  if (circuit === 'ALL') {
    routesToCheck = ROUTES['C1'].concat(ROUTES['C2']).concat(ROUTES['C3']);
  } else if (ROUTES[circuit]) {
    routesToCheck = ROUTES[circuit];
  } else {
    bot.sendMessage(chatId, '❌ Неверный маршрут. Используй C1, C2, C3 или all');
    return;
  }

  bot.sendMessage(chatId, '⏳ Проверяю билеты на ' + displayDate + '...');

  const resultLines = ['📅 ' + displayDate + '\n'];
  let totalFound = 0;

  for (const route of routesToCheck) {
    try {
      const slots = await getAvailableSlots(apiDate, route.nidcircuito, route.nidruta);

      if (slots === null || slots.length === 0) {
        continue;
      }

      resultLines.push('🟢 ' + route.label + ':');
      for (const slot of slots) {
        const time = slot.dhora_ini.substring(0, 5);
        resultLines.push('   ' + time + ' — ' + slot.ncupo_actual + ' мест');
      }
      resultLines.push('');
      totalFound += slots.length;
    } catch (err) {
      console.error('Error checking route ' + route.nidruta + ':', err.message);
    }
  }

  if (totalFound === 0) {
    bot.sendMessage(chatId, '❌ Билетов нет на ' + displayDate);
  } else {
    bot.sendMessage(chatId, resultLines.join('\n'));
  }
}

// ==========================================
// ЗАПРОС СЛОТОВ ДЛЯ МАРШРУТА
// ==========================================

async function getAvailableSlots(apiDate, nidcircuito, nidruta) {
  try {
    // Получить время сервера
    const timeData = await fetchJson(API_BASE + '/comunes/tiempo-servidor');
    const timestamp = timeData.tiempoServidor;

    // Вычислить HMAC
    const code = computeHmac(HMAC_KEY, timestamp);

    // Подготовить тело запроса
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

    // Отправить запрос
    const respJson = await fetchJson(API_BASE + '/visita/consulta-horarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body
    });

    if (!respJson.estado) {
      console.log('API returned error for route ' + nidruta);
      return null;
    }

    // Расшифровать данные
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
// HTTP ЗАПРОСЫ
// ==========================================

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = url.startsWith('https');
    const lib = isHttps ? require('https') : require('http');

    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = lib.request(reqOptions, (res) => {
      let data = '';
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
// AES РАСШИФРОВКА
// ==========================================

function aesDecrypt(encryptedBase64) {
  try {
    const encryptedBytes = CryptoJS.enc.Base64.parse(encryptedBase64);

    // Извлечь IV (первые 16 байт)
    const iv = CryptoJS.lib.WordArray.create(encryptedBytes.words.slice(0, 4), 16);

    // Извлечь ciphertext (остальные байты)
    const ciphertext = CryptoJS.lib.WordArray.create(
      encryptedBytes.words.slice(4),
      encryptedBytes.sigBytes - 16
    );

    // Сгенерировать ключ
    const key = CryptoJS.PBKDF2(AES_PASSWORD, CryptoJS.enc.Utf8.parse(AES_SALT), {
      keySize: 8,
      iterations: 65536
    });

    // Расшифровать
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
// ОБРАБОТКА ОШИБОК
// ==========================================

bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

bot.on('error', (error) => {
  console.error('Bot error:', error.message);
});

console.log('Разрешённые пользователи:', ALLOWED_USERS);
