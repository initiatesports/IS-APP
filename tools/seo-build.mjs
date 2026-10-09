#!/usr/bin/env node
/* 官網 SEO 靜態頁生成器（老闆 2026-10-09：Google SEO 差 → 每個課程／知識文章要有獨立網址＋真文字）
 *
 * 問題：官網 index.html 係單頁程式，HTML 本身零文字、全站得 1 個網址 → Google 只見到 1 頁空殼。
 * 做法：由 #11 CMS（同官網同一個公開 home route）讀課程＋知識文章 → 生成：
 *   courses/index.html、courses/<id>/index.html、knowledge/index.html、knowledge/<id>/index.html
 *   sitemap.xml（列晒所有頁）、index.html 入面 #app 嘅靜態文字（JS 一開即被官網程式覆蓋，Google／冇 JS 都讀到）
 * 輸出係 deterministic（冇時間戳）→ `--check` 可以比較磁碟同 CMS 係咪一致（CI／每日巡查用）。
 *
 * 用法：node tools/seo-build.mjs            生成／更新
 *       node tools/seo-build.mjs --check    只比較，有出入 exit 1（唔寫檔）
 *       node tools/seo-build.mjs --cms x.json  用本地 CMS JSON（測試）
 * 規則：唔放條款／私訓價錢（官網政策）；日期 DD/MM/YYYY；唔改官網其他內容。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://www.initiatesportshk.com';
const CMS_API = 'https://script.google.com/macros/s/AKfycbxzzac6FfgGka9220y26AqbCkN4AIMsFwCqB_G-X6tN0-5gzcBIQ60mAU4j-8npduEB/exec';
const WA = 'https://wa.me/85263317403';
const PHONE = '+852 6331 7403';
const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const cmsArg = args.includes('--cms') ? args[args.indexOf('--cms') + 1] : '';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const abs = p => (/^https?:/.test(p) ? p : SITE + '/' + String(p || '').replace(/^\/+/, ''));
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const plain = s => String(s || '').replace(/\[圖:[^\]]*\]/g, '').replace(/【([^】]+)】/g, '$1：').replace(/\s+/g, ' ').trim();
const dmy = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
const isoDate = iso => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(iso || '')); return m ? m[1] : ''; };

async function loadCms() {
  if (cmsArg) return JSON.parse(fs.readFileSync(cmsArg, 'utf8'));
  let last = '';
  for (let i = 0; i < 6; i++) {   // Apps Script 間中回 Google 錯誤頁 → 重試
    try {
      const r = await fetch(CMS_API + '?action=home&_=' + Date.now(), { redirect: 'follow' });
      const t = await r.text();
      if (t.trim().startsWith('{')) { const d = JSON.parse(t); if (Array.isArray(d.settings)) return d; }
      last = t.slice(0, 120);
    } catch (e) { last = String(e); }
    await new Promise(r => setTimeout(r, 4000 * (i + 1)));
  }
  throw new Error('讀唔到 CMS（' + last + '）— 唔寫任何檔，保留現有頁面');
}
function settingsMap(d) {
  const m = {};
  for (const r of d.settings || []) if (r && r.key !== undefined) { let v = r.value; if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* 原文 */ } } m[r.key] = v; }
  return m;
}

/* ── 共用版面（品牌：深藍 #0F1A28、青綠 #3ECFCF、金 #C9A15C；方角＋斜切 CTA） ── */
const CSS = `*{box-sizing:border-box}body{margin:0;background:#0F1A28;color:#fff;font-family:'Noto Sans HK',system-ui,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.8}
a{color:#3ECFCF;text-decoration:none}a:hover{color:#7FE3E3}
.wrap{max-width:860px;margin:0 auto;padding:0 20px}
header.top{border-bottom:1px solid rgba(255,255,255,.08)}header.top .wrap{display:flex;align-items:center;gap:12px;padding-top:14px;padding-bottom:14px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;color:#fff;font-weight:900;letter-spacing:.06em}.brand img{width:34px;height:34px;background:#fff;border-radius:8px;padding:3px}
nav.links{margin-left:auto;display:flex;gap:16px;font-size:14px;font-weight:700;flex-wrap:wrap}nav.links a{color:rgba(255,255,255,.75)}
.crumb{font-size:12.5px;color:rgba(255,255,255,.5);margin:22px 0 0}.crumb a{color:rgba(255,255,255,.6)}
.eyebrow{font-family:Archivo,'Noto Sans HK',sans-serif;font-weight:700;font-size:11px;letter-spacing:.32em;color:#C9A15C;text-transform:uppercase;margin-top:26px}
h1{font-family:Archivo,'Noto Sans HK',sans-serif;font-weight:900;font-size:clamp(28px,5vw,40px);line-height:1.3;margin:10px 0 0}
h2{font-size:20px;font-weight:900;margin:34px 0 0;line-height:1.5}h3{font-size:16px;font-weight:900;margin:24px 0 0}
p,li{font-size:15px;color:rgba(255,255,255,.78)}p{margin:12px 0 0}ul{margin:10px 0 0;padding-left:20px}li{margin:6px 0}
.lead{font-size:16px;color:rgba(255,255,255,.85)}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.chip{border:1px solid #3ECFCF;color:#3ECFCF;font-size:12px;font-weight:700;padding:3px 10px}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:20px}.fact{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);padding:12px 14px}.fact b{display:block;font-size:12px;color:#C9A15C;letter-spacing:.08em}
.cover{width:100%;height:auto;display:block;margin-top:22px;border:1px solid rgba(255,255,255,.1)}figure{margin:22px 0 0}figure img{width:100%;height:auto;display:block}figcaption{font-size:12.5px;color:rgba(255,255,255,.55);margin-top:6px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:20px}.card{display:block;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);padding:16px 18px;color:#fff}.card:hover{border-color:#3ECFCF;color:#fff}.card b{display:block;font-size:16px}.card span{display:block;font-size:13px;color:rgba(255,255,255,.65);margin-top:6px;line-height:1.7}
.cta{display:flex;flex-wrap:wrap;gap:12px;margin:34px 0 0}.btn{display:inline-block;transform:skewX(-6deg);background:#3ECFCF;color:#0F1A28;font-weight:900;padding:13px 26px;box-shadow:0 10px 28px rgba(62,207,207,.3)}.btn>span{display:inline-block;transform:skewX(6deg)}.btn.ghost{background:transparent;color:#fff;border:2px solid rgba(255,255,255,.3);box-shadow:none}
footer{margin-top:56px;border-top:1px solid rgba(255,255,255,.08);padding:22px 0 40px;font-size:13px;color:rgba(255,255,255,.55)}`;
const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+HK:wght@400;700;900&family=Archivo:wght@700;900&display=swap" rel="stylesheet">';
const ORG = { '@type': 'SportsActivityLocation', name: 'INITIATE SPORTS', url: SITE + '/', telephone: PHONE, areaServed: '青衣, 香港', address: { '@type': 'PostalAddress', addressLocality: 'Tsing Yi 青衣', addressRegion: 'Hong Kong 香港', addressCountry: 'HK' } };

function page({ urlPath, title, desc, image, crumbs, body, schema }) {
  const url = SITE + urlPath;
  const bc = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c[0], item: SITE + c[1] })) };
  const ld = [bc, ...(schema ? [schema] : [])].map(o => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('\n');
  return `<!DOCTYPE html>
<html lang="zh-HK">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="index,follow">
<link rel="canonical" href="${url}">
<link rel="icon" href="/favicon.ico" sizes="any"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#0F1A28">
<meta property="og:type" content="${schema && schema['@type'] === 'Article' ? 'article' : 'website'}">
<meta property="og:site_name" content="INITIATE SPORTS">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:locale" content="zh_HK">
<meta property="og:image" content="${esc(abs(image || 'img/courses/c1.jpg'))}">
<meta name="twitter:card" content="summary_large_image">
${ld}
${FONTS}
<style>${CSS}</style>
</head>
<body>
<header class="top"><div class="wrap"><a class="brand" href="/"><img src="/img/is-mark-512.png" alt="INITIATE SPORTS" width="34" height="34">INITIATE SPORTS</a>
<nav class="links"><a href="/">首頁</a><a href="/courses/">課程介紹</a><a href="/knowledge/">知識分享</a><a href="${WA}" target="_blank" rel="noopener">WhatsApp 查詢</a></nav></div></header>
<main class="wrap">
<div class="crumb">${crumbs.map((c, i) => i < crumbs.length - 1 ? `<a href="${c[1]}">${esc(c[0])}</a>` : esc(c[0])).join(' › ')}</div>
${body}
<div class="cta"><a class="btn" href="/is-trial.html"><span>預約試堂 →</span></a><a class="btn ghost" href="${WA}" target="_blank" rel="noopener"><span>WhatsApp ${PHONE.replace('+852 ', '')}</span></a></div>
</main>
<footer><div class="wrap">INITIATE SPORTS · 青衣兒童及青少年運動培訓 · AIM HIGH JUMP HIGH<br>香港青衣 · 電話／WhatsApp ${PHONE} · <a href="/">www.initiatesportshk.com</a></div></footer>
</body>
</html>
`;
}

/* ── 知識文章正文：同官網／article_tool 一樣嘅格式（【小標】、• ✅ 清單、[圖:img/knowledge/x|圖說]） ── */
const FIG_RE = /^\[圖:(img\/knowledge\/[\w.-]+\.(?:jpg|jpeg|png|webp))(?:\|([^\]]*))?\]$/;
function articleHtml(body) {
  return String(body || '').split(/\n\s*\n/).map(block => {
    const t = block.trim(); if (!t) return '';
    const fg = FIG_RE.exec(t);
    if (fg) return `<figure><img src="/${esc(fg[1])}" alt="${esc(fg[2] || '')}" loading="lazy">${fg[2] ? `<figcaption>${esc(fg[2])}</figcaption>` : ''}</figure>`;
    const out = []; let list = [];
    const flush = () => { if (list.length) { out.push('<ul>' + list.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>'); list = []; } };
    for (const raw of t.split('\n')) {
      const line = raw.trim(); if (!line) continue;
      const h = /^【([^】]+)】(.*)$/.exec(line);
      if (h) { flush(); out.push(`<h2>${esc(h[1])}</h2>`); if (h[2].trim()) out.push(`<p>${esc(h[2].trim())}</p>`); continue; }
      const li = /^(?:[•✅▪︎・\-]|\d+[.、）)])\s*(.*)$/.exec(line);
      if (li && /^[•✅▪︎・-]/.test(line)) { list.push(li[1] || line); continue; }
      flush(); out.push(`<p>${esc(line)}</p>`);
    }
    flush(); return out.join('\n');
  }).join('\n');
}

function build(m) {
  const courses = Array.isArray(m.course_items) ? m.course_items.filter(c => c && c.name) : [];
  const detail = m.course_detail && typeof m.course_detail === 'object' ? m.course_detail : {};
  const did = m.course_did && typeof m.course_did === 'object' ? m.course_did : {};
  const posts = Array.isArray(m.knowledge_posts) ? m.knowledge_posts.filter(p => p && p.id && p.title && p.body) : [];
  if (courses.length < 3 || !posts.length) throw new Error(`CMS 內容唔齊（課程 ${courses.length}、文章 ${posts.length}）— 唔寫任何檔`);
  const files = {};
  const slugOf = c => String(did[c.name] || '').replace(/[^\w-]/g, '') || null;
  const cs = courses.map(c => ({ c, slug: slugOf(c), d: detail[did[c.name]] || null })).filter(x => x.slug);

  // 課程頁
  for (const { c, slug, d } of cs) {
    const sections = (d && Array.isArray(d.sections) ? d.sections : []).map(s =>
      `<h2>${esc(s.h || '')}</h2>${s.p ? `<p>${esc(s.p)}</p>` : ''}${Array.isArray(s.list) && s.list.length ? '<ul>' + s.list.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>' : ''}`).join('\n');
    const full = String(c.full || '').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean).map(b => {
      const lines = b.split('\n').map(x => x.trim()).filter(Boolean);
      const items = lines.filter(x => /^[•✅]/.test(x)); const head = lines.filter(x => !/^[•✅]/.test(x));
      return head.map(x => `<p>${esc(x)}</p>`).join('') + (items.length ? '<ul>' + items.map(x => `<li>${esc(x.replace(/^[•✅]\s*/, ''))}</li>`).join('') + '</ul>' : '');
    }).join('\n');
    const facts = [['適合年齡', c.age], ['課堂長度', c.dur], ['類別', c.cat], ['重點', c.tag]].filter(x => x[1]).map(x => `<div class="fact"><b>${esc(x[0])}</b>${esc(x[1])}</div>`).join('');
    const desc = clip(`${c.name}｜INITIATE SPORTS 青衣${c.age ? '（' + c.age + '）' : ''}：${(d && d.summary) || c.sum || ''}`, 155);
    files[`courses/${slug}/index.html`] = page({
      urlPath: `/courses/${slug}/`, title: `${c.name}｜青衣兒童運動班｜INITIATE SPORTS`, desc, image: c.img || '',
      crumbs: [['首頁', '/'], ['課程介紹', '/courses/'], [c.name, `/courses/${slug}/`]],
      schema: { '@context': 'https://schema.org', '@type': 'Course', name: c.name, description: clip((d && d.summary) || c.sum || c.full, 300), url: `${SITE}/courses/${slug}/`, inLanguage: 'zh-HK', provider: ORG },
      body: `<div class="eyebrow">COURSES · ${esc(c.cat || '')}</div><h1>${esc(c.name)}</h1>
<p class="lead">${esc((d && d.summary) || c.sum || '')}</p>
${Array.isArray(c.chips) && c.chips.length ? '<div class="chips">' + c.chips.map(x => `<span class="chip">${esc(x)}</span>`).join('') + '</div>' : ''}
<div class="facts">${facts}</div>
${full}
${sections}
<p style="margin-top:28px"><a href="/?view=courses">在官網查看全部課程及最新班別 →</a></p>`
    });
  }
  // 課程總覽
  files['courses/index.html'] = page({
    urlPath: '/courses/', title: '課程介紹｜青衣兒童運動班・興趣班｜INITIATE SPORTS',
    desc: clip('INITIATE SPORTS 青衣兒童運動課程：' + cs.map(x => x.c.name).join('、') + '。小班教學、數據化評估。', 155),
    crumbs: [['首頁', '/'], ['課程介紹', '/courses/']],
    schema: { '@context': 'https://schema.org', '@type': 'ItemList', itemListElement: cs.map((x, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/courses/${x.slug}/`, name: x.c.name })) },
    body: `<div class="eyebrow">COURSES</div><h1>課程介紹</h1><p class="lead">INITIATE SPORTS 紮根青衣，為幼兒、小學生、青少年及成人開辦小班制運動課程。以運動科學為本，重視基本動作、體能發展同運動興趣。</p>
<div class="cards">${cs.map(x => `<a class="card" href="/courses/${x.slug}/"><b>${esc(x.c.name)}</b><span>${esc([x.c.age, x.c.dur].filter(Boolean).join(' · '))}<br>${esc(clip(x.c.sum, 70))}</span></a>`).join('')}</div>`
  });

  // 知識文章
  const sortedPosts = posts.slice();
  for (const p of sortedPosts) {
    const id = String(p.id).replace(/[^\w-]/g, '');
    const date = isoDate(p.date);
    files[`knowledge/${id}/index.html`] = page({
      urlPath: `/knowledge/${id}/`, title: `${p.title}｜知識分享｜INITIATE SPORTS`, desc: clip(p.summary || plain(p.body), 155), image: p.image || '',
      crumbs: [['首頁', '/'], ['知識分享', '/knowledge/'], [clip(p.title, 30), `/knowledge/${id}/`]],
      schema: Object.assign({ '@context': 'https://schema.org', '@type': 'Article', headline: clip(p.title, 110), description: clip(p.summary || plain(p.body), 300), image: abs(p.image || 'img/courses/c1.jpg'), inLanguage: 'zh-HK', mainEntityOfPage: `${SITE}/knowledge/${id}/`, author: { '@type': 'Organization', name: 'INITIATE SPORTS 教練團隊', url: SITE + '/' }, publisher: { '@type': 'Organization', name: 'INITIATE SPORTS', logo: { '@type': 'ImageObject', url: SITE + '/img/is-mark-512.png' } } }, date ? { datePublished: date } : {}),
      body: `<div class="eyebrow">KNOWLEDGE 101 · ${esc(p.tag || '')}</div><h1>${esc(p.title)}</h1>${date ? `<p style="font-size:13px;color:rgba(255,255,255,.5)">${dmy(date)} · INITIATE SPORTS 教練團隊</p>` : ''}
${p.image ? `<img class="cover" src="/${esc(String(p.image).replace(/^\/+/, ''))}" alt="${esc(p.title)}">` : ''}
${p.summary ? `<p class="lead">${esc(p.summary)}</p>` : ''}
${articleHtml(p.body)}
<p style="margin-top:28px"><a href="/knowledge/">← 更多知識分享文章</a></p>`
    });
  }
  files['knowledge/index.html'] = page({
    urlPath: '/knowledge/', title: '知識分享｜運動科學・營養・訓練心法｜INITIATE SPORTS',
    desc: '由 INITIATE SPORTS 教練團隊整理嘅運動科學、營養飲食同訓練心法文章，陪家長了解孩子嘅成長需要。',
    crumbs: [['首頁', '/'], ['知識分享', '/knowledge/']],
    body: `<div class="eyebrow">KNOWLEDGE 101</div><h1>知識分享</h1><p class="lead">運動科學・營養飲食・訓練心法 —— 由教練團隊整理，陪伴家長一同了解孩子的成長需要。</p>
<div class="cards">${sortedPosts.map(p => `<a class="card" href="/knowledge/${String(p.id).replace(/[^\w-]/g, '')}/"><b>${esc(p.title)}</b><span>${esc(clip(p.summary || plain(p.body), 80))}</span></a>`).join('')}</div>`
  });

  // sitemap
  const urls = ['/', '/courses/', ...cs.map(x => `/courses/${x.slug}/`), '/knowledge/', ...sortedPosts.map(p => `/knowledge/${String(p.id).replace(/[^\w-]/g, '')}/`)];
  const lm = {}; for (const p of sortedPosts) if (isoDate(p.date)) lm[`/knowledge/${String(p.id).replace(/[^\w-]/g, '')}/`] = isoDate(p.date);
  files['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${SITE}${u}</loc>${lm[u] ? `\n    <lastmod>${lm[u]}</lastmod>` : ''}
    <changefreq>${u === '/' ? 'weekly' : 'monthly'}</changefreq>
    <priority>${u === '/' ? '1.0' : (u.split('/').length > 3 ? '0.7' : '0.8')}</priority>
  </url>`).join('\n')}
</urlset>
`;

  // 首頁 #app 靜態文字（官網 JS render() 一開就覆蓋；畀 Google／未載入 JS 時讀）
  const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const block = `<!--SEO:STATIC:START--><div style="max-width:860px;margin:0 auto;padding:40px 20px;font-family:'Noto Sans HK',sans-serif;color:#fff">
<h1 style="font-size:30px;font-weight:900;line-height:1.4;margin:0">INITIATE SPORTS 青衣兒童運動班・興趣班・暑期班</h1>
<p style="color:rgba(255,255,255,.75);line-height:1.9">INITIATE SPORTS 是紮根香港青衣的兒童及青少年運動教學團隊，開辦花式跳繩、田徑、體操、羽毛球、匹克球及多項目體適能小班課程，並設私人訓練及運動治療。以運動科學為本，重視基本動作、體能發展與運動興趣，提供數據化能力評估及章別考核。</p>
<h2 style="font-size:20px;font-weight:900;margin-top:26px">課程介紹</h2>
<ul>${cs.map(x => `<li><a href="/courses/${x.slug}/">${esc(x.c.name)}</a>${x.c.age ? '（' + esc(x.c.age) + '）' : ''}</li>`).join('')}</ul>
<h2 style="font-size:20px;font-weight:900;margin-top:26px">知識分享</h2>
<ul>${sortedPosts.map(p => `<li><a href="/knowledge/${String(p.id).replace(/[^\w-]/g, '')}/">${esc(p.title)}</a></li>`).join('')}</ul>
<p style="color:rgba(255,255,255,.75)">查詢及報名：WhatsApp <a href="${WA}">${PHONE}</a>　·　<a href="/is-trial.html">預約試堂</a></p>
</div><!--SEO:STATIC:END-->`;
  let nidx;
  if (idx.includes('<!--SEO:STATIC:START-->')) nidx = idx.replace(/<!--SEO:STATIC:START-->[\s\S]*?<!--SEO:STATIC:END-->/, () => block);
  else if (idx.includes('<div id="app"></div>')) nidx = idx.replace('<div id="app"></div>', () => `<div id="app">${block}</div>`);
  else throw new Error('index.html 搵唔到 <div id="app"> 插入點');
  files['index.html'] = nidx;
  return files;
}

const cms = await loadCms();
const files = build(settingsMap(cms));
let diff = [];
for (const [rel, content] of Object.entries(files)) {
  const p = path.join(ROOT, rel);
  const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  if (cur !== content) { diff.push(rel); if (!CHECK) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); } }
}
// 舊頁清理：CMS 已刪嘅課程／文章 → 刪返對應資料夾（只限 courses/ knowledge/ 下面由本工具生成嘅頁）
for (const dir of ['courses', 'knowledge']) {
  const base = path.join(ROOT, dir); if (!fs.existsSync(base)) continue;
  for (const sub of fs.readdirSync(base)) {
    const rel = `${dir}/${sub}/index.html`;
    if (fs.statSync(path.join(base, sub)).isDirectory() && !files[rel]) { diff.push('（刪）' + rel); if (!CHECK) fs.rmSync(path.join(base, sub), { recursive: true }); }
  }
}
if (CHECK) {
  if (diff.length) { console.log('❌ 官網 SEO 靜態頁同 CMS 唔一致，請跑 node tools/seo-build.mjs：\n  ' + diff.join('\n  ')); process.exit(1); }
  console.log(`✅ 官網 SEO 靜態頁同 CMS 一致（${Object.keys(files).length} 個檔）`);
} else console.log(diff.length ? `✓ 已更新 ${diff.length} 個檔：\n  ${diff.join('\n  ')}` : '✓ 冇變動');
