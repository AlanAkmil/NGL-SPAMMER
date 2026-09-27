const axios = require('axios');

const NGL_API = 'https://ngl.link/api/submit';

// UUID v4 generator yang valid
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

async function sendOne(username, message, index) {
    const deviceId = uuidv4();
    try {
        const res = await axios.post(NGL_API, 
            new URLSearchParams({
                username,
                question: message,
                deviceId,
                gameSlug: 'confessions',
                referrer: ''
            }).toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
                    'Origin': 'https://ngl.link',
                    'Referer': `https://ngl.link/${username}`,
                    'Accept': 'application/json, text/plain, */*',
                    'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8'
                },
                timeout: 15000,
                validateStatus: () => true
            }
        );
        return { ok: res.status === 200 || res.status === 201, status: res.status };
    } catch (e) {
        return { ok: false, status: 0, error: e.message };
    }
}

// Concurrent worker dengan delay adaptif
async function worker(queue, username, message, results, onProgress) {
    while (queue.length > 0) {
        const i = queue.shift();
        if (!i) break;

        const result = await sendOne(username, message, i);
        results.push({ i, ...result });
        onProgress(i, result);

        // Delay adaptif: makin banyak request, makin kecil delay
        // Tapi tetap ada jitter agar tidak predictable
        const baseDelay = 150 + Math.random() * 250;
        await new Promise(r => setTimeout(r, baseDelay));
    }
}

module.exports = async (req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method !== 'POST') return res.status(405).send('Method not allowed');

    const { username, message, count = 100 } = req.body;
    if (!username || !message) return res.status(400).send('Username dan message wajib diisi');

    const total = Math.min(Math.max(parseInt(count) || 100, 1), 1000);
    const CONCURRENCY = 10; // 10 request paralel
    const queue = Array.from({ length: total }, (_, i) => i + 1);
    const results = [];
    let success = 0;
    let failed = 0;

    // Function untuk streaming progress
    const onProgress = (i, r) => {
        if (r.ok) {
            success++;
            res.write(JSON.stringify({ type: 'success', i, status: r.status }) + '\n');
        } else {
            failed++;
            res.write(JSON.stringify({ type: 'error', i, msg: r.error || `HTTP ${r.status}` }) + '\n');
        }
    };

    // Jalankan 10 worker paralel
    const workers = Array(CONCURRENCY).fill(null).map(() =>
        worker(queue, username, message, results, onProgress)
    );

    await Promise.all(workers);

    res.write(JSON.stringify({ type: 'done', success, failed, total }) + '\n');
    res.end();
};