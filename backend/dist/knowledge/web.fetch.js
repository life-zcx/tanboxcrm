"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.approvedHosts = void 0;
exports.approvedUrl = approvedUrl;
exports.downloadWeb = downloadWeb;
exports.extractHtml = extractHtml;
exports.captureWeb = captureWeb;
exports.extractAdiletApi = extractAdiletApi;
exports.extractWebData = extractWebData;
const node_https_1 = __importDefault(require("node:https"));
const promises_1 = __importDefault(require("node:dns/promises"));
const node_tls_1 = __importDefault(require("node:tls"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const cheerio = __importStar(require("cheerio"));
const pdf_parse_1 = require("pdf-parse");
const mammoth_1 = __importDefault(require("mammoth"));
const archive_service_1 = require("./archive.service");
const web_ocr_1 = require("./web.ocr");
exports.approvedHosts = ['tanba.telecom.kz', 'www.ismet.kz', 'ismet.kz', 'b2b.telecom.kz', 'adilet.zan.kz', 'old.adilet.zan.kz', 'www.adilet.zan.kz', 'zan.gov.kz', 'law.gov.kz', 'www.gov.kz', 'www.kgd.gov.kz', 'kgd.gov.kz', 'portal.kgd.gov.kz', 'eec.eaeunion.org', 'docs.eaeunion.org', 'regulation.eaeunion.org', 'www.gs1.kz', 'gs1.kz', 'pki.gov.kz'];
function approvedUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !exports.approvedHosts.includes(url.hostname))
        throw new Error('SOURCE_URL_NOT_ALLOWED:' + url.hostname);
    url.hash = '';
    return url.toString();
}
function privateAddress(address) {
    if (address.includes(':'))
        return address === '::1' || address === '::' || /^(?:f[cd]|fe[89ab])/i.test(address) || address.toLowerCase().startsWith('::ffff:');
    const n = address.split('.').map(Number);
    return n[0] === 0 || n[0] === 10 || n[0] === 127 || n[0] === 169 && n[1] === 254 || n[0] === 172 && n[1] >= 16 && n[1] <= 31 || n[0] === 192 && n[1] === 168 || n[0] >= 224;
}
async function downloadWeb(value) {
    let url = approvedUrl(value);
    for (let redirect = 0; redirect < 5; redirect++) {
        const host = new URL(url).hostname, addresses = await promises_1.default.lookup(host, { all: true });
        if (!addresses.length || addresses.some(a => privateAddress(a.address)))
            throw new Error('SOURCE_DNS_NOT_PUBLIC');
        const pemPath = node_path_1.default.resolve(__dirname, '../../data/knowledge-ca.pem');
        const ca = (host === 'zan.gov.kz' || host === 'law.gov.kz') && node_fs_1.default.existsSync(pemPath) ? [...node_tls_1.default.rootCertificates, node_fs_1.default.readFileSync(pemPath, 'utf8')] : undefined;
        const response = await new Promise((resolve, reject) => {
            const request = node_https_1.default.get(url, { ca, rejectUnauthorized: true, headers: { 'User-Agent': 'TANBOX-Knowledge/1.0 (public documentation research)', 'Accept': 'text/html,application/pdf,application/json,application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Accept-Encoding': 'identity' } }, res => {
                const status = res.statusCode || 0;
                if (status >= 300 && status < 400 && res.headers.location) {
                    res.resume();
                    resolve({ status, data: Buffer.alloc(0), type: '', location: res.headers.location });
                    return;
                }
                if (Number(res.headers['content-length'] || 0) > 25 * 1024 * 1024) {
                    res.destroy();
                    reject(new Error('SOURCE_TOO_LARGE'));
                    return;
                }
                const chunks = [];
                let length = 0;
                res.on('data', chunk => { length += chunk.length; if (length > 25 * 1024 * 1024) {
                    res.destroy(new Error('SOURCE_TOO_LARGE'));
                    return;
                } chunks.push(chunk); });
                res.on('error', reject);
                res.on('end', () => resolve({ status, data: Buffer.concat(chunks), type: String(res.headers['content-type'] || 'application/octet-stream') }));
            });
            const deadline = setTimeout(() => request.destroy(new Error('SOURCE_TIMEOUT')), 20000);
            request.on('close', () => clearTimeout(deadline));
            request.on('error', reject);
        });
        if (response.location) {
            url = approvedUrl(new URL(response.location, url).toString());
            continue;
        }
        return { url, status: response.status, data: response.data, contentType: response.type };
    }
    throw new Error('SOURCE_REDIRECT_LIMIT');
}
function extractHtml(data, url) {
    const doc = cheerio.loadBuffer(data, { encoding: { defaultEncoding: 'utf-8' } }), links = [];
    doc('a[href]').each((_i, a) => { try {
        let href = doc(a).attr('href');
        if (href.startsWith('http://'))
            href = href.replace('http://', 'https://');
        const absolute = new URL(href, url).toString();
        links.push({ url: absolute, title: doc(a).text().trim() });
    }
    catch { } });
    const title = doc('h1').filter((_i, a) => doc(a).text().trim().length > 8).first().text().trim() || doc('title').text().trim();
    const published = doc('meta[property="article:published_time"],meta[name="date"]').first().attr('content') || undefined;
    doc('script,style,noscript,nav,header,footer,form,iframe,.cookie,.cookies').remove();
    doc('td,th').append('\t');
    doc('p,div,section,h1,h2,h3,h4,li,tr,br').append('\n');
    let root = doc('article').first();
    if (!root.length)
        root = doc('main,#main').first();
    if (!root.length)
        root = doc('body');
    // Government news pages have a dedicated text container; avoid sidebar news.
    if (new URL(url).hostname === 'www.gov.kz') {
        const body = doc('.news-detail-layout__content,.news-detail__content,.article-content,.article-body').first();
        if (body.length)
            root = body;
    }
    const text = root.text().replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const shell = text.length < 300 || /Для работы с поиском и текстами актов включите JavaScript/.test(text) || (/Файлы для скачивания/.test(text) && text.length < 500);
    const sourceUrl = new URL(url);
    const badPage = sourceUrl.hostname === 'tanba.telecom.kz' && sourceUrl.pathname === '/ru/business/product/supplements';
    const conflictingBadCopy = badPage && ((/1 февраля 2026 года/i.test(text) && /1 сентября 2026 года/i.test(text)) || /не моторное масло|на каждую канистру/i.test(text));
    return { text, title, quality: conflictingBadCopy ? 'NEEDS_REVIEW' : shell ? 'NEEDS_BROWSER' : 'FULLTEXT', metadata: { links, published, ...(conflictingBadCopy ? { note: 'На странице БАД противоречивые даты и фрагменты про другую товарную группу; требуется сверка с НПА.' } : {}) } };
}
async function captureWeb(url) {
    const capture = await extractWebData(url, await downloadWeb(url));
    const source = new URL(url);
    const ngr = source.hostname === 'adilet.zan.kz' && source.pathname.match(/^\/rus\/docs\/([A-Za-z0-9_]+)$/)?.[1];
    if (capture.quality !== 'NEEDS_BROWSER' || !ngr)
        return capture;
    try {
        const apiUrl = 'https://adilet.zan.kz/api/documents/by-ngr/' + ngr + '?language=rus';
        return extractAdiletApi(url, await downloadWeb(apiUrl)) || capture;
    }
    catch {
        return capture;
    }
}
function extractAdiletApi(url, downloaded) {
    const source = new URL(url);
    const ngr = source.hostname === 'adilet.zan.kz' && source.pathname.match(/^\/rus\/docs\/([A-Za-z0-9_]+)$/)?.[1];
    if (!ngr || downloaded.status !== 200 || !downloaded.contentType.includes('json'))
        return null;
    let document;
    try {
        document = JSON.parse(downloaded.data.toString('utf8')).document;
    }
    catch {
        return null;
    }
    if (document?.group_number !== ngr || document?.language !== 'rus' || document?.is_stub !== false || document?.has_content !== true || document?.is_actual !== true || typeof document?.text_content !== 'string')
        return null;
    const parsed = extractHtml(Buffer.from(document.text_content, 'utf8'), url);
    if (parsed.quality !== 'FULLTEXT' || parsed.text.length < 300)
        return null;
    return { url, finalUrl: downloaded.url, status: downloaded.status, data: downloaded.data, contentType: downloaded.contentType, sha256: (0, archive_service_1.sha256)(downloaded.data), text: parsed.text, title: document.title_ru || document.official_name || ngr, quality: 'FULLTEXT', metadata: { links: parsed.metadata.links, published: document.publication_date || undefined, note: 'Полный текст получен через официальный API Әділет; исходный JSON сохранён.' } };
}
async function extractWebData(url, downloaded) {
    const base = { url, finalUrl: downloaded.url, status: downloaded.status, data: downloaded.data, contentType: downloaded.contentType, sha256: (0, archive_service_1.sha256)(downloaded.data) };
    if (downloaded.status !== 200)
        return { ...base, text: '', title: 'HTTP ' + downloaded.status, quality: 'HTTP_ERROR', metadata: { links: [] } };
    const data = downloaded.data;
    if (data.subarray(0, 5).toString() === '%PDF-') {
        const parser = new pdf_parse_1.PDFParse({ data });
        const timer = setTimeout(() => void parser.destroy(), 30000);
        try {
            const parsed = await parser.getText(), missing = parsed.pages.filter(p => p.text.replace(/\s/g, '').length < 40).map(p => p.num);
            if (missing.length) {
                const text = await (0, web_ocr_1.ocrPdf)(data, parsed.pages, missing);
                return { ...base, text: text || parsed.text, title: 'PDF', quality: text ? 'OCR_UNREVIEWED' : 'NEEDS_OCR', metadata: { pages: parsed.total, links: [], note: text ? 'Текст распознан OCR; даты, коды и таблицы требуют проверки.' : 'Есть страницы без извлечённого текста: ' + missing.join(', ') + '. Требуется OCR.' } };
            }
            return { ...base, text: parsed.text, title: new URL(url).pathname.split('/').pop() || 'PDF', quality: 'FULLTEXT', metadata: { pages: parsed.total, links: [] } };
        }
        catch {
            return { ...base, text: '', title: 'PDF', quality: 'NEEDS_OCR', metadata: { links: [], note: 'Не удалось извлечь весь текст; нужен просмотр или OCR.' } };
        }
        finally {
            clearTimeout(timer);
            await parser.destroy().catch(() => { });
        }
    }
    if (data.subarray(0, 2).toString() === 'PK' && (/docx/i.test(url) || /wordprocessingml/.test(downloaded.contentType))) {
        try {
            const parsed = await mammoth_1.default.extractRawText({ buffer: data });
            return { ...base, text: parsed.value, title: 'DOCX', quality: parsed.value.trim().length > 100 ? 'FULLTEXT' : 'NEEDS_REVIEW', metadata: { links: [], note: parsed.messages.map(m => m.message).join('; ') } };
        }
        catch {
            return { ...base, text: '', title: 'DOCX', quality: 'PARSE_ERROR', metadata: { links: [] } };
        }
    }
    if (/html/i.test(downloaded.contentType) || data.subarray(0, 100).toString().includes('<html')) {
        const parsed = extractHtml(data, downloaded.url);
        if (/\.(?:pdf|docx)(?:[?#]|$)/i.test(url))
            parsed.quality = 'UNEXPECTED_CONTENT';
        return { ...base, ...parsed };
    }
    return { ...base, text: '', title: 'Вложение', quality: 'BINARY_STORED', metadata: { links: [] } };
}
