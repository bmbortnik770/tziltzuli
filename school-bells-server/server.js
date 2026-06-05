const express  = require('express');
const cors     = require('cors');
const sqlite3  = require('sqlite3').verbose();
const nodeCron = require('node-cron');
const { exec, spawn } = require('child_process');
const path     = require('path');
const multer   = require('multer');
const fs       = require('fs');
const os       = require('os');
const http     = require('http');
const https    = require('https');
const QRCode   = require('qrcode');
const selfsigned = require('selfsigned');

// ── Auto-update ──────────────────────────────────────────────────
const CURRENT_VERSION   = '1.1.0';
const VERSION_CHECK_URL = 'https://raw.githubusercontent.com/bmbortnik770/tziltzuli/main/version.json';

function semverGt(a, b) {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (pa[i] > pb[i]) return true;
        if (pa[i] < pb[i]) return false;
    }
    return false;
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const mod  = url.startsWith('https') ? https : http;
        const req  = mod.get(url, res => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                file.close();
                fs.unlinkSync(dest);
                return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
            res.pipe(file);
            file.on('finish', () => file.close(resolve));
        });
        req.on('error', err => { fs.unlink(dest, () => {}); reject(err); });
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    });
}

function copyDirSync(src, dst) {
    if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name), d = path.join(dst, entry.name);
        entry.isDirectory() ? copyDirSync(s, d) : fs.copyFileSync(s, d);
    }
}

async function checkAndUpdate() {
    if (VERSION_CHECK_URL.includes('PLACEHOLDER')) return; // not configured yet
    try {
        const info = await new Promise((resolve, reject) => {
            const mod = VERSION_CHECK_URL.startsWith('https') ? https : http;
            mod.get(VERSION_CHECK_URL, { headers: { 'Cache-Control': 'no-cache' } }, res => {
                let data = '';
                res.on('data', d => data += d);
                res.on('end', () => {
                    try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
                });
            }).on('error', reject).setTimeout(10000, function(){ this.destroy(); });
        });

        if (!info.version || !info.url || !semverGt(info.version, CURRENT_VERSION)) return;

        console.log(`\n📦 עדכון ${info.version} זמין – מוריד ברקע...`);
        const tmpZip = path.join(os.tmpdir(), 'tziltzuli-update.zip');
        const tmpDir = path.join(os.tmpdir(), 'tziltzuli-update-extracted');

        await downloadFile(info.url, tmpZip);

        // Extract with PowerShell
        await new Promise((res, rej) =>
            exec(`powershell -NoProfile -Command "if(Test-Path '${tmpDir}'){Remove-Item '${tmpDir}' -Recurse -Force}; Expand-Archive -Path '${tmpZip}' -DestinationPath '${tmpDir}' -Force"`,
                err => err ? rej(err) : res())
        );

        // Apply: copy public/ (UI) – safe while running
        const newPublic = path.join(tmpDir, 'public');
        if (fs.existsSync(newPublic)) {
            copyDirSync(newPublic, path.join(__dirname, 'public'));
            console.log('✅ ממשק עודכן');
        }

        // server.js – needs restart; use delayed batch
        const newServer = path.join(tmpDir, 'server.js');
        if (fs.existsSync(newServer)) {
            const restartBat = path.join(os.tmpdir(), 'tziltzuli-restart.bat');
            const serverPath = path.join(__dirname, 'server.js').replace(/\//g, '\\');
            const newSrvPath = newServer.replace(/\//g, '\\');
            const workDir    = __dirname.replace(/\//g, '\\');
            fs.writeFileSync(restartBat,
                `@echo off\r\ntimeout /t 2 /nobreak >nul\r\n` +
                `copy /y "${newSrvPath}" "${serverPath}" >nul\r\n` +
                `cd /d "${workDir}"\r\n` +
                `start /b "" node server.js\r\n` +
                `del "%~f0"\r\n`
            );
            exec(`start /b "" cmd /c "${restartBat.replace(/\//g, '\\')}"`);
            console.log(`✅ גירסה ${info.version} מותקנת – מאתחל...`);
            setTimeout(() => process.exit(0), 1500);
        }

        try { fs.unlinkSync(tmpZip); } catch(e) {}
    } catch(e) {
        // Silent – bad network, server down, etc.
    }
}
// ── End auto-update ───────────────────────────────────────────────

const nodemailer = require('nodemailer');

// Optional packages
let xlsxLib, pdfParse, hebcal;
try { xlsxLib   = require('xlsx');      } catch(e) {}
try { pdfParse  = require('pdf-parse'); } catch(e) {}
// Load @hebcal/core (ESM) via dynamic import at startup
(async () => { try { hebcal = await import('@hebcal/core'); console.log('✅ לוח עברי נטען'); } catch(e) {} })();

const PORT       = 3000;
const PORT_HTTPS = 3443;

const app = express();
app.use(cors({ origin: '*' }));
app.use((req, res, next) => { res.setHeader('Bypass-Tunnel-Reminder', '1'); next(); });
app.use(express.json());
app.use('/uploads', express.static('uploads'));

const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) app.use(express.static(publicDir));
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

const db = new sqlite3.Database('./settings.db');

// ===== IP =====
const getLocalIP = () => {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces))
        for (const iface of interfaces[name])
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    return 'localhost';
};

// ===== Cloudflare Quick Tunnel =====
const CLOUDFLARED = path.join(__dirname, 'cloudflared.exe');
const CF_DL_URL   = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';

let tunnelUrl    = null;
let tunnelStatus = 'disconnected';
let cfProc       = null;

const downloadCF = () => new Promise((resolve, reject) => {
    if (fs.existsSync(CLOUDFLARED)) return resolve();
    console.log('⬇️  מוריד cloudflared (פעם ראשונה בלבד)...');
    const followGet = (url, depth = 0) => {
        if (depth > 8) return reject(new Error('יותר מדי הפניות'));
        const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                res.resume();
                return followGet(res.headers.location, depth + 1);
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
            const tmp = CLOUDFLARED + '.tmp';
            const out = fs.createWriteStream(tmp);
            res.pipe(out);
            out.on('finish', () => out.close(() =>
                fs.rename(tmp, CLOUDFLARED, err => err ? reject(err) : resolve())
            ));
            out.on('error', err => { fs.unlink(tmp, ()=>{}); reject(err); });
        });
        req.on('error', reject);
    };
    followGet(CF_DL_URL);
});

// ===== Email notification =====
const getSetting = (key) => new Promise(resolve =>
    db.get("SELECT value FROM settings WHERE key=?", [key], (err, row) => resolve(row?.value || ''))
);

const sendWhatsAppNotification = async (message) => {
    const [phone, apiKey] = await Promise.all([getSetting('whatsapp_phone'), getSetting('whatsapp_api_key')]);
    if (!phone || !apiKey) return;
    try {
        const waUrl = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(message)}&apikey=${encodeURIComponent(apiKey)}`;
        await new Promise(resolve => https.get(waUrl, res => { res.resume(); resolve(); }).on('error', resolve));
        console.log('📱 WhatsApp נשלח');
    } catch(e) { console.log('⚠️ WhatsApp:', e.message); }
};

const sendTunnelNotification = async (url) => {
    const [notifyEmail, gmailUser, gmailPass, schoolName] = await Promise.all([
        getSetting('notify_email'), getSetting('gmail_user'),
        getSetting('gmail_pass'),   getSetting('school_name'),
    ]);
    if (!notifyEmail || !gmailUser || !gmailPass) return;
    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: gmailUser, pass: gmailPass },
        });
        await transporter.sendMail({
            from:    `"${schoolName || 'צלצולי'}" <${gmailUser}>`,
            to:      notifyEmail,
            subject: `🔔 צלצולי – כתובת גישה מרחוק חדשה`,
            html: `
                <div dir="rtl" style="font-family:sans-serif;max-width:480px;margin:auto">
                  <h2 style="color:#2563eb">🔔 מערכת הצלצולי</h2>
                  <p>המערכת הופעלה מחדש ויש כתובת גישה חדשה:</p>
                  <div style="background:#f1f5f9;border-radius:12px;padding:16px;margin:16px 0;word-break:break-all">
                    <a href="${url}" style="color:#2563eb;font-size:18px;font-weight:bold">${url}</a>
                  </div>
                  <p style="color:#64748b;font-size:13px">שמור את הכתובת. היא תישאר קבועה עד ההפעלה הבאה של המחשב.</p>
                  <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0"/>
                  <p style="color:#94a3b8;font-size:12px">${schoolName}</p>
                </div>`,
        });
        console.log(`📧 נשלח מייל ל: ${notifyEmail}`);
    } catch(e) {
        console.log('⚠️ שגיאת מייל:', e.message);
    }
    await sendWhatsAppNotification(`🔔 צלצולי – כתובת גישה חדשה:\n${url}`);
};

const startTunnel = async () => {
    tunnelStatus = 'connecting';
    try {
        await downloadCF();
        cfProc = spawn(CLOUDFLARED, ['tunnel', '--url', `http://localhost:${PORT}`], { windowsHide: true });

        const onData = chunk => {
            const text = chunk.toString();
            const m = text.match(/https:\/\/[a-z0-9\-]+\.trycloudflare\.com/);
            if (m && m[0] !== tunnelUrl) {
                tunnelUrl    = m[0];
                tunnelStatus = 'connected';
                console.log(`\n🌐 גישה מרחוק: ${tunnelUrl}`);
                sendTunnelNotification(tunnelUrl);
            }
        };
        cfProc.stdout.on('data', onData);
        cfProc.stderr.on('data', onData);

        cfProc.on('close', () => {
            tunnelUrl    = null;
            tunnelStatus = 'reconnecting';
            cfProc       = null;
            setTimeout(startTunnel, 5000);
        });
        cfProc.on('error', err => {
            tunnelUrl    = null;
            tunnelStatus = 'error';
            cfProc       = null;
            console.log('⚠️ cloudflared:', err.message);
            setTimeout(startTunnel, 30000);
        });
    } catch(e) {
        tunnelStatus = 'error';
        console.log('⚠️ מנהרה:', e.message);
        setTimeout(startTunnel, 30000);
    }
};

// ===== Multer: bells =====
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        const allowed = ['.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a'];
        if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
        else cb(new Error('פורמט לא נתמך'));
    }
});

// ===== Multer: announce / emergency / songs =====
const audioUpload = multer({
    storage: multer.diskStorage({
        destination: './uploads/',
        filename: (req, file, cb) => cb(null, Date.now() + '_' + (file.originalname || 'audio.webm'))
    }),
    fileFilter: (req, file, cb) => {
        const ok  = file.mimetype.startsWith('audio/') || file.mimetype.includes('webm') || file.mimetype.includes('ogg');
        const ext = path.extname(file.originalname || '').toLowerCase();
        if (ok || ['.mp3','.wav','.ogg','.aac','.flac','.m4a','.webm','.opus'].includes(ext)) cb(null, true);
        else cb(null, false);
    }
});

const sirenUpload = multer({
    storage: multer.diskStorage({
        destination: './uploads/',
        filename: (req, file, cb) => cb(null, 'siren.mp3')
    }),
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname||'').toLowerCase();
        if (['.mp3','.wav','.ogg','.aac','.flac','.m4a'].includes(ext)||file.mimetype.startsWith('audio/')) cb(null,true);
        else cb(null,false);
    }
});

// ===== Multer: file import (Excel / PDF) =====
const importUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }
});

// ===== DB =====
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS bells (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT, time TEXT,
        days TEXT DEFAULT '0,1,2,3,4,5',
        audio_source TEXT, audio_type TEXT,
        volume INTEGER DEFAULT 80, is_active INTEGER DEFAULT 1,
        duration INTEGER DEFAULT 0
    )`);
    db.run(`ALTER TABLE bells ADD COLUMN duration INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE bells ADD COLUMN bell_type TEXT DEFAULT 'custom'`, () => {});
    db.run(`ALTER TABLE bells ADD COLUMN break_duration INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE bells ADD COLUMN playlist_id INTEGER DEFAULT NULL`, () => {});
    db.run(`ALTER TABLE bells ADD COLUMN repeat_count INTEGER DEFAULT 1`, () => {});
    db.run(`ALTER TABLE bells ADD COLUMN output_device TEXT DEFAULT NULL`, () => {});
    db.run(`ALTER TABLE bells ADD COLUMN start_time REAL DEFAULT 0`, () => {});
    db.run(`ALTER TABLE bells ADD COLUMN playlist_start_delay INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE bells ADD COLUMN playlist_end_offset INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE bells ADD COLUMN playlist_volume INTEGER DEFAULT NULL`, () => {});
    db.run(`CREATE TABLE IF NOT EXISTS bell_presets (
        bell_type TEXT PRIMARY KEY,
        volume INTEGER DEFAULT 80,
        duration INTEGER DEFAULT 0,
        repeat_count INTEGER DEFAULT 1,
        output_device TEXT DEFAULT NULL,
        audio_source TEXT DEFAULT NULL,
        start_time REAL DEFAULT 0
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS schedule_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT, bells_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS template_holiday_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER,
        rule_type TEXT DEFAULT 'holiday',
        rule_value TEXT,
        label TEXT,
        auto_apply INTEGER DEFAULT 1,
        FOREIGN KEY(template_id) REFERENCES schedule_templates(id) ON DELETE CASCADE
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS scheduled_plays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT, file_path TEXT, play_at TEXT,
        played INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS vacations (date TEXT PRIMARY KEY, label TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS playlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT, shuffle INTEGER DEFAULT 0, repeat_mode INTEGER DEFAULT 1,
        is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS playlist_songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        playlist_id INTEGER, name TEXT, file_path TEXT,
        order_num INTEGER DEFAULT 0,
        FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
    )`);
    db.run(`ALTER TABLE playlist_songs ADD COLUMN start_time REAL DEFAULT 0`, () => {});
    db.run(`ALTER TABLE playlist_songs ADD COLUMN duration INTEGER DEFAULT 0`, () => {});
    db.run(`CREATE TABLE IF NOT EXISTS emergency_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT, file_path TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS emergency_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT, label TEXT, details TEXT,
        fired_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS bell_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bell_id INTEGER, bell_label TEXT, time_str TEXT,
        played_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS day_overrides (
        date TEXT PRIMARY KEY, from_day INTEGER, label TEXT DEFAULT ''
    )`);
    [
        ['output_device',     'default'],
        ['master_volume',     '80'],
        ['announce_pin',      '1234'],
        ['school_name',       'בית הספר שלנו'],
        ['principal_name',    'המנהל'],
        ['notify_email',      ''],
        ['gmail_user',        ''],
        ['gmail_pass',        ''],
        ['whatsapp_phone',    ''],
        ['whatsapp_api_key',  ''],
        ['active_template_id',''],
        ['pikud_location',    ''],
    ].forEach(([k, v]) => db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, [k, v]));
});

// ===== Boot-time state restore =====
// Restore Pikud HaOref enabled state from DB
setTimeout(() => {
    db.get("SELECT value FROM settings WHERE key='pikud_enabled'", (e, row) => {
        if (row?.value === '1') { pikudEnabled = true; pikudTimer = setInterval(pollPikud, 5000); console.log('🚨 פיקוד העורף שוחזר'); }
    });
    // Check template holiday rules on startup (in case midnight cron was missed)
    if (hebcal) {
        const info = getTodayHebrewInfo();
        if (!info) return;
        const todayStr = new Date().toISOString().split('T')[0];
        db.get("SELECT value FROM settings WHERE key='active_template_id'", (e, row) => {
            if (row?.value) return; // already set manually
            db.all("SELECT * FROM template_holiday_rules WHERE auto_apply=1", (e2, rules) => {
                if (!rules?.length) return;
                for (const rule of rules) {
                    let matches = false;
                    if (rule.rule_type === 'holiday') {
                        matches = info.holidays?.some(h => h.key === rule.rule_value || h.desc === rule.rule_value);
                    } else if (rule.rule_type === 'date_range') {
                        const [from, to] = (rule.rule_value || '').split(':');
                        if (from && to) matches = todayStr >= from && todayStr <= to;
                    }
                    if (matches) {
                        db.run("UPDATE settings SET value=? WHERE key='active_template_id'", [rule.template_id]);
                        console.log(`📅 תבנית הופעלה ב-boot: ${rule.label}`);
                        break;
                    }
                }
            });
        });
    }
}, 3000);


// ===== Player =====
let currentProcess    = null;
let playlistStopTimer = null;
let playlistState     = { playing: false, playlistId: null, songIndex: 0, songs: [], shuffle: false, repeat: 1 };

const clearPlaylistStop = () => {
    if (playlistStopTimer) { clearTimeout(playlistStopTimer); playlistStopTimer = null; }
};

const killCurrent = () => new Promise(resolve => {
    if (!currentProcess) return resolve();
    const pid = currentProcess.pid;
    currentProcess = null;
    // On Windows, kill the whole process tree (cmd.exe + ffplay child)
    exec(`taskkill /f /t /pid ${pid}`, () => resolve());
});

const playFile = (filePath, volumePct, durationSec, deviceOverride, startSec) => new Promise(resolve => {
    db.get("SELECT value FROM settings WHERE key='output_device'", (e1, devRow) => {
        db.get("SELECT value FROM settings WHERE key='master_volume'", (e2, volRow) => {
            const device  = deviceOverride || devRow?.value || 'default';
            const master  = volRow ? parseInt(volRow.value) : 80;
            const vol     = Math.round(((volumePct || 80) / 100) * (master / 100) * 128);
            const absPath = path.resolve(filePath);
            const env     = { ...process.env };
            if (device !== 'default') env.SDL_AUDIODEVICE = device;
            const seek = startSec && startSec > 0 ? `-ss ${startSec}` : '';
            const dur  = durationSec && durationSec > 0 ? `-t ${durationSec}` : '';
            const cmd  = `ffplay -nodisp -autoexit ${seek} ${dur} -volume ${vol} "${absPath}"`;
            const proc = exec(cmd, { env }, err => {
                if (currentProcess === proc) currentProcess = null;
                if (err && !err.killed) console.error(`⚠️ שגיאת נגינה: ${err.message.split('\n')[0]}`);
                resolve();
            });
            currentProcess = proc;
        });
    });
});

const playBell = async bell => {
    if (!bell.audio_source) return;
    const src    = bell.audio_type === 'local_path' ? bell.audio_source : path.resolve(bell.audio_source);
    const device = bell.output_device || null;
    const count  = Math.max(1, parseInt(bell.repeat_count) || 1);
    const start  = parseFloat(bell.start_time) || 0;
    console.log(`[${new Date().toLocaleTimeString('he-IL')}] 🔔 ${bell.label}${count > 1 ? ` ×${count}` : ''}${bell.output_device ? ` [${bell.output_device}]` : ''}${start > 0 ? ` @${start}s` : ''}`);
    for (let i = 0; i < count; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 600));
        await playFile(src, bell.volume || 80, bell.duration || 0, device, start);
    }
};

const canRing = () => new Promise(resolve => {
    if (new Date().getDay() === 6) { console.log('שבת – חסום'); return resolve(false); }
    const dateStr = new Date().toISOString().split('T')[0];
    db.get("SELECT date FROM vacations WHERE date=?", [dateStr], (err, row) => resolve(!row));
});

// ===== Silent mode =====
let silentUntil = null;
app.post('/api/silent', (req, res) => {
    const { minutes } = req.body;
    if (!minutes || minutes <= 0) { silentUntil = null; return res.json({ active: false }); }
    silentUntil = new Date(Date.now() + minutes * 60 * 1000);
    res.json({ active: true, until: silentUntil.toISOString() });
});
app.get('/api/silent', (req, res) => {
    const active = silentUntil && new Date() < silentUntil;
    res.json({ active: !!active, until: active ? silentUntil.toISOString() : null, minutesLeft: active ? Math.ceil((silentUntil - new Date()) / 60000) : 0 });
});

// ===== Pikud HaOref =====
let pikudEnabled    = false;
let lastPikudId     = null;
let pikudTimer      = null;
let pikudLastPoll   = null;   // ISO timestamp of last successful poll
let pikudLastAlert  = null;   // last alert object (for status endpoint)
let pikudPollError  = null;

const SIREN_FILE = 'uploads/siren.mp3';
const ensureSiren = () => {
    if (fs.existsSync(SIREN_FILE)) return;
    exec(`ffmpeg -f lavfi -i "aevalsrc=sin(2*PI*900*t+2800*(1-cos(2*PI*t/7)))*0.85:s=44100:d=60" -y "${SIREN_FILE}"`,
        err => { if (!err) console.log('✅ נוצר: uploads/siren.mp3'); else console.error('⚠️ שגיאה ביצירת סירנה:', err.message); });
};

const logEmergency = (type, label, details) => {
    db.run(`INSERT INTO emergency_log (type,label,details) VALUES (?,?,?)`,
        [type, label||'', JSON.stringify(details||{})]);
};

const pollPikud = () => {
    const req = https.get('https://www.oref.org.il/WarningMessages/alert/alerts.json', {
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://www.oref.org.il/' }
    }, res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
            pikudLastPoll  = new Date().toISOString();
            pikudPollError = null;
            try {
                const txt = raw.trim();
                if (!txt || txt === '\n') { lastPikudId = null; return; }
                const alert = JSON.parse(txt);
                if (!alert || !alert.id) { lastPikudId = null; return; }
                pikudLastAlert = alert;
                if (alert.id === lastPikudId) return;
                lastPikudId = alert.id;
                const areas   = (alert.data || []);
                const areaStr = areas.join(', ');
                console.log(`\n🚨 [פיקוד העורף] ${alert.title} — ${areaStr}\n`);
                getSetting('pikud_location').then(location => {
                    const locFilter = (location || '').trim();
                    const matches   = !locFilter || areas.some(a =>
                        a.includes(locFilter) || locFilter.includes(a));
                    if (!matches) {
                        console.log(`  ⚠️ אזעקה לא בישוב "${locFilter}" — לא מנגן`);
                        return;
                    }
                    if (fs.existsSync(SIREN_FILE)) {
                        playFile(path.resolve(SIREN_FILE), 100, 0, null, 0);
                        logEmergency('pikud', alert.title, { areas, location: locFilter });
                    }
                });
            } catch(e) { pikudPollError = e.message; }
        });
    });
    req.on('error', e => { pikudPollError = e.message; });
};

const setPikud = (enabled) => {
    pikudEnabled = enabled;
    clearInterval(pikudTimer);
    if (enabled) pikudTimer = setInterval(pollPikud, 5000);
    db.run("INSERT OR REPLACE INTO settings (key,value) VALUES ('pikud_enabled',?)", [enabled?'1':'0']);
};

app.get('/api/pikud/status', (req, res) => res.json({
    enabled: pikudEnabled,
    lastPoll: pikudLastPoll,
    lastAlert: pikudLastAlert,
    pollError: pikudPollError,
}));
app.post('/api/pikud/toggle', (req, res) => { setPikud(!pikudEnabled); res.json({ enabled: pikudEnabled }); });

app.post('/api/pikud/siren', sirenUpload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'קובץ לא חוקי או לא הועלה' });
    res.json({ success: true });
});

app.delete('/api/pikud/siren', (req, res) => {
    if (fs.existsSync(SIREN_FILE)) { try { fs.unlinkSync(SIREN_FILE); } catch {} }
    ensureSiren();
    res.json({ success: true });
});

// Manual test: play siren for 3 seconds regardless of live alerts
app.post('/api/pikud/test', async (req, res) => {
    if (!fs.existsSync(SIREN_FILE)) return res.status(400).json({ error: 'קובץ אזעקה לא קיים' });
    res.json({ success: true });
    logEmergency('test', 'בדיקת אזעקה', {});
    await killCurrent();
    playlistState.playing = false;
    await playFile(path.resolve(SIREN_FILE), 100, 3, null, 0);
});

// ===== Cron =====
nodeCron.schedule('* * * * *', async () => {
    const now       = new Date();
    const actualDay = now.getDay().toString();
    const dateStr   = now.toISOString().split('T')[0];
    const time      = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
    const dtStr     = now.toISOString().slice(0,16).replace('T',' ');

    if (!(await canRing())) return;
    if (silentUntil && new Date() < silentUntil) return;

    // Effective day: may be overridden for today
    const day = await new Promise(resolve =>
        db.get("SELECT from_day FROM day_overrides WHERE date=?", [dateStr],
            (e, row) => resolve(row ? row.from_day.toString() : actualDay))
    );

    // If a template is active for today, use its bells instead
    const activeTmplId = await getSetting('active_template_id');
    const getBellsForTime = (cb) => {
        if (activeTmplId) {
            db.get("SELECT * FROM schedule_templates WHERE id=?", [activeTmplId], (e, tmpl) => {
                if (!tmpl) return db.all("SELECT * FROM bells WHERE time=? AND is_active=1", [time], cb);
                const allBells = JSON.parse(tmpl.bells_json || '[]');
                cb(null, allBells.filter(b => b.time === time && b.is_active));
            });
        } else {
            db.all("SELECT * FROM bells WHERE time=? AND is_active=1", [time], cb);
        }
    };

    getBellsForTime((err, rows) => {
        if (!rows?.length) return;
        rows.forEach(bell => {
            const days = bell.days?.split(',') || ['0','1','2','3','4','5'];
            if (!days.includes(day)) return;
            if (bell.audio_source) playBell(bell);
            db.run("INSERT INTO bell_log (bell_id, bell_label, time_str) VALUES (?,?,?)", [bell.id, bell.label, time]);
            // Auto-start playlist for break bells that have a playlist assigned
            if (bell.bell_type === 'break_start' && bell.playlist_id) {
                db.get("SELECT * FROM playlists WHERE id=?", [bell.playlist_id], (e, pl) => {
                    if (!pl) return;
                    db.all("SELECT * FROM playlist_songs WHERE playlist_id=? ORDER BY order_num", [pl.id], async (e2, songs) => {
                        if (!songs?.length) return;
                        const startDelay  = Math.max(0, parseInt(bell.playlist_start_delay) || 0) * 1000;
                        const endOffset   = Math.max(0, parseInt(bell.playlist_end_offset) || 0); // seconds before next bell
                        const plVol       = bell.playlist_volume != null ? parseInt(bell.playlist_volume) : null;

                        // Calculate stop time: find next bell after this one
                        let stopMs = 0;
                        if (bell.break_duration > 0) {
                            stopMs = (bell.break_duration * 60 - endOffset) * 1000;
                        } else {
                            // Find next bell in today's effective schedule (filter by active day)
                            db.all("SELECT time FROM bells WHERE is_active=1 AND time > ? AND (',' || COALESCE(days,'0,1,2,3,4,5') || ',') LIKE ? ORDER BY time ASC LIMIT 1", [time, `%,${day},%`], (e3, nextRows) => {
                                const nextBell = nextRows?.[0];
                                if (nextBell) {
                                    const [nh, nm] = nextBell.time.split(':').map(Number);
                                    const [ch, cm] = time.split(':').map(Number);
                                    const diffSec = (nh * 60 + nm) - (ch * 60 + cm);
                                    const realStopMs = diffSec > 0 ? Math.max(0, (diffSec * 60 - endOffset)) * 1000 : 0;
                                    if (realStopMs > 0) {
                                        clearPlaylistStop();
                                        playlistStopTimer = setTimeout(() => { playlistState.playing = false; killCurrent(); playlistStopTimer = null; }, startDelay + realStopMs);
                                    }
                                }
                            });
                        }

                        setTimeout(async () => {
                            clearPlaylistStop();
                            await killCurrent();
                            playlistState = { playing: true, playlistId: pl.id, songIndex: 0, songs, shuffle: !!pl.shuffle, repeat: pl.repeat_mode, volume: plVol };
                            playPlaylistSong();
                            if (stopMs > 0) {
                                playlistStopTimer = setTimeout(() => { playlistState.playing = false; killCurrent(); playlistStopTimer = null; }, stopMs);
                            }
                        }, startDelay || 1000);
                    });
                });
            }
        });
    });

    // Scheduled one-time plays
    db.all("SELECT * FROM scheduled_plays WHERE played=0 AND play_at IS NOT NULL AND play_at<=?", [dtStr], (err, rows) => {
        if (!rows?.length) return;
        rows.forEach(sp => {
            db.run("UPDATE scheduled_plays SET played=1 WHERE id=?", [sp.id]);
            console.log(`[${new Date().toLocaleTimeString('he-IL')}] 📅 מוקלט מתוזמן: ${sp.label}`);
            playFile(sp.file_path, 80, 0);
        });
    });
});

// ===== Hebrew calendar helpers =====
const HEBREW_MONTHS = ['','ניסן','אייר','סיון','תמוז','אב','אלול','תשרי','חשון','כסלו','טבת','שבט','אדר','אדר ב׳'];
const getHebrewDayStr = (n) => ['','א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ז׳','ח׳','ט׳','י׳','י״א','י״ב','י״ג','י״ד','ט״ו','ט״ז','י״ז','י״ח','י״ט','כ׳','כ״א','כ״ב','כ״ג','כ״ד','כ״ה','כ״ו','כ״ז','כ״ח','כ״ט','ל׳'][n] || n;

const getTodayHebrewInfo = () => {
    if (!hebcal) return null;
    try {
        const { HDate, HebrewCalendar } = hebcal;
        const today = new HDate();
        const events = HebrewCalendar.calendar({ start: today, end: today, il: true, noHolidays: false, shabbat: false, noMinorHolidays: false });
        return {
            day: today.getDate(),
            month: today.getMonth(),
            year: today.getFullYear(),
            monthHe: HEBREW_MONTHS[today.getMonth()] || today.getMonthName(),
            dayHe: getHebrewDayStr(today.getDate()),
            holidays: events.map(e => ({ key: e.basename(), desc: e.getDesc(), he: e.renderBrief?.('he') || e.getDesc() })),
        };
    } catch(e) { return null; }
};

const getUpcomingHolidays = (days = 60) => {
    if (!hebcal) return [];
    try {
        const { HDate, HebrewCalendar } = hebcal;
        const start = new HDate();
        const end   = new HDate(new Date(Date.now() + days * 24 * 3600 * 1000));
        const events = HebrewCalendar.calendar({ start, end, il: true, noHolidays: false, shabbat: false, noMinorHolidays: false });
        return events.map(e => ({
            key: e.basename(),
            desc: e.getDesc(),
            he: e.renderBrief?.('he') || e.getDesc(),
            date: e.getDate().greg().toISOString().split('T')[0],
        }));
    } catch(e) { return []; }
};

// Midnight cron: check template holiday rules
nodeCron.schedule('0 0 * * *', async () => {
    db.run("UPDATE settings SET value='' WHERE key='active_template_id'");
    if (!hebcal) return;
    const info = getTodayHebrewInfo();
    if (!info) return;
    const todayStr = new Date().toISOString().split('T')[0];
    db.all("SELECT * FROM template_holiday_rules WHERE auto_apply=1", (e, rules) => {
        if (!rules?.length) return;
        for (const rule of rules) {
            let matches = false;
            if (rule.rule_type === 'holiday') {
                matches = info.holidays.some(h => h.key.toLowerCase().includes(rule.rule_value.toLowerCase()));
            } else if (rule.rule_type === 'date_range') {
                const [from, to] = (rule.rule_value || '').split(':');
                if (from && to) matches = todayStr >= from && todayStr <= to;
            }
            if (matches) {
                db.run("UPDATE settings SET value=? WHERE key='active_template_id'", [rule.template_id]);
                console.log(`📅 תבנית לוח עברי מופעלת: ${rule.label}`);
                break;
            }
        }
    });
});

// ===== Playlist player =====
const playPlaylistSong = async () => {
    if (!playlistState.playing || !playlistState.songs.length) return;
    const songs = playlistState.songs;
    let idx = playlistState.songIndex;
    if (idx >= songs.length) {
        if (playlistState.repeat) { idx = 0; playlistState.songIndex = 0; }
        else { playlistState.playing = false; return; }
    }
    const song = playlistState.shuffle
        ? songs[Math.floor(Math.random() * songs.length)]
        : songs[idx];
    const vol = playlistState.volume != null ? playlistState.volume : 80;
    console.log(`[${new Date().toLocaleTimeString('he-IL')}] 🎵 ${song.name}${song.start_time > 0 ? ` @${song.start_time}s` : ''}`);
    await killCurrent();
    await playFile(song.file_path, vol, song.duration || 0, null, song.start_time || 0);
    if (playlistState.playing) { playlistState.songIndex++; playPlaylistSong(); }
};

// ===== API: general =====
// ה-VBS launcher בודק endpoint זה כדי לדעת אם השרת פועל
app.get('/api/status', (req, res) => res.json({ status: 'ok', version: CURRENT_VERSION }));

app.get('/api/data', (req, res) => {
    db.all("SELECT * FROM bells ORDER BY time ASC", (e1, bells) => {
        db.all("SELECT * FROM vacations ORDER BY date ASC", (e2, vacations) => {
            db.all("SELECT * FROM settings", (e3, settings) => {
                const s = {}; (settings||[]).forEach(r => s[r.key] = r.value);
                res.json({
                    bells: bells||[], vacations: vacations||[], settings: s,
                    time: new Date().toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit',second:'2-digit'}),
                    todayBlocked: new Date().getDay() === 6,
                    playerState: { playing: playlistState.playing, playlistId: playlistState.playlistId, songIndex: playlistState.songIndex }
                });
            });
        });
    });
});

// ===== API: bells — check files =====
app.get('/api/bells/check-files', (req, res) => {
    db.all("SELECT id,label,time,audio_source,audio_type FROM bells WHERE audio_source IS NOT NULL AND audio_source != ''", (err, bells) => {
        const results = (bells||[]).map(b => {
            const p = b.audio_type === 'local_path' ? b.audio_source : path.join(__dirname, b.audio_source);
            return { ...b, exists: fs.existsSync(p) };
        });
        res.json({ results, missing: results.filter(r=>!r.exists).length, total: results.length });
    });
});

// ===== API: schedule templates =====
app.get('/api/templates', (req, res) => {
    db.all("SELECT id,name,created_at FROM schedule_templates ORDER BY created_at DESC", (err, rows) => res.json({ templates: rows||[] }));
});
app.post('/api/templates', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'שם חסר' });
    db.all("SELECT * FROM bells", (err, bells) => {
        db.run("INSERT INTO schedule_templates (name,bells_json) VALUES (?,?)",
            [name, JSON.stringify(bells||[])],
            function(e) { if(e) return res.status(500).json({error:e.message}); res.json({ success:true, id:this.lastID }); });
    });
});
app.get('/api/templates/:id', (req, res) => {
    db.get("SELECT * FROM schedule_templates WHERE id=?", [req.params.id], (err, t) => {
        if (!t) return res.status(404).json({ error: 'לא נמצא' });
        res.json({ ...t, bells: JSON.parse(t.bells_json||'[]') });
    });
});
app.delete('/api/templates/:id', (req, res) => {
    db.run("DELETE FROM schedule_templates WHERE id=?", [req.params.id], err => res.json({ success: !err }));
});
app.post('/api/templates/:id/activate', (req, res) => {
    db.get("SELECT id FROM schedule_templates WHERE id=?", [req.params.id], (e, row) => {
        if (!row) return res.status(404).json({ error: 'לא נמצא' });
        db.run("UPDATE settings SET value=? WHERE key='active_template_id'", [req.params.id],
            err => err ? res.status(500).json({error:err.message}) : res.json({success:true, active_template_id: req.params.id}));
    });
});

app.post('/api/templates/deactivate', (req, res) => {
    db.run("UPDATE settings SET value='' WHERE key='active_template_id'",
        e => e ? res.status(500).json({error:e.message}) : res.json({success:true}));
});

// ===== API: bell presets =====
app.get('/api/bell-presets', (req, res) => {
    db.all("SELECT * FROM bell_presets", (e, rows) => {
        const presets = {};
        (rows || []).forEach(r => { presets[r.bell_type] = r; });
        res.json(presets);
    });
});

app.post('/api/bell-presets/:type', (req, res) => {
    const { volume, duration, repeat_count, output_device, audio_source, start_time } = req.body;
    db.run(`INSERT OR REPLACE INTO bell_presets (bell_type,volume,duration,repeat_count,output_device,audio_source,start_time) VALUES (?,?,?,?,?,?,?)`,
        [req.params.type, parseInt(volume)||80, parseInt(duration)||0, parseInt(repeat_count)||1, output_device||null, audio_source||null, parseFloat(start_time)||0],
        e => e ? res.status(500).json({error:e.message}) : res.json({success:true}));
});

// ===== API: Hebrew calendar =====
app.get('/api/hebrew/today', (req, res) => {
    const info = getTodayHebrewInfo();
    if (!info) return res.json({ available: false });
    res.json({ available: true, ...info });
});

app.get('/api/hebrew/upcoming', (req, res) => {
    res.json({ available: !!hebcal, holidays: getUpcomingHolidays(90) });
});

// Convert Hebrew date(s) to Gregorian ISO
// POST body: { date: {day,month,year} } or { from: {day,month,year}, to: {day,month,year} }
app.post('/api/hebrew/convert', (req, res) => {
    const convert = ({ day, month, year }) => {
        const hyear = year || guessHebYear(month);
        return hebToGreg(parseInt(day), Object.keys(HEB_MONTH_NUMS).find(k => HEB_MONTH_NUMS[k] === parseInt(month)), parseInt(hyear));
    };
    try {
        if (req.body.date) {
            const iso = convert(req.body.date);
            if (!iso) return res.status(400).json({ error: 'תאריך לא תקין' });
            return res.json({ iso });
        }
        if (req.body.from && req.body.to) {
            const from = convert(req.body.from);
            const to   = convert(req.body.to);
            if (!from || !to) return res.status(400).json({ error: 'תאריך לא תקין' });
            const days = from <= to ? expandRange(from, to) : [];
            return res.json({ from, to, days });
        }
        res.status(400).json({ error: 'חסרים שדות' });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// ===== API: template holiday rules =====
app.get('/api/template-rules', (req, res) => {
    db.all(`SELECT tr.*, st.name AS template_name FROM template_holiday_rules tr
            LEFT JOIN schedule_templates st ON tr.template_id=st.id ORDER BY tr.id`,
        (e, rows) => res.json(rows || []));
});

app.post('/api/template-rules', (req, res) => {
    const { template_id, rule_type, rule_value, label, auto_apply } = req.body;
    if (!template_id || !rule_value) return res.status(400).json({ error: 'חסרים פרטים' });
    db.run(`INSERT INTO template_holiday_rules (template_id,rule_type,rule_value,label,auto_apply) VALUES (?,?,?,?,?)`,
        [template_id, rule_type||'holiday', rule_value, label||rule_value, auto_apply===false?0:1],
        function(e) { e ? res.status(500).json({error:e.message}) : res.json({success:true,id:this.lastID}); });
});

app.delete('/api/template-rules/:id', (req, res) => {
    db.run("DELETE FROM template_holiday_rules WHERE id=?", [req.params.id],
        e => e ? res.status(500).json({error:e.message}) : res.json({success:true}));
});

// ===== API: PDF schedule import =====
app.post('/api/import-schedule-pdf', importUpload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'לא הועלה קובץ' });
    if (!pdfParse) return res.status(500).json({ error: 'ספריית pdf-parse לא זמינה' });
    try {
        const data = await pdfParse(req.file.buffer);
        const text = data.text;
        const timeRegex = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
        const lines = text.split('\n');
        const bells = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const matches = [...trimmed.matchAll(new RegExp(timeRegex.source, 'g'))];
            if (!matches.length) continue;

            let bell_type = 'lesson_start';
            if (/הפסקה|break/i.test(trimmed))             bell_type = 'break_start';
            else if (/כניסה|פתיחה|התחלה|בוקר/i.test(trimmed)) bell_type = 'day_start';
            else if (/יציאה|סיום|סוף/i.test(trimmed))     bell_type = 'day_end';

            const label = trimmed
                .replace(new RegExp(timeRegex.source, 'g'), '')
                .replace(/[-–—:,.|/\\]/g, ' ')
                .trim().replace(/\s+/g, ' ')
                .slice(0, 40) || '';

            for (const m of matches) {
                bells.push({ time: m[0], bell_type, label });
            }
        }

        const seen = new Set();
        const unique = bells.filter(b => { if (seen.has(b.time)) return false; seen.add(b.time); return true; });
        unique.sort((a, b) => a.time.localeCompare(b.time));

        // Auto-classify if no context found
        if (unique.length >= 2 && !unique.some(b => b.bell_type !== 'lesson_start')) {
            unique.forEach((b, i) => {
                if (i === 0) b.bell_type = 'day_start';
                else if (i === unique.length - 1) b.bell_type = 'day_end';
                else b.bell_type = i % 2 === 0 ? 'lesson_start' : 'break_start';
            });
        }

        res.json({ bells: unique, pages: data.numpages, text_preview: text.slice(0, 400) });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// ===== API: audio stream proxy (for waveform on local files) =====
app.get('/api/audio-stream', (req, res) => {
    const src = req.query.src;
    if (!src) return res.status(400).end();
    const abs = path.resolve(src);
    if (!fs.existsSync(abs)) return res.status(404).end();
    const stat = fs.statSync(abs);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(abs).pipe(res);
});

app.post('/api/templates/:id/apply', (req, res) => {
    db.get("SELECT * FROM schedule_templates WHERE id=?", [req.params.id], (err, t) => {
        if (!t) return res.status(404).json({ error: 'לא נמצא' });
        const bells = JSON.parse(t.bells_json||'[]');
        db.serialize(() => {
            db.run("DELETE FROM bells");
            bells.forEach(b => db.run(
                `INSERT INTO bells (label,time,days,audio_source,audio_type,volume,is_active,duration,bell_type,break_duration,playlist_id,repeat_count,output_device,start_time,playlist_start_delay,playlist_end_offset,playlist_volume) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [b.label,b.time,b.days,b.audio_source,b.audio_type,b.volume,b.is_active,b.duration,b.bell_type,b.break_duration,b.playlist_id,b.repeat_count||1,b.output_device||null,b.start_time||0,b.playlist_start_delay||0,b.playlist_end_offset||0,b.playlist_volume!=null?b.playlist_volume:null]
            ));
            res.json({ success:true, count: bells.length });
        });
    });
});

// ===== API: tunnel =====
app.get('/api/tunnel/status', (req, res) => res.json({ url: tunnelUrl, status: tunnelStatus }));

// ===== API: sound library =====
app.get('/api/sounds', (req, res) => {
    const SYSTEM_FILES = new Set(['siren.mp3']);
    const files = fs.readdirSync('./uploads')
        .filter(f => /\.(mp3|wav|ogg|m4a|aac)$/i.test(f) && !SYSTEM_FILES.has(f))
        .map(f => ({ name: f, path: `uploads/${f}`, url: `/uploads/${f}`, connectedBells: [] }));
    if (files.length === 0) return res.json(files);
    let pending = files.length;
    files.forEach(file => {
        db.all("SELECT id, label FROM bells WHERE audio_source=?", [file.path], (e, rows) => {
            file.connectedBells = rows || [];
            if (--pending === 0) res.json(files);
        });
    });
});

app.post('/api/sounds/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'לא הועלה קובץ' });
    const originalName = req.body.name || req.file.originalname;
    const ext = path.extname(req.file.originalname) || '.mp3';
    const safeName = originalName.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
    const finalName = safeName.endsWith(ext) ? safeName : safeName + ext;
    const dest = path.join('uploads', finalName);
    fs.rename(req.file.path, dest, err => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, name: finalName, url: `/uploads/${finalName}` });
    });
});

app.post('/api/sounds/:filename/play', async (req, res) => {
    const filePath = path.join('uploads', req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'לא נמצא' });
    const { start_time, duration } = req.body || {};
    await killCurrent();
    playlistState.playing = false;
    res.json({ success: true });
    await playFile(filePath, 80, parseInt(duration)||0, null, parseFloat(start_time)||0);
});

app.delete('/api/sounds/:filename', (req, res) => {
    const filename = req.params.filename;
    const force    = req.query.force === 'true';
    const filePath = path.join('uploads', filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'לא נמצא' });
    db.get("SELECT COUNT(*) as cnt FROM bells WHERE audio_source=?", [`uploads/${filename}`], (e, row) => {
        if (row?.cnt > 0 && !force) return res.status(400).json({ error: `מחובר ל-${row.cnt} צלצול/ים`, connected: row.cnt });
        fs.unlink(filePath, err => {
            if (err) return res.status(500).json({ error: err.message });
            if (row?.cnt > 0) db.run("UPDATE bells SET audio_source='', audio_type='local_path' WHERE audio_source=?", [`uploads/${filename}`]);
            res.json({ success: true });
        });
    });
});

app.delete('/api/bells', (req, res) => {
    db.run("DELETE FROM bells", err => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/type-defaults', (req, res) => {
    db.all("SELECT key,value FROM settings WHERE key LIKE 'default_audio_%'", (e, rows) => {
        const result = {};
        (rows||[]).forEach(r => { result[r.key.replace('default_audio_','')] = r.value; });
        res.json(result);
    });
});

app.post('/api/type-defaults', (req, res) => {
    const { type, audio_source } = req.body;
    if (!type || !/^[\w_]+$/.test(type)) return res.status(400).json({ error: 'סוג לא חוקי' });
    db.run("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)",
        [`default_audio_${type}`, audio_source||''],
        () => res.json({ success: true }));
});

// ===== API: bells =====
app.post('/api/bells', upload.single('file'), (req, res) => {
    const { label, time, days, audio_type, local_path, volume, duration, bell_type, break_duration, repeat_count, output_device } = req.body;
    if (!label || !time) return res.status(400).json({ error: 'שם ושעה חובה' });
    let source = '';
    if (audio_type === 'upload') {
        if (!req.file) return res.status(400).json({ error: 'לא הועלה קובץ' });
        source = req.file.path;
    } else if (local_path) {
        if (!fs.existsSync(local_path)) return res.status(400).json({ error: 'הקובץ לא נמצא: ' + local_path });
        source = local_path;
    }
    const resolvedType = (audio_type === 'library') ? 'local_path' : (audio_type || 'upload');
    const daysStr = Array.isArray(days) ? days.join(',') : (days || '0,1,2,3,4,5');
    const plId = req.body.playlist_id ? parseInt(req.body.playlist_id) : null;
    db.run(`INSERT INTO bells (label,time,days,audio_source,audio_type,volume,duration,bell_type,break_duration,playlist_id,repeat_count,output_device,start_time) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [label, time, daysStr, source, resolvedType, parseInt(volume)||80, parseInt(duration)||0, bell_type||'custom', parseInt(break_duration)||0, plId, parseInt(repeat_count)||1, output_device||null, parseFloat(req.body.start_time)||0],
        function(err) { if(err) return res.status(500).json({error:err.message}); res.json({success:true,id:this.lastID}); });
});

app.put('/api/bells/:id', upload.single('file'), (req, res) => {
    const { label, time, days, volume, is_active, duration, bell_type, break_duration, playlist_id, audio_type, local_path, repeat_count, output_device } = req.body;
    const daysStr = Array.isArray(days) ? days.join(',') : days;
    db.get("SELECT * FROM bells WHERE id=?", [req.params.id], (err, existing) => {
        if (!existing) return res.status(404).json({error:'לא נמצא'});
        let source = existing.audio_source;
        let atype  = existing.audio_type;
        if (audio_type === 'upload' && req.file) {
            source = req.file.path; atype = 'upload';
        } else if ((audio_type === 'local_path' || audio_type === 'library') && local_path) {
            source = local_path; atype = 'local_path';
        }
        const { start_time, playlist_start_delay, playlist_end_offset, playlist_volume } = req.body;
        db.run(`UPDATE bells SET label=?,time=?,days=?,volume=?,is_active=?,duration=?,bell_type=?,break_duration=?,playlist_id=?,audio_source=?,audio_type=?,repeat_count=?,output_device=?,start_time=?,playlist_start_delay=?,playlist_end_offset=?,playlist_volume=? WHERE id=?`,
            [label, time, daysStr, parseInt(volume)||80, is_active, parseInt(duration)||0, bell_type||'custom', parseInt(break_duration)||0, playlist_id?parseInt(playlist_id):null, source, atype, parseInt(repeat_count)||1, output_device||null, parseFloat(start_time)||0, parseInt(playlist_start_delay)||0, parseInt(playlist_end_offset)||0, playlist_volume!=null?parseInt(playlist_volume):null, req.params.id],
            e => { if(e) return res.status(500).json({error:e.message}); res.json({success:true}); });
    });
});

app.delete('/api/bells/:id', (req, res) => {
    db.run("DELETE FROM bells WHERE id=?", [req.params.id],
        err => { if(err) return res.status(500).json({error:err.message}); res.json({success:true}); });
});

app.post('/api/bells/duplicate/:id', (req, res) => {
    db.get("SELECT * FROM bells WHERE id=?", [req.params.id], (err, b) => {
        if (!b) return res.status(404).json({error:'לא נמצא'});
        db.run(`INSERT INTO bells (label,time,days,audio_source,audio_type,volume,duration,is_active,bell_type,break_duration,playlist_id,repeat_count,output_device,start_time,playlist_start_delay,playlist_end_offset,playlist_volume) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [b.label+' (עותק)', b.time, b.days, b.audio_source, b.audio_type, b.volume, b.duration||0, b.is_active, b.bell_type||'custom', b.break_duration||0, b.playlist_id||null, b.repeat_count||1, b.output_device||null, b.start_time||0, b.playlist_start_delay||0, b.playlist_end_offset||0, b.playlist_volume!=null?b.playlist_volume:null],
            function(e) { if(e) return res.status(500).json({error:e.message}); res.json({success:true,id:this.lastID}); });
    });
});

app.post('/api/bells/play/:id', (req, res) => {
    db.get("SELECT * FROM bells WHERE id=?", [req.params.id], (err, bell) => {
        if (!bell) return res.status(404).json({error:'לא נמצא'});
        const overrideStart = req.query.start != null ? parseFloat(req.query.start) : undefined;
        const overrideDur   = req.query.dur   != null ? parseFloat(req.query.dur)   : undefined;
        if (overrideStart !== undefined || overrideDur !== undefined) {
            const src = bell.audio_type === 'local_path' ? bell.audio_source : path.resolve(bell.audio_source);
            playFile(src, bell.volume||80, overrideDur ?? bell.duration, bell.output_device||null, overrideStart ?? bell.start_time);
        } else {
            playBell(bell);
        }
        res.json({success:true});
    });
});

// ===== API: Import schedule from Excel / PDF =====
const guessHebBellType = label => {
    if (!label) return 'custom';
    const l = label.toString().trim();
    if (/כניס|פתיח|בוק|התחל/.test(l)) return 'day_start';
    if (/יציא|סיו|גמ|שחרור|הסת/.test(l)) return 'day_end';
    if (/הפסק/.test(l)) return 'break_start';
    if (/שיעו|לימו|ש\s*[0-9]|שעו/.test(l)) return 'lesson_start';
    return 'custom';
};

// Extract HH:MM from a string — supports both 07:30 and 07.30 formats
const extractTime = str => {
    const s = str.toString();
    let m = s.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (m) return `${m[1].padStart(2,'0')}:${m[2]}`;
    m = s.match(/\b([01]?\d|2[0-3])\.([0-5]\d)\b/);
    if (m) return `${m[1].padStart(2,'0')}:${m[2]}`;
    return null;
};

// Extract ALL times from a string (for range detection: "08:00-08:45")
const extractAllTimes = str => {
    const s = str.toString();
    const times = [];
    const re = /\b([01]?\d|2[0-3])[:\.]([0-5]\d)\b/g;
    let m;
    while ((m = re.exec(s)) !== null)
        times.push(`${m[1].padStart(2,'0')}:${m[2]}`);
    return times;
};

const stripTime = str =>
    str.replace(/\b([01]?\d|2[0-3])[:\.]([0-5]\d)\b[-–—\s]*/g, '')
       .replace(/[-–—\s]+$/, '').trim();

app.post('/api/bells/import-schedule', importUpload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'לא הועלה קובץ' });
    const ext = path.extname(req.file.originalname).toLowerCase();

    try {
        let rows = [];
        let rawText = '';

        if (['.xlsx', '.xls', '.csv'].includes(ext)) {
            if (!xlsxLib) return res.status(400).json({ error: 'חבילת xlsx לא מותקנת' });
            const wb = xlsxLib.read(req.file.buffer, { type: 'buffer', raw: false });
            wb.SheetNames.forEach(sName => {
                const sheet = xlsxLib.utils.sheet_to_json(wb.Sheets[sName], { header: 1, raw: false });
                sheet.forEach(row => {
                    if (!Array.isArray(row)) return;
                    // Find first cell containing a time
                    let time = null;
                    for (const cell of row) {
                        if (!cell) continue;
                        time = extractTime(cell.toString());
                        if (time) break;
                    }
                    if (!time) return;
                    // Label = all non-time text cells joined
                    const label = row
                        .filter(c => c && !extractTime(c.toString()))
                        .join(' ').trim();
                    rows.push({ time, label });
                });
            });

        } else if (ext === '.pdf') {
            if (!pdfParse) return res.status(400).json({ error: 'חבילת pdf-parse לא מותקנת' });
            const data = await pdfParse(req.file.buffer);
            rawText = data.text || '';

            // Strategy 1: line-by-line (most PDFs)
            const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            lines.forEach(line => {
                const time = extractTime(line);
                if (!time) return;
                const label = stripTime(line);
                const allTimes = extractAllTimes(line);
                rows.push({ time, label, allTimes });
            });

            // Strategy 2: if nothing found, try treating whole text as one block
            // and look for time+label patterns with surrounding context
            if (rows.length === 0) {
                const re = /([01]?\d|2[0-3])[:\.]([0-5]\d)\s*[-–—]?\s*([^\d\n]{2,40})/g;
                let m;
                while ((m = re.exec(rawText)) !== null) {
                    const time = `${m[1].padStart(2,'0')}:${m[2]}`;
                    const label = m[3].replace(/\s+/g, ' ').trim();
                    if (label) rows.push({ time, label });
                }
            }

        } else {
            return res.status(400).json({ error: 'פורמט לא נתמך – xlsx / xls / csv / pdf' });
        }

        // Expand time-range rows: "08:00-08:45 שיעור א" → two entries
        const timeToMin = t => { const [h,m]=t.split(':').map(Number); return h*60+m; };
        const expanded = [];
        rows.forEach(r => {
            // Use allTimes from original line text (captures both ends of a range)
            const times = (r.allTimes && r.allTimes.length >= 2)
                ? r.allTimes
                : extractAllTimes(r.label + ' ' + r.time);
            const uniqueTimes = [...new Set([r.time, ...times])].sort();
            if (uniqueTimes.length >= 2) {
                const startT = uniqueTimes[0];
                const endT   = uniqueTimes[1];
                const cleanLabel = stripTime(r.label) || r.label;
                const startType  = guessHebBellType(cleanLabel);
                const endType = startType === 'lesson_start' ? 'break_start'
                              : startType === 'break_start'  ? 'lesson_start'
                              : 'custom';
                const rangeDur = timeToMin(endT) - timeToMin(startT);
                expanded.push({
                    time: startT, label: cleanLabel, fromRange: true,
                    break_duration: startType === 'break_start' && rangeDur > 0 ? rangeDur : 0,
                });
                expanded.push({ time: endT, label: cleanLabel, fromRange: true, forcedType: endType, isEnd: true });
            } else {
                expanded.push(r);
            }
        });

        // Deduplicate by time — prefer start-of-range entries over end-of-range
        const seen = new Map();
        expanded.forEach(r => { if (!seen.has(r.time) || !r.isEnd) seen.set(r.time, r); });
        rows = [...seen.values()].sort((a, b) => a.time.localeCompare(b.time));

        const entries = rows.map((r, i) => {
            const bell_type = r.forcedType || guessHebBellType(r.label);
            let break_duration = r.break_duration || 0;
            // If not pre-calculated from a range, infer from next entry
            if (bell_type === 'break_start' && !break_duration && rows[i + 1]) {
                const [h1, m1] = r.time.split(':').map(Number);
                const [h2, m2] = rows[i + 1].time.split(':').map(Number);
                const diff = (h2 * 60 + m2) - (h1 * 60 + m1);
                if (diff > 0 && diff <= 60) break_duration = diff;
            }
            return { time: r.time, label: r.label || `צלצול ${r.time}`, bell_type, break_duration };
        });

        if (entries.length === 0) {
            return res.status(422).json({
                error: 'לא נמצאו שעות בקובץ. ודא שהקובץ מכיל שעות בפורמט HH:MM',
                rawText: rawText.slice(0, 500) || null,
            });
        }

        res.json({ entries, rawText: rawText.slice(0, 1000) });
    } catch (e) {
        res.status(500).json({ error: 'שגיאה: ' + e.message });
    }
});

// Copy all bells that include fromDay → create new independent entries for toDay
app.post('/api/bells/copy-day', (req, res) => {
    const { fromDay, toDay } = req.body;
    if (fromDay === undefined || toDay === undefined)
        return res.status(400).json({ error: 'חסרים פרמטרים' });

    db.all("SELECT * FROM bells", (err, bells) => {
        if (err) return res.status(500).json({ error: err.message });

        const source = bells.filter(b =>
            (b.days || '').split(',').filter(Boolean).includes(fromDay.toString())
        );
        if (!source.length) return res.json({ success: true, count: 0 });

        const stmt = db.prepare(
            `INSERT INTO bells (label,time,days,audio_source,audio_type,volume,duration,is_active,bell_type,break_duration,playlist_id,repeat_count,output_device,start_time,playlist_start_delay,playlist_end_offset,playlist_volume) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        );
        source.forEach(b =>
            stmt.run(b.label, b.time, toDay.toString(), b.audio_source, b.audio_type, b.volume, b.duration||0, b.is_active, b.bell_type||'custom', b.break_duration||0, b.playlist_id||null, b.repeat_count||1, b.output_device||null, b.start_time||0, b.playlist_start_delay||0, b.playlist_end_offset||0, b.playlist_volume!=null?b.playlist_volume:null)
        );
        stmt.finalize(e => {
            if (e) return res.status(500).json({ error: e.message });
            res.json({ success: true, count: source.length });
        });
    });
});

// ===== API: vacations =====
app.post('/api/vacations', (req, res) => {
    const { date, label } = req.body;
    if (!date) return res.status(400).json({error:'תאריך חסר'});
    db.run(`INSERT OR REPLACE INTO vacations (date,label) VALUES (?,?)`, [date, label||''],
        err => { if(err) return res.status(500).json({error:err.message}); res.json({success:true}); });
});

app.post('/api/vacations/bulk', (req, res) => {
    const { vacations } = req.body;
    if (!Array.isArray(vacations) || !vacations.length) return res.status(400).json({error:'אין נתונים'});
    const stmt = db.prepare(`INSERT OR REPLACE INTO vacations (date,label) VALUES (?,?)`);
    vacations.forEach(v => stmt.run(v.date, v.label||''));
    stmt.finalize(err => { if(err) return res.status(500).json({error:err.message}); res.json({success:true, count: vacations.length}); });
});

app.delete('/api/vacations/:date', (req, res) => {
    db.run("DELETE FROM vacations WHERE date=?", [req.params.date],
        err => { if(err) return res.status(500).json({error:err.message}); res.json({success:true}); });
});

// ===== API: Import vacations from Excel / PDF =====
const parseAnyDate = str => {
    if (!str) return null;
    str = str.toString().trim();
    let m;
    // YYYY-MM-DD
    m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
        const dt = new Date(str);
        return (!isNaN(dt) && dt.getFullYear() >= 2020) ? str : null;
    }
    // DD/MM/YYYY  or  D.M.YYYY  or  D-M-YYYY
    m = str.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{4})$/);
    if (m) {
        const iso = `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
        const dt  = new Date(iso);
        return (!isNaN(dt) && dt.getFullYear() >= 2020) ? iso : null;
    }
    return null;
};

app.post('/api/vacations/import', importUpload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({error: 'לא הועלה קובץ'});
    const ext = path.extname(req.file.originalname).toLowerCase();
    const dates = new Set();

    try {
        if (['.xlsx', '.xls', '.csv'].includes(ext)) {
            if (!xlsxLib) return res.status(400).json({error: 'חבילת xlsx לא מותקנת'});
            const wb = xlsxLib.read(req.file.buffer, { type: 'buffer', cellDates: true, dateNF: 'YYYY-MM-DD' });
            wb.SheetNames.forEach(sName => {
                const rows = xlsxLib.utils.sheet_to_json(wb.Sheets[sName], { header:1, raw:false, dateNF:'YYYY-MM-DD' });
                rows.forEach(row => Array.isArray(row) && row.forEach(cell => {
                    const d = parseAnyDate(cell);
                    if (d) dates.add(d);
                }));
            });
        } else if (ext === '.pdf') {
            if (!pdfParse) return res.status(400).json({error: 'חבילת pdf-parse לא מותקנת'});
            const data = await pdfParse(req.file.buffer);
            const re   = /(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{4})|(\d{4})[\/\.\-](\d{2})[\/\.\-](\d{2})/g;
            let m;
            while ((m = re.exec(data.text)) !== null) {
                const iso = m[4]
                    ? `${m[4]}-${m[5]}-${m[6]}`
                    : `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
                const dt = new Date(iso);
                if (!isNaN(dt) && dt.getFullYear() >= 2020) dates.add(iso);
            }
        } else {
            return res.status(400).json({error: 'פורמט לא נתמך – xlsx / xls / csv / pdf'});
        }
        res.json({ dates: [...dates].sort().map(date => ({ date, label: '' })) });
    } catch(e) {
        res.status(500).json({ error: 'שגיאה: ' + e.message });
    }
});

// ===== API: Deep PDF vacation import (Hebrew + Gregorian) =====
const HEB_MONTH_NUMS = {
    'ניסן':1,'אייר':2,'סיון':3,'תמוז':4,'אב':5,'אלול':6,
    'תשרי':7,'חשון':8,'חשוון':8,'כסלו':9,'טבת':10,'שבט':11,
    'אדר':12,"אדר א'":12,'אדר א':12,"אדר ב'":13,'אדר ב':13,
};
const HEB_CHAR_VAL = {
    'א':1,'ב':2,'ג':3,'ד':4,'ה':5,'ו':6,'ז':7,'ח':8,'ט':9,
    'י':10,'כ':20,'ך':20,'ל':30,'מ':40,'ם':40,'נ':50,'ן':50,
    'ס':60,'ע':70,'פ':80,'ף':80,'צ':90,'ץ':90,
    'ק':100,'ר':200,'ש':300,'ת':400,
};
const GREG_MONTH_HE = {
    'ינואר':1,'פברואר':2,'מרץ':3,'מרס':3,'אפריל':4,'מאי':5,'יוני':6,
    'יולי':7,'אוגוסט':8,'ספטמבר':9,'אוקטובר':10,'נובמבר':11,'דצמבר':12,
};
const HEB_DAY_WORDS = {
    'א':1,'ב':2,'ג':3,'ד':4,'ה':5,'ו':6,'ז':7,'ח':8,'ט':9,
    'י':10,'יא':11,'יב':12,'יג':13,'יד':14,'טו':15,'טז':16,
    'יז':17,'יח':18,'יט':19,'כ':20,'כא':21,'כב':22,'כג':23,
    'כד':24,'כה':25,'כו':26,'כז':27,'כח':28,'כט':29,'ל':30,
};

const parseHebNum = s => {
    const clean = s.replace(/[׳״"'״׳\s]/g, '');
    // Try direct day lookup first
    if (HEB_DAY_WORDS[clean] !== undefined) return HEB_DAY_WORDS[clean];
    // Sum gematria values
    const sum = clean.split('').reduce((a, c) => a + (HEB_CHAR_VAL[c] || 0), 0);
    return sum > 0 ? sum : null;
};

const hebToGreg = (dayStr, monthHe, hyear) => {
    if (!hebcal) return null;
    try {
        const { HDate } = hebcal;
        const day = typeof dayStr === 'number' ? dayStr : (parseInt(dayStr) || parseHebNum(dayStr));
        const month = HEB_MONTH_NUMS[monthHe?.trim()];
        if (!day || !month || day < 1 || day > 30) return null;
        const hd  = new HDate(day, month, hyear);
        const g   = hd.greg();
        return g.toISOString().split('T')[0];
    } catch { return null; }
};

const guessHebYear = (month) => {
    // School year: Tishrei (7)–Elul (6)
    // Months 7-12 = first half of school year → current year
    // Months 1-6  = second half → next year usually
    if (!hebcal) return new Date().getFullYear() + 3760;
    const { HDate } = hebcal;
    const now = new HDate();
    const hy  = now.getFullYear();
    if (month >= 7) return hy;        // Tishrei and on → same Hebrew year
    if (now.getMonth() >= 7) return hy + 1; // We are past Tishrei → future months are next year
    return hy;
};

const isoAdd = (dateStr, days) => {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
};

const expandRange = (from, to) => {
    const list = [];
    let cur = from;
    let guard = 0;
    while (cur <= to && guard++ < 400) { list.push(cur); cur = isoAdd(cur, 1); }
    return list;
};

app.post('/api/import-vacations-pdf', importUpload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'לא הועלה קובץ' });
    if (!pdfParse) return res.status(500).json({ error: 'pdf-parse לא זמין' });

    try {
        const data  = await pdfParse(req.file.buffer);
        const raw   = data.text;
        const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

        const HEB_MONTHS_RE = Object.keys(HEB_MONTH_NUMS).join('|');
        const GREG_MON_RE   = Object.keys(GREG_MONTH_HE).join('|');

        // ─── Regex patterns ───────────────────────────────────────────────
        // Gregorian full:  1.9.2026 / 01/09/2026 / 2026-09-01
        const R_GREG_FULL  = /\b(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})\b|\b(\d{4})[.\-\/](\d{2})[.\-\/](\d{2})\b/g;
        // Gregorian short: 1.9 / 01/09 (no year)
        const R_GREG_SHORT = /\b(\d{1,2})[\/.](\d{1,2})\b/g;
        // Gregorian with month name: 1 בספטמבר / ספטמבר 1
        const R_GREG_MON   = new RegExp(`\\b(\\d{1,2})\\s*ב?(${GREG_MON_RE})(?:\\s*(\\d{4}))?\\b|(${GREG_MON_RE})\\s*(\\d{1,2})(?:\\s*(\\d{4}))?\\b`, 'g');
        // Hebrew date: ה' ניסן / כ"ה בכסלו / כה כסלו / 25 כסלו / ה בניסן
        const R_HEB        = new RegExp(`(\\d{1,2}|[\\u05D0-\\u05EA][\\u05F3\\u05F4"'״׳]?[\\u05D0-\\u05EA]*)\\s*ב?(${HEB_MONTHS_RE})(?:\\s*([\\u05D0-\\u05EA]{2,}[\\u05F3\\u05F4"'״׳]?[\\u05D0-\\u05EA]*))?`, 'g');
        const parseGregFull = (d, m, y) => {
            const year = parseInt(y) || new Date().getFullYear();
            const iso  = `${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            return !isNaN(new Date(iso)) ? iso : null;
        };

        const extractDatesFromText = (text) => {
            const found = [];
            let m;

            // Full Gregorian
            for (const mt of [...text.matchAll(new RegExp(R_GREG_FULL.source, 'g'))]) {
                const iso = mt[4]
                    ? `${mt[4]}-${mt[5]}-${mt[6]}`
                    : parseGregFull(mt[1], mt[2], mt[3]);
                if (iso && !isNaN(new Date(iso))) found.push({ date: iso, src: 'greg_full' });
            }

            // Gregorian with month name
            for (const mt of [...text.matchAll(new RegExp(R_GREG_MON.source, 'g'))]) {
                const day   = mt[1] || mt[5];
                const monHe = mt[2] || mt[4];
                const yr    = mt[3] || mt[6];
                const mon   = GREG_MONTH_HE[monHe];
                if (!mon) continue;
                const year = yr ? parseInt(yr) : (mon < 9 ? new Date().getFullYear() + 1 : new Date().getFullYear());
                const iso  = parseGregFull(parseInt(day), mon, year);
                if (iso) found.push({ date: iso, src: 'greg_mon' });
            }

            // Hebrew dates
            for (const mt of [...text.matchAll(new RegExp(R_HEB.source, 'g'))]) {
                const dayStr  = mt[1];
                const monStr  = mt[2];
                const yearStr = mt[3];
                const hmon    = HEB_MONTH_NUMS[monStr];
                if (!hmon) continue;
                let hyear;
                if (yearStr) {
                    const y = parseHebNum(yearStr);
                    hyear = y > 1000 ? y : (y > 0 ? y + 5000 : guessHebYear(hmon));
                } else {
                    hyear = guessHebYear(hmon);
                }
                const iso = hebToGreg(dayStr, monStr, hyear);
                if (iso) found.push({ date: iso, src: 'heb', hmon });
            }

            // Short Gregorian (last resort, only if nothing found yet)
            if (found.length === 0) {
                for (const mt of [...text.matchAll(new RegExp(R_GREG_SHORT.source, 'g'))]) {
                    const d = parseInt(mt[1]), m2 = parseInt(mt[2]);
                    if (d > 31 || m2 > 12) continue;
                    const year = m2 < 9 ? new Date().getFullYear() + 1 : new Date().getFullYear();
                    const iso  = parseGregFull(d, m2, year);
                    if (iso) found.push({ date: iso, src: 'greg_short' });
                }
            }

            return found.sort((a, b) => a.date.localeCompare(b.date));
        };

        const extractLabel = (text) => {
            // Remove all detected date patterns, return clean text
            return text
                .replace(new RegExp(R_GREG_FULL.source, 'g'), '')
                .replace(new RegExp(R_GREG_MON.source, 'g'), '')
                .replace(new RegExp(R_HEB.source, 'g'), '')
                .replace(new RegExp(R_GREG_SHORT.source, 'g'), '')
                .replace(/[-–—:,.()\[\]/\\]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 50);
        };

        const vacations = [];
        let prevLabel   = '';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.length < 2) continue;

            const dates = extractDatesFromText(line);
            if (dates.length === 0) {
                // This line might be a label for the next line
                const lbl = extractLabel(line);
                if (lbl.length > 1) prevLabel = lbl;
                continue;
            }

            let label = extractLabel(line);
            if (!label && prevLabel) label = prevLabel;
            if (!label) label = 'חופשה';
            prevLabel = '';

            // Check if line contains a range separator
            const hasSep = /[-–—]|עד/.test(line);
            if (hasSep && dates.length === 2) {
                const [from, to] = [dates[0].date, dates[dates.length - 1].date];
                if (from <= to) {
                    expandRange(from, to).forEach(d => vacations.push({ date: d, label }));
                    continue;
                }
            }

            // Single or multiple individual dates
            dates.forEach(({ date }) => vacations.push({ date, label }));
        }

        // Deduplicate by date (keep first label)
        const seen  = new Set();
        const uniq  = vacations.filter(v => { if (seen.has(v.date)) return false; seen.add(v.date); return true; });
        uniq.sort((a, b) => a.date.localeCompare(b.date));

        // Group consecutive dates with same label into ranges for display
        const grouped = [];
        for (let i = 0; i < uniq.length; ) {
            let j = i;
            while (j + 1 < uniq.length &&
                   uniq[j + 1].label === uniq[i].label &&
                   isoAdd(uniq[j].date, 1) === uniq[j + 1].date) j++;
            grouped.push({
                dateFrom: uniq[i].date,
                dateTo:   uniq[j].date,
                label:    uniq[i].label,
                days:     uniq.slice(i, j + 1).map(x => x.date),
            });
            i = j + 1;
        }

        res.json({ groups: grouped, total: uniq.length, pages: data.numpages });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// ===== API: Hebcal holidays =====
app.get('/api/holidays', (req, res) => {
    const year = req.query.year || new Date().getFullYear() + 1;
    const url  = `https://www.hebcal.com/hebcal?v=1&cfg=json&year=${year}&month=x&ss=on&mf=on&c=on&geo=il&i=on&d=on&s=on`;
    https.get(url, apiRes => {
        let data = '';
        apiRes.on('data', c => data += c);
        apiRes.on('end', () => {
            try {
                const json     = JSON.parse(data);
                const holidays = (json.items||[])
                    .filter(item => item.category === 'holiday' || item.category === 'roshchodesh')
                    .map(item => ({ date: item.date, label: item.hebrew || item.title, title: item.title }));
                res.json({ holidays });
            } catch { res.status(500).json({error:'שגיאה בקבלת חגים'}); }
        });
    }).on('error', () => res.status(500).json({error:'שגיאת חיבור ל-Hebcal'}));
});

// ===== API: settings =====
app.post('/api/settings', (req, res) => {
    const { key, value } = req.body;
    db.run(`INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)`, [key, value],
        err => { if(err) return res.status(500).json({error:err.message}); res.json({success:true}); });
});

const parseDShowDevices = (output) => {
    const devices = [];
    let inAudio = false;
    (output || '').split('\n').forEach(line => {
        if (/DirectShow audio devices/i.test(line)) inAudio = true;
        if (/DirectShow video devices/i.test(line)) inAudio = false;
        if (inAudio) { const m = line.match(/"([^"]+)"/); if (m && m[1]) devices.push(m[1]); }
    });
    return devices;
};

const psAudioDevices = (cb) => {
    exec('powershell -NoProfile -Command "Get-WmiObject Win32_SoundDevice | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress"',
        { timeout: 6000 }, (e, out) => {
        try {
            const parsed = JSON.parse(out || '[]');
            const list = Array.isArray(parsed) ? parsed : [parsed];
            cb(list.filter(Boolean));
        } catch { cb([]); }
    });
};

app.get('/api/audio-devices', (req, res) => {
    exec('ffmpeg -list_devices true -f dshow -i dummy 2>&1', { timeout: 8000 }, (error, stdout, stderr) => {
        const devices = parseDShowDevices(stderr || stdout);
        if (devices.length > 0) return res.json({ devices: ['default', ...devices] });
        // Fallback: PowerShell WMI
        psAudioDevices(list => res.json({ devices: ['default', ...list] }));
    });
});

// ===== API: playlists =====
app.get('/api/playlists', (req, res) => {
    db.all("SELECT * FROM playlists ORDER BY created_at DESC", (err, playlists) => {
        if (err) return res.status(500).json({error:err.message});
        const result  = [];
        let pending = playlists.length;
        if (!pending) return res.json({playlists:[]});
        playlists.forEach(pl => {
            db.all("SELECT * FROM playlist_songs WHERE playlist_id=? ORDER BY order_num", [pl.id], (e, songs) => {
                result.push({ ...pl, songs: songs||[] });
                if (--pending === 0) res.json({ playlists: result.sort((a,b) => b.id - a.id) });
            });
        });
    });
});

app.post('/api/playlists', (req, res) => {
    const { name, shuffle, repeat_mode } = req.body;
    if (!name) return res.status(400).json({error:'שם חסר'});
    db.run(`INSERT INTO playlists (name,shuffle,repeat_mode) VALUES (?,?,?)`,
        [name, shuffle?1:0, repeat_mode??1],
        function(err) { if(err) return res.status(500).json({error:err.message}); res.json({success:true,id:this.lastID}); });
});

app.put('/api/playlists/:id', (req, res) => {
    const { name, shuffle, repeat_mode, is_active } = req.body;
    db.run(`UPDATE playlists SET name=?,shuffle=?,repeat_mode=?,is_active=? WHERE id=?`,
        [name, shuffle?1:0, repeat_mode??1, is_active??1, req.params.id],
        err => { if(err) return res.status(500).json({error:err.message}); res.json({success:true}); });
});

app.delete('/api/playlists/:id', (req, res) => {
    db.run("DELETE FROM playlist_songs WHERE playlist_id=?", [req.params.id], () => {
        db.run("DELETE FROM playlists WHERE id=?", [req.params.id],
            err => { if(err) return res.status(500).json({error:err.message}); res.json({success:true}); });
    });
});

app.post('/api/playlists/:id/songs', audioUpload.single('file'), (req, res) => {
    const { name, local_path, audio_type } = req.body;
    const playlistId = req.params.id;
    let filePath;
    if (audio_type === 'local_path') {
        if (!local_path || !fs.existsSync(local_path)) return res.status(400).json({error:'הקובץ לא נמצא'});
        filePath = local_path;
    } else {
        if (!req.file) return res.status(400).json({error:'לא הועלה קובץ'});
        filePath = req.file.path;
    }
    db.get("SELECT COALESCE(MAX(order_num),0)+1 AS next FROM playlist_songs WHERE playlist_id=?", [playlistId], (e, r) => {
        db.run(`INSERT INTO playlist_songs (playlist_id,name,file_path,order_num) VALUES (?,?,?,?)`,
            [playlistId, name || path.basename(filePath), filePath, r?.next||1],
            function(err) { if(err) return res.status(500).json({error:err.message}); res.json({success:true,id:this.lastID}); });
    });
});

app.put('/api/playlists/:pid/songs/:sid', (req, res) => {
    const { name, start_time, duration } = req.body;
    db.run("UPDATE playlist_songs SET name=COALESCE(?,name), start_time=?, duration=? WHERE id=? AND playlist_id=?",
        [name||null, parseFloat(start_time)||0, parseInt(duration)||0, req.params.sid, req.params.pid],
        e => e ? res.status(500).json({error:e.message}) : res.json({success:true}));
});

app.post('/api/playlists/:pid/songs/:sid/play', (req, res) => {
    db.get("SELECT * FROM playlist_songs WHERE id=? AND playlist_id=?", [req.params.sid, req.params.pid], async (e, song) => {
        if (!song) return res.status(404).json({error:'שיר לא נמצא'});
        await killCurrent();
        playlistState.playing = false;
        res.json({success:true});
        await playFile(song.file_path, 80, song.duration||0, null, song.start_time||0);
    });
});

app.delete('/api/playlists/:pid/songs/:sid', (req, res) => {
    db.run("DELETE FROM playlist_songs WHERE id=? AND playlist_id=?", [req.params.sid, req.params.pid],
        err => { if(err) return res.status(500).json({error:err.message}); res.json({success:true}); });
});

// Move a song up or down within its playlist
app.post('/api/playlists/:pid/songs/:sid/move', (req, res) => {
    const { direction } = req.body; // 'up' | 'down'
    const pid = req.params.pid, sid = req.params.sid;
    db.all("SELECT id, order_num FROM playlist_songs WHERE playlist_id=? ORDER BY order_num ASC", [pid], (e, songs) => {
        if (e || !songs?.length) return res.status(500).json({ error: e?.message || 'ריק' });
        const idx = songs.findIndex(s => s.id == sid);
        if (idx < 0) return res.status(404).json({ error: 'לא נמצא' });
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= songs.length) return res.json({ success: true }); // already at edge
        const a = songs[idx], b = songs[swapIdx];
        db.run("UPDATE playlist_songs SET order_num=? WHERE id=?", [b.order_num, a.id], () =>
            db.run("UPDATE playlist_songs SET order_num=? WHERE id=?", [a.order_num, b.id], err2 =>
                err2 ? res.status(500).json({ error: err2.message }) : res.json({ success: true })
            )
        );
    });
});

// Import all audio files from a local folder into a playlist
app.post('/api/playlists/:id/import-folder', (req, res) => {
    const { folder_path } = req.body;
    if (!folder_path) return res.status(400).json({ error: 'נתיב תיקיה חסר' });
    if (!fs.existsSync(folder_path)) return res.status(400).json({ error: 'התיקיה לא נמצאה: ' + folder_path });
    const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.aac', '.flac', '.m4a'];
    try {
        const files = fs.readdirSync(folder_path)
            .filter(f => AUDIO_EXTS.includes(path.extname(f).toLowerCase()))
            .sort();
        if (!files.length) return res.status(400).json({ error: 'לא נמצאו קבצי שמע בתיקיה' });
        db.get("SELECT COALESCE(MAX(order_num),0) AS m FROM playlist_songs WHERE playlist_id=?", [req.params.id], (e, r) => {
            let ord = (r?.m || 0) + 1;
            const stmt = db.prepare(`INSERT INTO playlist_songs (playlist_id,name,file_path,order_num) VALUES (?,?,?,?)`);
            files.forEach(f => stmt.run(req.params.id, path.basename(f, path.extname(f)), path.join(folder_path, f), ord++));
            stmt.finalize(err2 => {
                if (err2) return res.status(500).json({ error: err2.message });
                res.json({ success: true, count: files.length });
            });
        });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/playlists/:id/play', (req, res) => {
    db.get("SELECT * FROM playlists WHERE id=?", [req.params.id], (err, pl) => {
        if (!pl) return res.status(404).json({error:'פלייליסט לא נמצא'});
        db.all("SELECT * FROM playlist_songs WHERE playlist_id=? ORDER BY order_num", [pl.id], async (e, songs) => {
            if (!songs?.length) return res.status(400).json({error:'הפלייליסט ריק'});
            await killCurrent();
            playlistState = { playing: true, playlistId: pl.id, songIndex: 0, songs, shuffle: !!pl.shuffle, repeat: pl.repeat_mode };
            res.json({success:true});
            playPlaylistSong();
        });
    });
});

app.post('/api/player/stop', async (req, res) => {
    clearPlaylistStop();
    playlistState.playing = false;
    await killCurrent();
    res.json({success:true});
});

app.post('/api/player/next', (req, res) => {
    if (!playlistState.playing) return res.status(400).json({error:'לא מנגן'});
    playlistState.songIndex++;
    killCurrent().then(() => playPlaylistSong());
    res.json({success:true});
});

app.get('/api/player/status', (req, res) => {
    const song = playlistState.songs[playlistState.songIndex];
    res.json({
        playing: playlistState.playing,
        process_active: currentProcess !== null,
        playlistId: playlistState.playlistId,
        songIndex: playlistState.songIndex,
        currentSong: song?.name || null,
        totalSongs: playlistState.songs.length
    });
});

// ===== API: emergency =====
app.get('/api/emergency', (req, res) => {
    db.all("SELECT * FROM emergency_files ORDER BY created_at DESC", (err, files) => {
        res.json({ files: files||[] });
    });
});

app.post('/api/emergency', audioUpload.single('file'), (req, res) => {
    const { label, local_path, audio_type } = req.body;
    let filePath;
    if (audio_type === 'local_path') {
        if (!local_path || !fs.existsSync(local_path)) return res.status(400).json({error:'הקובץ לא נמצא'});
        filePath = local_path;
    } else {
        if (!req.file) return res.status(400).json({error:'לא הועלה קובץ'});
        filePath = req.file.path;
    }
    db.run(`INSERT INTO emergency_files (label,file_path) VALUES (?,?)`,
        [label || 'חירום', filePath],
        function(err) { if(err) return res.status(500).json({error:err.message}); res.json({success:true,id:this.lastID}); });
});

app.delete('/api/emergency/log', (req, res) => {
    db.run("DELETE FROM emergency_log", () => res.json({ success: true }));
});
app.delete('/api/emergency/:id', (req, res) => {
    db.get("SELECT * FROM emergency_files WHERE id=?", [req.params.id], (err, f) => {
        if (!f) return res.status(404).json({error:'לא נמצא'});
        db.run("DELETE FROM emergency_files WHERE id=?", [req.params.id], () => {
            if (f.file_path?.startsWith('uploads')) fs.unlink(f.file_path, ()=>{});
            res.json({success:true});
        });
    });
});

let isEmergency = false;
app.post('/api/emergency/:id/play', (req, res) => {
    db.get("SELECT * FROM emergency_files WHERE id=?", [req.params.id], async (err, f) => {
        if (!f) return res.status(404).json({error:'לא נמצא'});
        const wasPlaying = playlistState.playing;
        playlistState.playing = false;
        await killCurrent();
        isEmergency = true;
        res.json({success:true});
        console.log(`[${new Date().toLocaleTimeString('he-IL')}] 🚨 חירום: ${f.label}`);
        logEmergency('manual', f.label, { file_id: f.id });
        const cmd  = `ffplay -nodisp -autoexit -volume 128 "${path.resolve(f.file_path)}"`;
        const proc = exec(cmd, () => {
            isEmergency = false;
            currentProcess = null;
            if (wasPlaying) playPlaylistSong();
        });
        currentProcess = proc;
    });
});

app.get('/api/emergency/status', (req, res) => res.json({ active: isEmergency }));
app.get('/api/emergency/log', (req, res) => {
    db.all("SELECT * FROM emergency_log ORDER BY fired_at DESC LIMIT 200", (err, rows) => {
        res.json({ log: rows||[] });
    });
});

// ===== API: scheduled plays =====
app.get('/api/scheduled-play', (req, res) => {
    db.all("SELECT * FROM scheduled_plays WHERE played=0 ORDER BY play_at ASC", (err, rows) => {
        res.json({ plays: rows || [] });
    });
});

app.post('/api/scheduled-play', audioUpload.single('file'), (req, res) => {
    const { label, play_at, audio_type, local_path } = req.body;
    let filePath;
    if (audio_type === 'local_path') {
        if (!local_path || !fs.existsSync(local_path)) return res.status(400).json({ error: 'הקובץ לא נמצא' });
        filePath = local_path;
    } else {
        if (!req.file) return res.status(400).json({ error: 'לא הועלה קובץ' });
        filePath = req.file.path;
    }
    const playAt = play_at || null;
    db.run(`INSERT INTO scheduled_plays (label, file_path, play_at) VALUES (?,?,?)`,
        [label || 'הודעה', filePath, playAt],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (!playAt) {
                console.log(`[${new Date().toLocaleTimeString('he-IL')}] 📢 הודעה מידית: ${label}`);
                playFile(filePath, 80, 0);
                db.run("UPDATE scheduled_plays SET played=1 WHERE id=?", [this.lastID]);
            }
            res.json({ success: true, id: this.lastID });
        });
});

app.delete('/api/scheduled-play/:id', (req, res) => {
    db.run("DELETE FROM scheduled_plays WHERE id=?", [req.params.id],
        err => { if (err) return res.status(500).json({ error: err.message }); res.json({ success: true }); });
});

// ===== API: announce =====
let isAnnouncing     = false;
let isLiveAnnouncing = false;
let liveAnnounceDevice = null;

// Rate limiter: max 5 PIN attempts per IP per minute
const pinAttempts = new Map();
const checkPinRateLimit = (ip) => {
    const now   = Date.now();
    const entry = pinAttempts.get(ip) || { count: 0, resetAt: now + 60000 };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60000; }
    entry.count++;
    pinAttempts.set(ip, entry);
    return entry.count <= 5;
};
// ניקוי ערכים ישנים מה-Map כל דקה
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of pinAttempts.entries())
        if (now > entry.resetAt + 300000) pinAttempts.delete(ip);
}, 60000);

app.get('/announce', (req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(path.resolve('./announce.html'));
});

app.post('/api/announce/check-pin', (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    if (!checkPinRateLimit(ip)) return res.status(429).json({error:'יותר מדי ניסיונות – נסה שוב בעוד דקה'});
    const { pin } = req.body;
    db.get("SELECT value FROM settings WHERE key='announce_pin'", (err, row) => {
        if (!row || row.value !== pin) return res.status(401).json({error:'PIN שגוי'});
        pinAttempts.delete(ip); // reset on success
        res.json({success:true});
    });
});

app.get('/api/announce/status', (req, res) => res.json({ active: isAnnouncing || isLiveAnnouncing }));

app.get('/api/input-devices', (req, res) => {
    exec('ffmpeg -list_devices true -f dshow -i dummy 2>&1', { timeout: 8000 }, (error, stdout, stderr) => {
        const devices = parseDShowDevices(stderr || stdout);
        if (devices.length > 0) return res.json({ devices });
        psAudioDevices(list => res.json({ devices: list }));
    });
});

app.post('/api/live-announce/start', async (req, res) => {
    const { device } = req.body;
    if (!device) return res.status(400).json({ error: 'לא נבחר התקן קלט' });
    if (isAnnouncing || isLiveAnnouncing) return res.status(409).json({ error: 'כריזה כבר פעילה' });
    await killCurrent();
    isLiveAnnouncing  = true;
    liveAnnounceDevice = device;
    res.json({ success: true });
    db.get("SELECT value FROM settings WHERE key='output_device'", (e1, devRow) => {
        db.get("SELECT value FROM settings WHERE key='master_volume'", (e2, volRow) => {
            const outDevice = devRow?.value || 'default';
            const vol       = volRow ? Math.round(parseInt(volRow.value) / 100 * 128) : 100;
            const env       = { ...process.env };
            if (outDevice !== 'default') env.SDL_AUDIODEVICE = outDevice;
            const cmd  = `ffplay -f dshow -i audio="${device}" -nodisp -volume ${vol}`;
            console.log(`[${new Date().toLocaleTimeString('he-IL')}] 🎙️ כריזה חיה מ: ${device}`);
            const proc = exec(cmd, { env }, () => {
                isLiveAnnouncing  = false;
                liveAnnounceDevice = null;
                if (currentProcess === proc) currentProcess = null;
            });
            currentProcess = proc;
        });
    });
});

app.post('/api/live-announce/stop', async (req, res) => {
    isLiveAnnouncing  = false;
    liveAnnounceDevice = null;
    await killCurrent();
    res.json({ success: true });
});

app.get('/api/live-announce/status', (req, res) => {
    res.json({ active: isLiveAnnouncing, device: liveAnnounceDevice });
});

app.get('/api/announce/info', (req, res) => {
    const ip = getLocalIP();
    res.json({
        url:           `http://${ip}:${PORT}/announce`,
        httpsUrl:      `https://${ip}:${PORT_HTTPS}/announce`,
        managementUrl: `http://${ip}:${PORT}`,
        tunnelUrl,
        tunnelStatus,
        ip,
    });
});

app.get('/api/announce/qr', async (req, res) => {
    const ip = getLocalIP();
    let url;
    if (req.query.type === 'management') {
        url = tunnelUrl || `http://${ip}:${PORT}`;
    } else {
        // Prefer tunnel (HTTPS everywhere), then local HTTPS for mic
        url = tunnelUrl ? `${tunnelUrl}/announce` : `https://${ip}:${PORT_HTTPS}/announce`;
    }
    try {
        const qr  = await QRCode.toDataURL(url, {width:300, margin:2, color:{dark:'#1e40af',light:'#ffffff'}});
        const buf = Buffer.from(qr.replace(/^data:image\/png;base64,/,''), 'base64');
        res.set('Content-Type','image/png'); res.send(buf);
    } catch { res.status(500).json({error:'שגיאה ביצירת QR'}); }
});

app.post('/api/announce', audioUpload.single('audio'), (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    if (!checkPinRateLimit(ip)) {
        if (req.file) fs.unlink(req.file.path, ()=>{});
        return res.status(429).json({error:'יותר מדי ניסיונות – נסה שוב בעוד דקה'});
    }
    const { pin } = req.body;
    db.get("SELECT value FROM settings WHERE key='announce_pin'", (err, row) => {
        if (!row || row.value !== pin) {
            if (req.file) fs.unlink(req.file.path, ()=>{});
            return res.status(401).json({error:'PIN שגוי'});
        }
        if (!req.file) return res.status(400).json({error:'אין קובץ'});
        pinAttempts.delete(ip); // reset on success
        if (isAnnouncing) { fs.unlink(req.file.path, ()=>{}); return res.status(409).json({error:'כריזה פעילה, נסה שוב'}); }
        isAnnouncing = true;
        res.json({success:true});
        db.get("SELECT value FROM settings WHERE key='master_volume'", (e, volRow) => {
            const vol = volRow ? Math.round(parseInt(volRow.value)/100*128) : 100;
            const cmd = `ffplay -nodisp -autoexit -volume ${vol} "${path.resolve(req.file.path)}"`;
            console.log(`[${new Date().toLocaleTimeString('he-IL')}] 📢 כריזה חיה`);
            exec(cmd, () => { isAnnouncing = false; fs.unlink(req.file.path, ()=>{}); });
        });
    });
});

app.post('/api/announce/pin', (req, res) => {
    const { pin } = req.body;
    if (!pin || pin.length < 4) return res.status(400).json({error:'PIN חייב להכיל לפחות 4 ספרות'});
    db.run(`INSERT OR REPLACE INTO settings (key,value) VALUES ('announce_pin',?)`, [pin],
        err => { if(err) return res.status(500).json({error:err.message}); res.json({success:true}); });
});

// ===== API: send test email with current tunnel URL =====
app.post('/api/settings/test-email', async (req, res) => {
    if (!tunnelUrl) return res.status(400).json({ error: 'המנהרה לא מחוברת כרגע' });
    try {
        await sendTunnelNotification(tunnelUrl);
        res.json({ success: true });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// ===== API: bell log =====
app.get('/api/log', (req, res) => {
    db.all("SELECT * FROM bell_log ORDER BY played_at DESC LIMIT 200", (err, rows) => {
        res.json({ log: rows || [] });
    });
});
app.delete('/api/log', (req, res) => {
    db.run("DELETE FROM bell_log", err => res.json({ success: !err }));
});

app.get('/api/log/export', (req, res) => {
    db.all("SELECT * FROM bell_log ORDER BY played_at DESC", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const header = 'תאריך ושעה,שם הצלצול,שעה\n';
        const csv = (rows || []).map(r =>
            `"${(r.played_at||'').replace('T',' ').slice(0,19)}","${(r.bell_label||'').replace(/"/g,'""')}","${r.time_str||''}"`
        ).join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="bell-log-${new Date().toISOString().slice(0,10)}.csv"`);
        res.send('﻿' + header + csv); // BOM for Excel Hebrew
    });
});

// ===== API: backup / restore =====
app.get('/api/backup', (req, res) => {
    const result = {};
    const tables = {
        bells:               "SELECT * FROM bells",
        playlists:           "SELECT * FROM playlists",
        playlist_songs:      "SELECT * FROM playlist_songs",
        vacations:           "SELECT * FROM vacations",
        day_overrides:       "SELECT * FROM day_overrides",
        schedule_templates:  "SELECT * FROM schedule_templates",
        settings:            "SELECT * FROM settings WHERE key NOT IN ('gmail_pass')",
    };
    let pending = Object.keys(tables).length;
    Object.entries(tables).forEach(([t, sql]) => {
        db.all(sql, (err, rows) => {
            result[t] = rows || [];
            if (--pending === 0) {
                result.version   = 2;
                result.exportedAt = new Date().toISOString();
                res.setHeader('Content-Disposition', `attachment; filename="tzalzuli-backup-${new Date().toISOString().slice(0,10)}.json"`);
                res.json(result);
            }
        });
    });
});

app.post('/api/restore', (req, res) => {
    const { bells, playlists, playlist_songs, vacations, settings, day_overrides } = req.body;
    if (!bells) return res.status(400).json({ error: 'קובץ גיבוי לא תקין' });
    db.serialize(() => {
        db.run("DELETE FROM bells");
        (bells || []).forEach(b => db.run(
            `INSERT INTO bells (id,label,time,days,audio_source,audio_type,volume,is_active,duration,bell_type,break_duration,playlist_id,repeat_count,output_device,start_time,playlist_start_delay,playlist_end_offset,playlist_volume) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [b.id,b.label,b.time,b.days,b.audio_source,b.audio_type,b.volume,b.is_active,b.duration,b.bell_type,b.break_duration,b.playlist_id,b.repeat_count||1,b.output_device||null,b.start_time||0,b.playlist_start_delay||0,b.playlist_end_offset||0,b.playlist_volume!=null?b.playlist_volume:null]
        ));
        db.run("DELETE FROM vacations");
        (vacations || []).forEach(v => db.run("INSERT OR IGNORE INTO vacations (date,label) VALUES (?,?)", [v.date,v.label]));
        db.run("DELETE FROM day_overrides");
        (day_overrides || []).forEach(d => db.run("INSERT OR IGNORE INTO day_overrides (date,from_day,label) VALUES (?,?,?)", [d.date,d.from_day,d.label]));
        (settings || []).forEach(s => {
            if (s.key !== 'gmail_pass') db.run("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)", [s.key,s.value]);
        });
        // Restore playlists + songs
        if (playlists?.length) {
            db.run("DELETE FROM playlist_songs");
            db.run("DELETE FROM playlists");
            (playlists || []).forEach(p => db.run(
                "INSERT INTO playlists (id,name,shuffle,repeat_mode,is_active) VALUES (?,?,?,?,?)",
                [p.id,p.name,p.shuffle,p.repeat_mode,p.is_active]
            ));
            (playlist_songs || []).forEach(s => db.run(
                "INSERT INTO playlist_songs (id,playlist_id,name,file_path,order_num) VALUES (?,?,?,?,?)",
                [s.id,s.playlist_id,s.name,s.file_path,s.order_num]
            ));
        }
        db.run("SELECT 1", () => res.json({ success: true }));
    });
});

// ===== API: day overrides =====
app.get('/api/day-overrides', (req, res) => {
    db.all("SELECT * FROM day_overrides ORDER BY date", (err, rows) => res.json({ overrides: rows || [] }));
});
app.post('/api/day-overrides', (req, res) => {
    const { date, from_day, label } = req.body;
    if (!date || from_day === undefined) return res.status(400).json({ error: 'חסרים פרטים' });
    db.run("INSERT OR REPLACE INTO day_overrides (date,from_day,label) VALUES (?,?,?)",
        [date, from_day, label||''],
        err => { if(err) return res.status(500).json({error:err.message}); res.json({success:true}); });
});
app.delete('/api/day-overrides/:date', (req, res) => {
    db.run("DELETE FROM day_overrides WHERE date=?", [req.params.date],
        err => { if(err) return res.status(500).json({error:err.message}); res.json({success:true}); });
});

// ===== API: import iCal vacations =====
app.post('/api/vacations/import-ical', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'חסר URL של יומן' });
    try {
        const body = await new Promise((resolve, reject) => {
            const lib = url.startsWith('https') ? https : http;
            const options = { headers: { 'User-Agent': 'Mozilla/5.0' } };
            lib.get(url, options, r => {
                let d = '';
                r.on('data', c => d += c);
                r.on('end', () => resolve(d));
                r.on('error', reject);
            }).on('error', reject);
        });
        const blocks = body.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
        const events = [];
        blocks.forEach(block => {
            const dtstart = block.match(/DTSTART(?:;[^:]*)?:(\d{8})/)?.[1];
            const dtend   = block.match(/DTEND(?:;[^:]*)?:(\d{8})/)?.[1];
            let   summary = block.match(/SUMMARY:(.+)/)?.[1]?.trim() || '';
            // Decode basic iCal escape sequences
            summary = summary.replace(/\\,/g,',').replace(/\\n/g,' ').replace(/\\;/g,';');
            if (!dtstart || !summary) return;
            const toDate = s => `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
            const startDate = new Date(toDate(dtstart));
            const endDate   = dtend ? new Date(toDate(dtend)) : startDate;
            for (let d = new Date(startDate); d < endDate; d.setDate(d.getDate()+1)) {
                events.push({ date: d.toISOString().split('T')[0], label: summary });
            }
        });
        if (!events.length) return res.status(422).json({ error: 'לא נמצאו אירועים ביומן' });
        const stmt = db.prepare("INSERT OR IGNORE INTO vacations (date,label) VALUES (?,?)");
        events.forEach(e => stmt.run(e.date, e.label));
        stmt.finalize(() => res.json({ success: true, count: events.length }));
    } catch(e) {
        res.status(500).json({ error: 'שגיאה בייבוא: ' + e.message });
    }
});

// ===== API: restart server =====
app.post('/api/restart', (req, res) => {
    res.json({ success: true });
    const workDir = __dirname.replace(/\//g, '\\');
    const bat = path.join(os.tmpdir(), 'tziltzuli-restart.bat');
    fs.writeFileSync(bat,
        `@echo off\r\ntimeout /t 2 /nobreak >nul\r\n` +
        `taskkill /f /im node.exe >nul 2>&1\r\ntimeout /t 1 /nobreak >nul\r\n` +
        `start /b "" node "${path.join(workDir,'server.js').replace(/\//g,'\\')}" \r\n` +
        `del "%~f0"\r\n`
    );
    exec(`start /b "" cmd /c "${bat}"`);
    setTimeout(() => process.exit(0), 300);
});

// ===== SPA fallback =====
if (fs.existsSync(publicDir)) {
    app.use((req, res, next) => {
        if (req.path.startsWith('/api') || req.path === '/announce' || req.path.startsWith('/uploads')) return next();
        res.sendFile(path.join(publicDir, 'index.html'));
    });
}

// ===== Global JSON error handler (must be last, Express 5 routes async errors here) =====
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message || err);
    res.status(err.status || 500).json({ error: err.message || 'שגיאת שרת' });
});

// ===== Start servers =====
(async () => {
    if (!fs.existsSync('./cert.pem') || !fs.existsSync('./key.pem')) {
        try {
            const pems = await selfsigned.generate(
                [{ name: 'commonName', value: 'school-bells' }],
                { days: 3650, keySize: 2048, algorithm: 'sha256' }
            );
            fs.writeFileSync('./key.pem',  pems.private);
            fs.writeFileSync('./cert.pem', pems.cert);
        } catch(e) { console.error('SSL:', e.message); }
    }

    app.listen(PORT, '0.0.0.0', () => {
        const ip = getLocalIP();
        console.log(`\n🔔 מערכת צלצולי פועלת!`);
        console.log(`📡 ניהול (WiFi):  http://${ip}:${PORT}`);
        console.log(`✅ מסד נתונים:    settings.db`);
        ensureSiren();
        db.get("SELECT value FROM settings WHERE key='pikud_enabled'", (e,r) => { if (r?.value==='1') setPikud(true); });
        startTunnel();
        setTimeout(checkAndUpdate, 15000);

        // בדיקת זמינות ffplay
        exec('ffplay -version', (err) => {
            if (err) {
                console.error('\n❌ ffplay לא נמצא! צלצולים לא יפעלו.');
                console.error('   הפתרון: winget install Gyan.FFmpeg  (ואז הפעל מחדש את השרת)\n');
            } else {
                console.log('✅ ffplay זמין');
            }
        });
    });

    if (fs.existsSync('./cert.pem') && fs.existsSync('./key.pem')) {
        https.createServer(
            { key: fs.readFileSync('./key.pem'), cert: fs.readFileSync('./cert.pem') },
            app
        ).listen(PORT_HTTPS, '0.0.0.0', () => {
            const ip = getLocalIP();
            console.log(`🔒 כריזה (HTTPS): https://${ip}:${PORT_HTTPS}/announce`);
        });
    }
})();
