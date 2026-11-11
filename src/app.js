'use strict';
// ---------- Instalación como app (PWA) ----------
// Registra el service worker solo si la página se sirve por http(s) (GitHub Pages o
// Iniciar.bat/servidor.ps1 en localhost); bajo file:// los navegadores no permiten
// service workers, así que ahí simplemente no se instala como app — la herramienta
// sigue funcionando igual abriendo index.html directamente.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ---------- Librerías (se cargan solo cuando se necesitan) ----------
const LIBS = {
  pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  mammoth: 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js',
  turndown: 'https://cdn.jsdelivr.net/npm/turndown@7.2.0/dist/turndown.js',
  xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  pdflib: 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  qrcode: 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js',
};
const loaded = {};
function need(...names) {
  return Promise.all(names.map((n) => loaded[n] || (loaded[n] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = LIBS[n];
    s.onload = () => {
      if (n === 'pdfjs') pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfjs.replace('pdf.min.js', 'pdf.worker.min.js');
      res();
    };
    s.onerror = () => { delete loaded[n]; rej(new Error('No se pudo cargar la librería ' + n + ' (¿sin internet la primera vez?)')); };
    document.head.appendChild(s);
  }))));
}

// ---------- Tipos de archivo (extensiones del notebook original + algunas más) ----------
const KINDS = {
  audio: ['m4a', 'mp3', 'wav', 'flac', 'aac', 'ogg', 'opus', 'wma'],
  video: ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm'],
  pdf: ['pdf'],
  image: ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'gif'],
  docx: ['docx'], pptx: ['pptx'], xlsx: ['xlsx', 'xls'], csv: ['csv'],
  text: ['txt', 'md', 'json', 'xml'], html: ['html', 'htm'],
};
const KIND_LABEL = { audio: 'Audio', video: 'Video', pdf: 'PDF', image: 'Imagen', docx: 'Word', pptx: 'PowerPoint', xlsx: 'Excel', csv: 'CSV', text: 'Texto', html: 'HTML', other: 'Otro' };
const OUT_DIR = { md: 'MarkitDown', ocr: 'OCR', audio: 'Transcripciones' };
const SKIP_DIRS = new Set(Object.values(OUT_DIR));
const MODE_HELP = {
  auto: 'Detecta el tipo de cada archivo: documentos → Markdown (con OCR si el PDF es escaneado), audios y videos → transcripción.',
  md: 'Convierte PDF, Word, PowerPoint, Excel, CSV, HTML, texto e imágenes a Markdown (equivalente a MarkItDown).',
  ocr: 'Reconoce el texto de PDF escaneados o imágenes y genera un PDF con texto buscable y/o un .txt.',
  audio: 'Transcribe audios y videos (m4a, mp3, wav, mp4, …) sin importar la duración, en fragmentos de 30 s.',
};
const ext = (name) => (name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
const base = (name) => name.replace(/\.[^.]+$/, '');
function kindOf(name) {
  const e = ext(name);
  for (const k in KINDS) if (KINDS[k].includes(e)) return k;
  return 'other';
}
function actionFor(kind, mode) {
  if (mode === 'auto') return kind === 'audio' || kind === 'video' ? 'audio' : kind === 'other' ? null : 'md';
  if (mode === 'md') return ['pdf', 'image', 'docx', 'pptx', 'xlsx', 'csv', 'text', 'html'].includes(kind) ? 'md' : null;
  if (mode === 'ocr') return kind === 'pdf' || kind === 'image' ? 'ocr' : null;
  if (mode === 'audio') return kind === 'audio' || kind === 'video' ? 'audio' : null;
  return null;
}

// ---------- Estado y utilidades de interfaz ----------
const $ = (s) => document.querySelector(s);
const state = { mode: 'auto', items: [], running: false, cancel: false, seq: 0 };
const CANCEL = new Error('cancelado');
const checkCancel = () => { if (state.cancel) throw CANCEL; };
const fmtSize = (b) => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
const fmtTime = (s) => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(x).padStart(2, '0'); };
const textBlob = (t, type) => new Blob([t], { type: (type || 'text/plain') + ';charset=utf-8' });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function log(msg) {
  const el = $('#log');
  el.textContent += msg + '\n';
  el.scrollTop = el.scrollHeight;
}
function setStatus(msg, frac) {
  $('#status').textContent = msg;
  if (frac != null) $('#barFill').style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', t.dataset.mode === mode));
  $('#proc').classList.toggle('hidden', mode === 'qr');
  $('#qr').classList.toggle('hidden', mode !== 'qr');
  resizeBg();
  if (mode === 'qr') { drawQr(); return; }
  $('#modeHelp').textContent = MODE_HELP[mode];
  document.querySelectorAll('[data-modes]').forEach((el) => el.classList.toggle('hidden', !el.dataset.modes.split(' ').includes(mode)));
  renderList();
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => !state.running && setMode(t.dataset.mode)));

function renderList() {
  const tb = $('#list');
  tb.innerHTML = '';
  let n = 0;
  for (const it of state.items) {
    const act = actionFor(it.kind, state.mode);
    if (act) n++;
    const tr = document.createElement('tr');
    tr.id = 'row' + it.id;
    tr.innerHTML = `<td class="name">${esc(it.rel ? it.rel + '/' : '')}<b>${esc(it.file.name)}</b></td>
      <td class="hide-sm">${KIND_LABEL[it.kind]}</td><td class="hide-sm">${fmtSize(it.file.size)}</td>
      <td class="st"></td><td class="links"></td>`;
    tb.appendChild(tr);
    updateRow(it);
  }
  $('#count').textContent = state.items.length ? `(${n} para procesar de ${state.items.length})` : '';
  $('#btnRun').disabled = state.running || n === 0;
  $('#btnZip').disabled = state.running || !state.items.some((i) => i.outputs.length);
  $('#destFolder').disabled = !state.items.some((i) => i.root);
}
function updateRow(it) {
  const tr = document.getElementById('row' + it.id);
  if (!tr) return;
  const act = actionFor(it.kind, state.mode);
  const st = tr.querySelector('.st');
  if (it.status === 'done') st.innerHTML = '<span class="st-done">✅ Listo</span>';
  else if (it.status === 'error') st.innerHTML = `<span class="st-error" title="${esc(it.error)}">❌ ${esc(it.error.slice(0, 80))}</span>`;
  else if (it.status === 'working') st.innerHTML = `<span class="st-working">⏳ ${esc(it.progress || 'Procesando…')}</span>`;
  else st.innerHTML = act ? '<span class="muted">Pendiente</span>' : '<span class="st-skip">— no aplica en este modo</span>';
  const links = tr.querySelector('.links');
  links.innerHTML = '';
  it.outputs.forEach((o, i) => {
    const isText = /\.(md|txt)$/.test(o.name);
    links.insertAdjacentHTML('beforeend', `${isText ? `<a data-act="view" data-i="${i}">ver ${ext(o.name)}</a>` : ''}<a data-act="dl" data-i="${i}">⬇ ${esc(o.name)}</a>`);
  });
  links.onclick = async (e) => {
    const a = e.target.closest('a'); if (!a) return;
    const o = it.outputs[+a.dataset.i];
    if (a.dataset.act === 'dl') downloadBlob(o.blob, o.name);
    else renderPreview(o.name, await o.blob.text(), o.segs);
  };
}
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ---------- Carga de archivos y carpetas ----------
function addFile(file, rel, root) {
  if (state.items.some((i) => i.file.name === file.name && i.rel === rel && i.file.size === file.size)) return;
  state.items.push({ id: ++state.seq, file, rel, root, kind: kindOf(file.name), status: 'pending', outputs: [] });
}
async function scanHandle(root, dir, rel, recursive) {
  for await (const [name, h] of dir.entries()) {
    if (h.kind === 'file') {
      if (!name.startsWith('~$') && !name.startsWith('.')) addFile(await h.getFile(), rel, root);
    } else if (recursive && !SKIP_DIRS.has(name)) {
      await scanHandle(root, h, rel ? rel + '/' + name : name, recursive);
    }
  }
}
async function addDirHandle(dir) {
  const before = state.items.length;
  setStatus('Leyendo carpeta «' + dir.name + '»…');
  await scanHandle(dir, dir, '', $('#optRecursive').checked);
  log(`📁 Carpeta «${dir.name}»: ${state.items.length - before} archivo(s) encontrados`);
  setStatus(`Carpeta «${dir.name}» cargada.`);
  renderList();
}

$('#btnFolder').onclick = async () => {
  if (window.showDirectoryPicker) {
    try { await addDirHandle(await window.showDirectoryPicker({ mode: 'readwrite' })); }
    catch (e) { if (e.name !== 'AbortError') { log('⚠️ ' + e.message + ' — usando selector alternativo'); $('#inDir').click(); } }
  } else $('#inDir').click();
};
$('#btnFiles').onclick = () => $('#inFiles').click();
$('#inFiles').onchange = (e) => { [...e.target.files].forEach((f) => addFile(f, '', null)); e.target.value = ''; renderList(); };
$('#inDir').onchange = (e) => {
  const rec = $('#optRecursive').checked;
  for (const f of e.target.files) {
    const parts = (f.webkitRelativePath || f.name).split('/').slice(1, -1);
    if (parts.some((p) => SKIP_DIRS.has(p)) || (!rec && parts.length)) continue;
    addFile(f, parts.join('/'), null);
  }
  log(`📁 Carpeta cargada (solo lectura: los resultados se descargan desde esta página)`);
  e.target.value = '';
  renderList();
};
$('#btnClear').onclick = () => { if (!state.running) { state.items = []; renderList(); setStatus('Lista vacía.', 0); } };

const drop = $('#drop');
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = async (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const items = [...e.dataTransfer.items].filter((i) => i.kind === 'file');
  if (items.length && items[0].getAsFileSystemHandle) {
    const handles = await Promise.all(items.map((i) => i.getAsFileSystemHandle()));
    for (const h of handles) {
      if (!h) continue;
      if (h.kind === 'directory') await addDirHandle(h);
      else addFile(await h.getFile(), '', null);
    }
  } else [...e.dataTransfer.files].forEach((f) => addFile(f, '', null));
  renderList();
};

// ---------- PDF ----------
async function openPdf(file) {
  await need('pdfjs');
  return pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
}
async function pageText(page) {
  const tc = await page.getTextContent();
  let s = '';
  for (const it of tc.items) { if (!('str' in it)) continue; s += it.str; if (it.hasEOL) s += '\n'; }
  return s;
}
async function renderPage(page, scale) {
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return c;
}
const toJpeg = (c) => new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
const tidy = (t) => t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// ---------- OCR (Tesseract, local) ----------
let ocrWorker = null, ocrLang = '', ocrProgress = null;
async function getOcr(lang) {
  await need('tesseract');
  if (ocrWorker && ocrLang === lang) return ocrWorker;
  if (ocrWorker) await ocrWorker.terminate();
  log(`🔤 Preparando OCR (${lang})… la primera vez descarga los datos del idioma`);
  ocrWorker = await Tesseract.createWorker(lang, 1, {
    logger: (m) => { if (m.status === 'recognizing text' && ocrProgress) ocrProgress(m.progress); },
  });
  ocrLang = lang;
  return ocrWorker;
}
async function ocrImage(src, lang, wantPdf) {
  const w = await getOcr(lang);
  const { data } = await w.recognize(src, { pdfTitle: 'OCR' }, { text: true, pdf: !!wantPdf });
  return data;
}

// ---------- Conversores a Markdown (equivalente a MarkItDown) ----------
function mdTable(rows) {
  rows = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  if (!rows.length) return '_(hoja vacía)_';
  const w = Math.max(...rows.map((r) => r.length));
  const norm = (r) => Array.from({ length: w }, (_, i) => String(r[i] ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' '));
  const [h, ...b] = rows;
  return ['| ' + norm(h).join(' | ') + ' |', '| ' + Array(w).fill('---').join(' | ') + ' |', ...b.map((r) => '| ' + norm(r).join(' | ') + ' |')].join('\n');
}
let turndown = null;
async function htmlToMd(html) {
  await need('turndown');
  turndown = turndown || new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  return turndown.turndown(html);
}

const toMarkdown = {
  async pdf(it, o, prog) {
    const pdf = await openPdf(it.file);
    const parts = [`# ${base(it.file.name)}\n`];
    let ocrPages = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      checkCancel();
      prog(`Página ${n}/${pdf.numPages}`, (n - 1) / pdf.numPages);
      const page = await pdf.getPage(n);
      let text = await pageText(page);
      if (text.replace(/\s/g, '').length < 20 && o.ocrFallback) {
        prog(`OCR página ${n}/${pdf.numPages}`, (n - 1) / pdf.numPages);
        const c = await renderPage(page, o.scale);
        text = (await ocrImage(c, o.ocrLang)).text;
        c.width = c.height = 0;
        ocrPages++;
      }
      parts.push(`## Página ${n}\n\n${tidy(text)}\n`);
      page.cleanup();
    }
    await pdf.destroy();
    if (ocrPages) log(`   🔍 OCR aplicado a ${ocrPages} página(s) escaneada(s)`);
    return parts.join('\n');
  },
  async image(it, o, prog) {
    prog('OCR de la imagen', 0);
    const data = await ocrImage(it.file, o.ocrLang);
    return `# ${base(it.file.name)}\n\n${tidy(data.text)}\n`;
  },
  async docx(it) {
    await need('mammoth');
    const r = await mammoth.convertToHtml({ arrayBuffer: await it.file.arrayBuffer() });
    return htmlToMd(r.value);
  },
  async pptx(it) {
    await need('jszip');
    const zip = await JSZip.loadAsync(await it.file.arrayBuffer());
    const num = (s) => +s.match(/(\d+)\.xml$/)[1];
    const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
    const out = [`# ${base(it.file.name)}\n`];
    for (const s of slides) {
      const doc = new DOMParser().parseFromString(await zip.file(s).async('string'), 'application/xml');
      const paras = [...doc.getElementsByTagName('a:p')].map((p) => [...p.getElementsByTagName('a:t')].map((t) => t.textContent).join('')).filter((t) => t.trim());
      out.push(`## Diapositiva ${num(s)}\n`);
      if (paras.length) { out.push(`### ${paras[0]}\n`); paras.slice(1).forEach((p) => out.push(p)); }
      out.push('');
      const notes = zip.file(`ppt/notesSlides/notesSlide${num(s)}.xml`);
      if (notes) {
        const nd = new DOMParser().parseFromString(await notes.async('string'), 'application/xml');
        const nt = [...nd.getElementsByTagName('a:t')].map((t) => t.textContent).join(' ').trim();
        if (nt && !/^\d+$/.test(nt)) out.push(`> Notas: ${nt}\n`);
      }
    }
    return out.join('\n');
  },
  async xlsx(it) {
    await need('xlsx');
    const wb = XLSX.read(await it.file.arrayBuffer(), { type: 'array' });
    return wb.SheetNames.map((n) => `## ${n}\n\n${mdTable(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', blankrows: false, raw: false }))}\n`).join('\n');
  },
  async csv(it) {
    await need('xlsx');
    const wb = XLSX.read(await it.file.text(), { type: 'string', raw: true });
    return mdTable(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }));
  },
  async text(it) { return await it.file.text(); },
  async html(it) { return htmlToMd(await it.file.text()); },
};

// ---------- Acciones ----------
const run = {
  async md(it, o, prog) {
    const md = await toMarkdown[it.kind](it, o, prog);
    return [{ name: base(it.file.name) + '.md', blob: textBlob(md, 'text/markdown') }];
  },

  async ocr(it, o, prog) {
    const b = base(it.file.name);
    const texts = [], pdfPages = [];
    if (!o.ocrPdf && !o.ocrTxt && !o.ocrMd) throw new Error('Elige al menos un formato de salida');
    if (o.ocrPdf) await need('pdflib');
    if (it.kind === 'image') {
      prog('OCR de la imagen', 0);
      const d = await ocrImage(it.file, o.ocrLang, o.ocrPdf);
      texts.push(d.text);
      if (o.ocrPdf) pdfPages.push({ bytes: d.pdf });
    } else {
      const pdf = await openPdf(it.file);
      for (let n = 1; n <= pdf.numPages; n++) {
        checkCancel();
        const frac0 = (n - 1) / pdf.numPages;
        ocrProgress = (p) => prog(`OCR página ${n}/${pdf.numPages} · ${Math.round(p * 100)} %`, frac0 + p / pdf.numPages);
        prog(`OCR página ${n}/${pdf.numPages}`, frac0);
        const page = await pdf.getPage(n);
        const vp1 = page.getViewport({ scale: 1 });
        const c = await renderPage(page, o.scale);
        const d = await ocrImage(o.ocrPdf ? await toJpeg(c) : c, o.ocrLang, o.ocrPdf);
        c.width = c.height = 0;
        texts.push(d.text);
        if (o.ocrPdf) pdfPages.push({ bytes: d.pdf, w: vp1.width, h: vp1.height });
        page.cleanup();
      }
      ocrProgress = null;
      await pdf.destroy();
    }
    const outs = [];
    if (o.ocrPdf) {
      prog('Armando PDF buscable…', 0.99);
      const out = await PDFLib.PDFDocument.create();
      for (const p of pdfPages) {
        const src = await PDFLib.PDFDocument.load(new Uint8Array(p.bytes));
        const [pg] = await out.copyPages(src, [0]);
        if (p.w) { const f = p.w / pg.getWidth(); pg.scale(f, f); }
        out.addPage(pg);
      }
      outs.push({ name: b + '_OCR.pdf', blob: new Blob([await out.save()], { type: 'application/pdf' }) });
    }
    const multi = texts.length > 1;
    if (o.ocrTxt) outs.push({ name: b + '.txt', blob: textBlob(texts.map((t, i) => (multi ? `--- Página ${i + 1} ---\n` : '') + tidy(t)).join('\n\n')) });
    if (o.ocrMd) outs.push({ name: b + '.md', blob: textBlob(`# ${b}\n\n` + texts.map((t, i) => (multi ? `## Página ${i + 1}\n\n` : '') + tidy(t)).join('\n\n'), 'text/markdown') });
    return outs;
  },

  async audio(it, o, prog) {
    if (!o.audioMd && !o.audioTxt) throw new Error('Elige al menos un formato de salida');
    prog('Decodificando audio…', 0);
    const pcm = await decodeAudio(it.file);
    const dur = pcm.length / 16000;
    log(`   Duración del audio: ${dur.toFixed(2)} segundos (${(dur / 60).toFixed(2)} minutos)`);
    await asr.load(o.model, o.device, prog);
    const CH = 30 * 16000;
    const n = Math.ceil(pcm.length / CH);
    log(`   El archivo se ha dividido en ${n} fragmentos de 30 s.`);
    const segs = [];
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      checkCancel();
      const eta = i ? ` · faltan ~${fmtTime((performance.now() - t0) / 1000 / i * (n - i))}` : '';
      prog(`Fragmento ${i + 1}/${n}${eta}`, i / n);
      const chunk = pcm.slice(i * CH, (i + 1) * CH);
      if (rms(chunk) < 0.003) continue; // silencio: Whisper tiende a inventar texto
      let text;
      try { text = (await asr.run(chunk, o.language)).trim(); }
      catch (e) {
        log(`   ⚠️ Error en el fragmento ${i + 1}: ${e.message}`);
        try {
          // El motor pudo haberse caído (memoria insuficiente tras muchos fragmentos):
          // recargar el modelo y reintentar este fragmento una vez antes de darlo por perdido.
          await asr.load(o.model, o.device, prog);
          text = (await asr.run(chunk, o.language)).trim();
        } catch (e2) {
          log(`   ⚠️ Fragmento ${i + 1} no se pudo recuperar tras recargar el modelo: ${e2.message}`);
          text = '[Error en transcripción]';
        }
      }
      if (text) segs.push({ t: i * 30, text });
      showLive(it, segs);
    }
    const b = base(it.file.name);
    const outs = [];
    if (o.audioMd) {
      const md = [`# Transcripción: ${b}`, '', `- **Archivo:** ${it.file.name}`, `- **Duración:** ${fmtTime(dur)}`,
        `- **Modelo:** ${o.model.split('/')[1]}`, `- **Fecha:** ${new Date().toLocaleString('es')}`, '', '---', '',
        ...segs.map((s) => `**[${fmtTime(s.t)}]** ${s.text}\n`)].join('\n');
      outs.push({ name: b + '.md', blob: textBlob(md, 'text/markdown'), segs });
    }
    if (o.audioTxt) outs.push({ name: b + '.txt', blob: textBlob(segs.map((s) => s.text).join(' ')), segs });
    log(`   Longitud de la transcripción: ${segs.reduce((a, s) => a + s.text.length + 1, 0)} caracteres`);
    return outs;
  },
};

function showLive(it, segs) {
  renderPreview(it.file.name + ' (en curso)', '', segs);
}

// ---------- Vista previa con fondo que reacciona al scroll (solo transcripciones) ----------
// Cada fragmento de la transcripción es un "capítulo": al desplazarse por el texto, el
// fragmento visible activa una forma de fondo propia (posición de scroll → estado), en vez
// de una animación continua. Respeta prefers-reduced-motion desactivando la transición.
function renderPreview(name, text, segs) {
  $('#previewName').textContent = '· ' + name;
  const p = $('#preview');
  p.classList.remove('muted');
  if (previewObserver) { previewObserver.disconnect(); previewObserver = null; }
  activeSeg = -1;
  if (segs && segs.length) {
    p.innerHTML = segs.map((s, i) => `<div class="pv-seg" data-i="${i}">[${fmtTime(s.t)}] ${esc(s.text)}</div>`).join('');
    observeSegments(p, segs.length);
  } else {
    p.textContent = text;
    setBg(null);
  }
  resizeBg();
  p.scrollTop = p.scrollHeight;
}
let previewObserver = null;
let activeSeg = -1;
function observeSegments(container, count) {
  const ratios = new Array(count).fill(0);
  previewObserver = new IntersectionObserver((entries) => {
    for (const e of entries) ratios[+e.target.dataset.i] = e.intersectionRatio;
    let best = 0, bestVal = -1;
    ratios.forEach((v, i) => { if (v > bestVal) { bestVal = v; best = i; } });
    if (bestVal <= 0 || best === activeSeg) return;
    activeSeg = best;
    container.querySelectorAll('.pv-seg').forEach((el) => el.classList.toggle('in-view', +el.dataset.i === best));
    setBg(blobParams(best));
  }, { root: container, threshold: [0, .25, .5, .75, 1] });
  container.querySelectorAll('.pv-seg').forEach((el) => previewObserver.observe(el));
}

const bgCanvas = $('#previewBg');
const bgCtx = bgCanvas && bgCanvas.getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let bgW = 0, bgH = 0, bgCurrent = null, bgAnimFrame = null;
function resizeBg() {
  if (!bgCanvas) return;
  const rect = bgCanvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  bgW = rect.width; bgH = rect.height;
  bgCanvas.width = Math.max(1, Math.round(bgW * dpr));
  bgCanvas.height = Math.max(1, Math.round(bgH * dpr));
  bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (bgCurrent) paintBg(bgCurrent); else bgCtx.clearRect(0, 0, bgW, bgH);
}
window.addEventListener('resize', resizeBg);
function seededRand(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function blobParams(i) {
  const rnd = seededRand(i * 97 + 13);
  const n = 6 + Math.floor(rnd() * 3);
  return { pts: Array.from({ length: n }, () => .6 + rnd() * .4), rot: rnd() * Math.PI * 2, scale: .7 + rnd() * .3 };
}
function lerpBlob(a, b, t) {
  const n = Math.max(a.pts.length, b.pts.length);
  return {
    pts: Array.from({ length: n }, (_, i) => a.pts[i % a.pts.length] + (b.pts[i % b.pts.length] - a.pts[i % a.pts.length]) * t),
    rot: a.rot + (b.rot - a.rot) * t,
    scale: a.scale + (b.scale - a.scale) * t,
  };
}
function paintBg(p) {
  if (!bgCtx) return;
  bgCtx.clearRect(0, 0, bgW, bgH);
  const cx = bgW / 2, cy = bgH / 2, R = Math.min(bgW, bgH) * .45 * p.scale;
  bgCtx.save();
  bgCtx.translate(cx, cy);
  bgCtx.rotate(p.rot);
  bgCtx.beginPath();
  const n = p.pts.length;
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI * 2, r = R * p.pts[k % n];
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (k === 0) bgCtx.moveTo(x, y); else bgCtx.lineTo(x, y);
  }
  bgCtx.closePath();
  bgCtx.fillStyle = (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#0f766e').trim();
  bgCtx.globalAlpha = .16;
  bgCtx.fill();
  bgCtx.restore();
}
function setBg(target) {
  if (bgAnimFrame) { cancelAnimationFrame(bgAnimFrame); bgAnimFrame = null; }
  if (!target || reducedMotion || !bgCurrent) { bgCurrent = target; if (target) paintBg(target); else bgCtx && bgCtx.clearRect(0, 0, bgW, bgH); return; }
  const from = bgCurrent, t0 = performance.now(), dur = 450;
  const step = (now) => {
    const t = Math.min(1, (now - t0) / dur), eased = 1 - (1 - t) ** 3;
    bgCurrent = lerpBlob(from, target, eased);
    paintBg(bgCurrent);
    bgAnimFrame = t < 1 ? requestAnimationFrame(step) : null;
  };
  bgAnimFrame = requestAnimationFrame(step);
}
function rms(a) { let s = 0; for (let i = 0; i < a.length; i += 4) s += a[i] * a[i]; return Math.sqrt(s / (a.length / 4)); }
async function decodeAudio(file) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  try {
    const ab = await ctx.decodeAudioData(await file.arrayBuffer());
    if (ab.numberOfChannels === 1) return ab.getChannelData(0);
    const out = new Float32Array(ab.length);
    for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < d.length; i++) out[i] += d[i] / ab.numberOfChannels; }
    return out;
  } catch (e) {
    throw new Error('El navegador no pudo leer este formato de audio/video. Prueba con mp3, m4a, wav o mp4.');
  } finally { ctx.close(); }
}

// ---------- Cliente del worker de transcripción ----------
const asr = {
  worker: null, key: '', pending: new Map(), seq: 0, onProgress: null, files: {},
  ensure() {
    if (this.worker) return;
    const src = document.getElementById('asrWorkerSrc').textContent;
    this.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), { type: 'module' });
    this.worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'dl') {
        const p = m.p;
        if (p.status === 'progress' && p.total > 1e6) {
          this.files[p.file] = p;
          const all = Object.values(this.files);
          const loadedB = all.reduce((a, f) => a + f.loaded, 0), totalB = all.reduce((a, f) => a + f.total, 0);
          this.onProgress && this.onProgress(`Descargando modelo (solo la primera vez) · ${fmtSize(loadedB)} de ${fmtSize(totalB)}`, loadedB / totalB);
        }
        return;
      }
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      m.type === 'error' ? p.rej(new Error(m.error)) : p.res(m.text);
    };
    this.worker.onerror = (e) => {
      const err = new Error('Fallo en el motor de transcripción: ' + (e.message || 'sin detalle'));
      this.pending.forEach((p) => p.rej(err)); this.pending.clear();
      this.worker = null; this.key = '';
    };
  },
  call(msg, transfer) {
    this.ensure();
    const id = ++this.seq;
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.worker.postMessage({ ...msg, id }, transfer || []); });
  },
  async load(model, device, prog) {
    let k = model + '|' + device;
    if (this.key === k) return;
    this.onProgress = prog; this.files = {};
    prog('Cargando modelo de transcripción…', 0);
    try { await this.call({ type: 'load', model, device }); }
    catch (e) {
      if (device !== 'webgpu') throw e;
      log('   ⚠️ WebGPU no disponible (' + e.message.slice(0, 80) + '). Usando CPU.');
      device = 'wasm'; k = model + '|wasm';
      if (this.key === k) return;
      await this.call({ type: 'load', model, device });
    }
    log(`   🧠 Modelo ${model.split('/')[1]} listo (${device === 'webgpu' ? 'GPU' : 'CPU'})`);
    this.key = k;
  },
  run(audio, language) { return this.call({ type: 'run', audio, language }, [audio.buffer]); },
};

// ---------- Guardado ----------
async function saveToRoot(it, action, out) {
  let dir = await it.root.getDirectoryHandle(OUT_DIR[action], { create: true });
  for (const part of it.rel.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(part, { create: true });
  const fh = await dir.getFileHandle(out.name, { create: true });
  const w = await fh.createWritable();
  await w.write(out.blob);
  await w.close();
}

function readOpts() {
  return {
    ocrLang: $('#optOcrLang').value, scale: +$('#optScale').value, ocrFallback: $('#optOcrFallback').checked,
    ocrPdf: $('#optOcrPdf').checked, ocrTxt: $('#optOcrTxt').checked, ocrMd: $('#optOcrMd').checked,
    model: $('#optModel').value, language: $('#optLang').value, device: $('#optDevice').value,
    audioMd: $('#optAudioMd').checked, audioTxt: $('#optAudioTxt').checked,
    toFolder: document.querySelector('input[name="dest"]:checked').value === 'folder',
  };
}

// ---------- Proceso por lotes ----------
$('#btnRun').onclick = async () => {
  const o = readOpts();
  const todo = state.items.filter((i) => actionFor(i.kind, state.mode) && i.status !== 'done');
  if (!todo.length) { setStatus('No hay archivos pendientes para este modo.'); return; }
  // Pedir permiso de escritura a las carpetas (debe ocurrir justo tras el clic)
  if (o.toFolder) {
    for (const root of new Set(todo.map((i) => i.root).filter(Boolean))) {
      try {
        if ((await root.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await root.requestPermission({ mode: 'readwrite' })) !== 'granted') {
          log(`⚠️ Sin permiso de escritura en «${root.name}»: los resultados quedarán para descargar.`);
          todo.forEach((i) => { if (i.root === root) i.root = null; });
        }
      } catch { todo.forEach((i) => { if (i.root === root) i.root = null; }); }
    }
  }
  state.running = true; state.cancel = false;
  $('#btnStop').disabled = false;
  renderList();
  log(`\n📄 Archivos a procesar: ${todo.length}`);
  todo.forEach((i) => log(`  - ${i.rel ? i.rel + '/' : ''}${i.file.name}`));
  let ok = 0, bad = 0;
  for (let idx = 0; idx < todo.length; idx++) {
    const it = todo[idx];
    if (state.cancel) break;
    const action = actionFor(it.kind, state.mode);
    log(`\n🔄 Procesando (${idx + 1}/${todo.length}): ${it.file.name}`);
    it.status = 'working'; it.outputs = []; updateRow(it);
    const prog = (msg, frac) => {
      it.progress = msg; updateRow(it);
      setStatus(`(${idx + 1}/${todo.length}) ${it.file.name} — ${msg}`, (idx + (frac || 0)) / todo.length);
    };
    try {
      const outs = (await run[action](it, o, prog)).map((x) => ({ ...x, action }));
      it.outputs = outs;
      for (const out of outs) {
        if (o.toFolder && it.root) {
          await saveToRoot(it, action, out);
          log(`  ✅ Guardado en: ${it.root.name}/${OUT_DIR[action]}/${it.rel ? it.rel + '/' : ''}${out.name}`);
        } else log(`  ✅ Generado: ${out.name}`);
      }
      it.status = 'done'; ok++;
      const firstText = outs.find((x) => /\.(md|txt)$/.test(x.name));
      if (firstText) renderPreview(firstText.name, await firstText.blob.text(), firstText.segs);
    } catch (e) {
      if (e === CANCEL) { it.status = 'pending'; log('  ⏹ Detenido'); }
      else { it.status = 'error'; it.error = e.message || String(e); bad++; log(`  ❌ Error: ${it.error}`); console.error(e); }
    }
    updateRow(it);
  }
  log('\n' + '='.repeat(50) + '\n📊 RESUMEN\n' + '='.repeat(50));
  todo.filter((i) => i.status !== 'pending').forEach((i) => log(`${i.status === 'done' ? '✅ Éxito' : '❌ Error'} - ${i.file.name}`));
  log(`\n✅ Convertidos: ${ok}   ❌ Errores: ${bad}`);
  state.running = false;
  $('#btnStop').disabled = true;
  setStatus(state.cancel ? `Detenido. ${ok} archivo(s) listos.` : `¡Proceso completado! ${ok} listo(s), ${bad} con error.`, state.cancel ? null : 1);
  renderList();
};
$('#btnStop').onclick = () => { state.cancel = true; setStatus('Deteniendo al terminar el paso actual…'); };

$('#btnZip').onclick = async () => {
  await need('jszip');
  const zip = new JSZip();
  for (const it of state.items) for (const o of it.outputs) {
    zip.file([OUT_DIR[o.action], it.rel, o.name].filter(Boolean).join('/'), o.blob);
  }
  downloadBlob(await zip.generateAsync({ type: 'blob' }), 'resultados.zip');
};

// ---------- Generador QR ----------
let qrModel = null;
async function drawQr() {
  try {
    await need('qrcode');
    const text = $('#qrText').value.trim();
    const msg = $('#qrMsg');
    if (!text) { msg.textContent = 'Escribe un enlace o texto.'; return; }
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    const q = qrcode(0, $('#qrEcc').value);
    q.addData(text, 'Byte');
    q.make();
    qrModel = q;
    const size = Math.max(128, Math.min(2048, +$('#qrSize').value || 512));
    const n = q.getModuleCount(), quiet = 4, cell = size / (n + quiet * 2);
    const c = $('#qrCanvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = /^#[0-9a-f]{3,8}$/i.test($('#qrColor').value) ? $('#qrColor').value : '#000';
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) ctx.fillRect(Math.floor((k + quiet) * cell), Math.floor((r + quiet) * cell), Math.ceil(cell), Math.ceil(cell));
    msg.textContent = `${n}×${n} módulos · ${text.length} caracteres`;
  } catch (e) { $('#qrMsg').textContent = '⚠️ ' + (e.message || e) + ' (texto demasiado largo para un QR)'; }
}
['qrText', 'qrSize', 'qrEcc', 'qrColor'].forEach((id) => $('#' + id).addEventListener('input', drawQr));
$('#qrPng').onclick = () => $('#qrCanvas').toBlob((b) => downloadBlob(b, ($('#qrName').value || 'codigo_qr') + '.png'));
$('#qrSvg').onclick = () => {
  if (!qrModel) return;
  const n = qrModel.getModuleCount(), q = 4, color = $('#qrColor').value || '#000';
  let path = '';
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (qrModel.isDark(r, k)) path += `M${k + q} ${r + q}h1v1h-1z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + q * 2} ${n + q * 2}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="${esc(color)}"/></svg>`;
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), ($('#qrName').value || 'codigo_qr') + '.svg');
};

// ---------- Preferencias: tema y tamaño de letra ----------
const prefs = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
  document.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.themeSet === (t || 'auto')));
  prefs.set('tl-theme', t || 'auto');
}
document.querySelectorAll('[data-theme-set]').forEach((b) => b.addEventListener('click', () => applyTheme(b.dataset.themeSet)));
applyTheme(prefs.get('tl-theme') || 'auto');

const FONT_STEPS = [75, 87.5, 100, 112.5, 125, 137.5, 150];
let fontPct = FONT_STEPS.includes(+prefs.get('tl-font')) ? +prefs.get('tl-font') : 100;
function applyFont(p) {
  fontPct = p;
  document.documentElement.style.fontSize = (16 * p / 100) + 'px';
  $('#fsVal').textContent = Math.round(p) + ' %';
  $('#fsDown').disabled = p === FONT_STEPS[0];
  $('#fsUp').disabled = p === FONT_STEPS[FONT_STEPS.length - 1];
  prefs.set('tl-font', p);
}
$('#fsDown').onclick = () => applyFont(FONT_STEPS[Math.max(0, FONT_STEPS.indexOf(fontPct) - 1)]);
$('#fsUp').onclick = () => applyFont(FONT_STEPS[Math.min(FONT_STEPS.length - 1, FONT_STEPS.indexOf(fontPct) + 1)]);
applyFont(fontPct);

// ---------- Inicio ----------
(async () => {
  let gpu = false;
  try { gpu = !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch {}
  if (!gpu) $('#optDevice').value = 'wasm';
  $('#optDevice').options[0].textContent += gpu ? ' — disponible' : ' — no disponible';
  if (matchMedia('(pointer: coarse)').matches) drop.textContent = 'En el celular usa «Elegir archivos». Las carpetas y el guardado directo funcionan mejor en un computador.';
  if (!window.showDirectoryPicker) log('ℹ️ Este navegador no permite escribir en carpetas: los resultados se descargarán. Usa Chrome o Edge para guardarlos directamente.');
  log('Listo. Elige una carpeta o archivos.');
})();
setMode('auto');
window.app = { state, run, addFile, renderList, readOpts };

// ---------- Instalar como app: banner con botón, además del menú del navegador ----------
// Android dispara beforeinstallprompt y deja instalar con un botón propio. iOS no tiene esa
// API (no hay forma de abrir el diálogo de instalación desde la página), así que ahí solo se
// explican los pasos manuales (Compartir → Agregar a inicio).
const INSTALAR_TEXTOS = {
  boton: 'Queda en tu pantalla de inicio con su propio ícono, sin pasar por una tienda de apps.',
  ios: 'Toca Compartir en el navegador y luego «Agregar a inicio». Queda con su ícono, junto a tus otras apps.',
  android: 'Toca el menú ⋮ del navegador y elige «Instalar aplicación». Queda con su ícono, junto a tus otras apps.',
  otro: 'Usa el ícono de instalar de la barra de direcciones. En el celular queda en la pantalla de inicio con su ícono.',
};
function plataformaInstalar(ua, puntosTactiles = 0) {
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && puntosTactiles > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'otro';
}
function iniciarInstalacion() {
  const inicio = $('#instalarInicio');
  if (!inicio) return;
  const sistema = plataformaInstalar(navigator.userAgent, navigator.maxTouchPoints);
  // Enlace para compartir (…?instalar): dirige directo al botón de instalar, resaltado y listo
  // para tocar. No existe forma de abrir el diálogo nativo sin que la persona toque algo (los
  // navegadores lo exigen), así que esto deja todo a un solo toque en vez de tener que buscar
  // el aviso o el menú del navegador. Si el navegador todavía no decide si puede instalarse
  // (beforeinstallprompt no ha llegado), se vuelve a intentar cuando llegue.
  let quiereInstalar = new URLSearchParams(location.search).has('instalar');
  if (quiereInstalar) history.replaceState(null, '', location.pathname + location.hash);
  let aviso = null;
  let instalada = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pintar = () => {
    inicio.hidden = instalada || !(aviso || sistema !== 'otro');
    const texto = INSTALAR_TEXTOS[aviso ? 'boton' : sistema];
    inicio.querySelectorAll('[data-instalar-texto]').forEach((p) => { p.textContent = texto; });
    inicio.querySelectorAll('[data-instalar]').forEach((b) => { b.hidden = !aviso; });
  };
  const aplicarIntento = () => {
    if (!quiereInstalar || instalada || inicio.hidden) return;
    const boton = inicio.querySelector('[data-instalar]');
    const listo = boton && !boton.hidden; // ya se puede tocar para instalar
    if (!listo && sistema === 'android') return; // esperar a que llegue beforeinstallprompt
    quiereInstalar = false;
    inicio.classList.add('resaltar');
    inicio.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
    if (listo) boton.focus();
  };
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // se guarda para mostrarlo cuando la persona toque el botón
    aviso = e;
    pintar();
    aplicarIntento();
  });
  window.addEventListener('appinstalled', () => {
    aviso = null;
    instalada = true;
    pintar();
  });
  inicio.querySelectorAll('[data-instalar]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!aviso) return;
      const pendiente = aviso;
      aviso = null;
      pendiente.prompt();
      await pendiente.userChoice;
      pintar();
    });
  });
  pintar();
  aplicarIntento();
}
iniciarInstalacion();
