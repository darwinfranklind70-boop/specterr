/* ============================================================
   SpectraWave · Visualizador de música
   100% en el navegador. Web Audio API + Canvas.
   ============================================================ */

const $ = (id) => document.getElementById(id);

// ---- Elementos ----
const canvas   = $('viz');
const ctx      = canvas.getContext('2d');
const audioEl  = $('audioEl');
const bgVideoEl = $('bgVideoEl');
const canvasHint = $('canvasHint');
const canvasWrap = $('canvasWrap');

// ---- Estado / configuración ----
const cfg = {
  vizType: 'bars',
  barColor: '#7c5cff',
  barColor2: '#00e5ff',
  useGradient: true,
  sensitivity: 1.6,
  barCount: 96,
  smoothing: 0.8,
  barGap: 0.3,
  glow: true,
  bgType: 'gradient',
  bgColor1: '#0f0c29',
  bgColor2: '#24243e',
  bgAngle: 135,
  bgDim: 0.25,
  reactiveBg: false,
  spinCover: true,
  titleText: '',
  subText: '',
  textColor: '#ffffff',
  textPos: 'bottom-left',
  aspect: '16:9',
};

let audioCtx, analyser, sourceNode, gainNode, freqData, timeData;
let isAudioReady = false;
let coverImg = null;
let bgImg = null;
let coverAngle = 0;
let mediaRecorder = null, recChunks = [], recStart = 0, recTimer = null;

// ============================================================
//  Configuración del canvas según formato
// ============================================================
function setCanvasSize() {
  const map = { '16:9': [1280, 720], '1:1': [1080, 1080], '9:16': [720, 1280] };
  const [w, h] = map[cfg.aspect] || map['16:9'];
  canvas.width = w; canvas.height = h;
  canvasWrap.style.aspectRatio = w + ' / ' + h;
}
setCanvasSize();

// ============================================================
//  Audio: inicialización al cargar archivo
// ============================================================
function initAudioGraph() {
  if (audioCtx) return;
  audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
  analyser  = audioCtx.createAnalyser();
  gainNode  = audioCtx.createGain();
  sourceNode = audioCtx.createMediaElementSource(audioEl);

  sourceNode.connect(gainNode);
  gainNode.connect(analyser);
  analyser.connect(audioCtx.destination);

  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = cfg.smoothing;
  freqData = new Uint8Array(analyser.frequencyBinCount);
  timeData = new Uint8Array(analyser.fftSize);
}

function loadAudioFile(file) {
  const url = URL.createObjectURL(file);
  audioEl.src = url;
  initAudioGraph();
  isAudioReady = true;
  $('playBtn').disabled = false;
  $('seek').disabled = false;
  canvasHint.style.display = 'none';
  $('audioName').textContent = file.name;
  // Autocompletar título si está vacío
  if (!cfg.titleText) {
    const name = file.name.replace(/\.[^.]+$/, '');
    $('titleText').value = name;
    cfg.titleText = name;
  }
  if (!loopRunning) { loopRunning = true; render(); }
}

// ============================================================
//  Helpers de color / fondo
// ============================================================
function makeBarGradient(x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  if (cfg.useGradient) {
    g.addColorStop(0, cfg.barColor);
    g.addColorStop(1, cfg.barColor2);
  } else {
    g.addColorStop(0, cfg.barColor);
    g.addColorStop(1, cfg.barColor);
  }
  return g;
}

function drawBackground(level) {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  if (cfg.bgType === 'solid') {
    ctx.fillStyle = cfg.bgColor1;
    ctx.fillRect(0, 0, W, H);
  } else if (cfg.bgType === 'gradient') {
    const rad = (cfg.bgAngle * Math.PI) / 180;
    const x = Math.cos(rad), y = Math.sin(rad);
    const g = ctx.createLinearGradient(
      W/2 - x*W/2, H/2 - y*H/2, W/2 + x*W/2, H/2 + y*H/2
    );
    g.addColorStop(0, cfg.bgColor1);
    g.addColorStop(1, cfg.bgColor2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else if (cfg.bgType === 'image' && bgImg) {
    drawCover(bgImg, level);
  } else if (cfg.bgType === 'video' && bgVideoEl.readyState >= 2) {
    drawCover(bgVideoEl, level);
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
  }

  // Oscurecer
  if (cfg.bgDim > 0) {
    ctx.fillStyle = `rgba(0,0,0,${cfg.bgDim})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// Dibuja una imagen/video tipo "cover" cubriendo todo el canvas (con pulso opcional)
function drawCover(media, level) {
  const W = canvas.width, H = canvas.height;
  const mw = media.videoWidth || media.naturalWidth || media.width;
  const mh = media.videoHeight || media.naturalHeight || media.height;
  if (!mw || !mh) return;
  let scale = Math.max(W / mw, H / mh);
  if (cfg.reactiveBg) scale *= 1 + level * 0.12;
  const dw = mw * scale, dh = mh * scale;
  ctx.drawImage(media, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

// ============================================================
//  Visualizadores
// ============================================================
function getBars() {
  // Reduce los bins de frecuencia a cfg.barCount barras (escala log-ish)
  const bins = analyser.frequencyBinCount;
  const count = cfg.barCount;
  const bars = new Array(count);
  const usable = Math.floor(bins * 0.72); // evita las frecuencias más altas (poca energía)
  for (let i = 0; i < count; i++) {
    const start = Math.floor(Math.pow(i / count, 1.6) * usable);
    const end = Math.max(start + 1, Math.floor(Math.pow((i + 1) / count, 1.6) * usable));
    let max = 0;
    for (let j = start; j < end; j++) max = Math.max(max, freqData[j]);
    bars[i] = Math.min(1, (max / 255) * cfg.sensitivity);
  }
  return bars;
}

function avgLevel() {
  let sum = 0;
  for (let i = 0; i < freqData.length; i++) sum += freqData[i];
  return (sum / freqData.length) / 255;
}

function drawBars(bars, mirror = false) {
  const W = canvas.width, H = canvas.height;
  const baseY = mirror ? H / 2 : H * 0.92;
  const maxH = mirror ? H * 0.42 : H * 0.7;
  const slot = W / bars.length;
  const bw = slot * (1 - cfg.barGap);
  setGlow();
  for (let i = 0; i < bars.length; i++) {
    const h = bars[i] * maxH;
    const x = i * slot + (slot - bw) / 2;
    ctx.fillStyle = makeBarGradient(0, baseY, 0, baseY - maxH);
    roundRect(x, baseY - h, bw, h, Math.min(bw / 2, 6));
    ctx.fill();
    if (mirror) {
      roundRect(x, baseY, bw, h, Math.min(bw / 2, 6));
      ctx.fill();
    }
  }
  clearGlow();
}

function drawDots(bars) {
  const W = canvas.width, H = canvas.height;
  const baseY = H * 0.9, maxH = H * 0.7, slot = W / bars.length;
  setGlow();
  for (let i = 0; i < bars.length; i++) {
    const h = bars[i] * maxH;
    const x = i * slot + slot / 2;
    ctx.fillStyle = makeBarGradient(0, baseY, 0, baseY - maxH);
    ctx.beginPath();
    ctx.arc(x, baseY - h, Math.max(2, slot * 0.28), 0, Math.PI * 2);
    ctx.fill();
  }
  clearGlow();
}

function drawBlocks(bars) {
  const W = canvas.width, H = canvas.height;
  const slot = W / bars.length;
  const bw = slot * (1 - cfg.barGap);
  const blocks = 22, gap = 3;
  const totalH = H * 0.78, baseY = H * 0.9;
  const blockH = (totalH - gap * (blocks - 1)) / blocks;
  setGlow();
  for (let i = 0; i < bars.length; i++) {
    const lit = Math.round(bars[i] * blocks);
    const x = i * slot + (slot - bw) / 2;
    for (let b = 0; b < lit; b++) {
      const y = baseY - (b + 1) * (blockH + gap);
      const t = b / blocks;
      ctx.fillStyle = cfg.useGradient ? lerpColor(cfg.barColor, cfg.barColor2, t) : cfg.barColor;
      ctx.fillRect(x, y, bw, blockH);
    }
  }
  clearGlow();
}

function drawRadial(bars) {
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  const radius = Math.min(W, H) * 0.18;
  const maxLen = Math.min(W, H) * 0.28;
  setGlow();
  const n = bars.length;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
    const len = bars[i] * maxLen + 4;
    const x1 = cx + Math.cos(ang) * radius;
    const y1 = cy + Math.sin(ang) * radius;
    const x2 = cx + Math.cos(ang) * (radius + len);
    const y2 = cy + Math.sin(ang) * (radius + len);
    ctx.strokeStyle = cfg.useGradient ? lerpColor(cfg.barColor, cfg.barColor2, i / n) : cfg.barColor;
    ctx.lineWidth = Math.max(2, (W / n) * 0.5);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  clearGlow();
  // Portada en el centro
  drawCenterCover(cx, cy, radius * 0.92);
}

function drawWave() {
  const W = canvas.width, H = canvas.height;
  analyser.getByteTimeDomainData(timeData);
  setGlow();
  ctx.lineWidth = Math.max(2, W / 400);
  ctx.strokeStyle = makeBarGradient(0, 0, W, 0);
  ctx.beginPath();
  const slice = W / timeData.length;
  for (let i = 0; i < timeData.length; i++) {
    const v = ((timeData[i] - 128) / 128) * cfg.sensitivity;
    const y = H / 2 + v * (H * 0.35);
    const x = i * slice;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  clearGlow();
}

// Portada central (para radial). spin opcional.
function drawCenterCover(cx, cy, r) {
  if (!coverImg) return;
  ctx.save();
  ctx.translate(cx, cy);
  if (cfg.spinCover) ctx.rotate(coverAngle);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  const s = r * 2;
  ctx.drawImage(coverImg, -r, -r, s, s);
  ctx.restore();
}

// ============================================================
//  Texto
// ============================================================
function drawText() {
  if (!cfg.titleText && !cfg.subText) return;
  const W = canvas.width, H = canvas.height;
  const titleSize = Math.round(H * 0.055);
  const subSize = Math.round(H * 0.035);
  const pad = Math.round(W * 0.04);
  let x, y, align;
  switch (cfg.textPos) {
    case 'bottom-center': x = W / 2; y = H - pad - subSize - 10; align = 'center'; break;
    case 'top-left':      x = pad; y = pad + titleSize; align = 'left'; break;
    case 'center':        x = W / 2; y = H / 2; align = 'center'; break;
    default:              x = pad; y = H - pad - subSize - 10; align = 'left';
  }
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,.6)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = cfg.textColor;
  ctx.font = `800 ${titleSize}px Poppins, Inter, sans-serif`;
  if (cfg.titleText) ctx.fillText(cfg.titleText, x, y);
  if (cfg.subText) {
    ctx.globalAlpha = 0.82;
    ctx.font = `500 ${subSize}px Inter, sans-serif`;
    ctx.fillText(cfg.subText, x, y + subSize + 8);
    ctx.globalAlpha = 1;
  }
  ctx.shadowBlur = 0;
}

// Portada fija (esquina) cuando NO es radial
function drawCornerCover(level) {
  if (!coverImg || cfg.vizType === 'radial') return;
  const W = canvas.width, H = canvas.height;
  const size = Math.min(W, H) * 0.22;
  const x = W / 2, y = H * 0.4;
  ctx.save();
  ctx.translate(x, y);
  if (cfg.spinCover) ctx.rotate(coverAngle);
  ctx.beginPath();
  ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(coverImg, -size/2, -size/2, size, size);
  ctx.restore();
  // anillo
  ctx.beginPath();
  ctx.arc(x, y, size/2, 0, Math.PI*2);
  ctx.strokeStyle = 'rgba(255,255,255,.25)';
  ctx.lineWidth = 3;
  ctx.stroke();
}

// ============================================================
//  Utilidades de dibujo
// ============================================================
function setGlow() {
  if (cfg.glow) { ctx.shadowColor = cfg.barColor; ctx.shadowBlur = 18; }
}
function clearGlow() { ctx.shadowBlur = 0; }

function roundRect(x, y, w, h, r) {
  if (h < 0) { y += h; h = -h; }
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function lerpColor(a, b, t) {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  const r = Math.round(ca.r + (cb.r - ca.r) * t);
  const g = Math.round(ca.g + (cb.g - ca.g) * t);
  const bl = Math.round(ca.b + (cb.b - ca.b) * t);
  return `rgb(${r},${g},${bl})`;
}
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// ============================================================
//  Bucle de render
// ============================================================
let loopRunning = false;
function render() {
  requestAnimationFrame(render);
  let level = 0, bars = [];
  if (isAudioReady && analyser) {
    analyser.getByteFrequencyData(freqData);
    level = avgLevel();
    bars = getBars();
  }

  drawBackground(level);

  if (isAudioReady && analyser) {
    switch (cfg.vizType) {
      case 'mirror':  drawBars(bars, true); break;
      case 'radial':  drawRadial(bars); break;
      case 'wave':    drawWave(); break;
      case 'dots':    drawDots(bars); break;
      case 'blocks':  drawBlocks(bars); break;
      default:        drawBars(bars, false);
    }
    drawCornerCover(level);
    // velocidad de giro según energía
    if (cfg.spinCover) coverAngle += 0.01 + level * 0.06;
  }

  drawText();
}

// ============================================================
//  Grabación de video (canvas + audio -> WebM)
// ============================================================
function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }
  if (!isAudioReady) { alert('Primero sube una canción.'); return; }
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const canvasStream = canvas.captureStream(60);
  // Conectar audio al stream
  const dest = audioCtx.createMediaStreamDestination();
  gainNode.connect(dest);
  dest.stream.getAudioTracks().forEach(t => canvasStream.addTrack(t));

  let mime = 'video/webm;codecs=vp9,opus';
  if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm;codecs=vp8,opus';
  if (!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';

  recChunks = [];
  mediaRecorder = new MediaRecorder(canvasStream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  mediaRecorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (cfg.titleText || 'spectrawave') + '.webm';
    a.click();
    URL.revokeObjectURL(url);
    finishRecUI();
  };

  // Reiniciar la canción para grabar desde el inicio
  audioEl.currentTime = 0;
  audioEl.play();
  mediaRecorder.start();
  recStart = Date.now();
  startRecUI();
}

function startRecUI() {
  $('recordBtn').classList.add('active');
  $('recordBtn').innerHTML = '<span class="rec-dot"></span> Detener';
  $('recBadge').classList.add('active');
  recTimer = setInterval(() => {
    $('recTime').textContent = fmtTime((Date.now() - recStart) / 1000);
  }, 500);
}
function finishRecUI() {
  $('recordBtn').classList.remove('active');
  $('recordBtn').innerHTML = '<span class="rec-dot"></span> Grabar video';
  $('recBadge').classList.remove('active');
  clearInterval(recTimer);
}

// Detener grabación automáticamente al terminar la canción
audioEl.addEventListener('ended', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
});

// ============================================================
//  UI bindings
// ============================================================
function fmtTime(s) {
  if (!isFinite(s)) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

// Audio file
$('audioInput').addEventListener('change', (e) => {
  if (e.target.files[0]) loadAudioFile(e.target.files[0]);
});
// Drag & drop audio
const audioDrop = $('audioDrop');
['dragover', 'dragenter'].forEach(ev => audioDrop.addEventListener(ev, e => { e.preventDefault(); audioDrop.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => audioDrop.addEventListener(ev, e => { e.preventDefault(); audioDrop.classList.remove('drag'); }));
audioDrop.addEventListener('drop', e => {
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('audio')) loadAudioFile(f);
});

// Play / pause
$('playBtn').addEventListener('click', () => {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  if (audioEl.paused) { audioEl.play(); $('playBtn').textContent = '⏸ Pausa'; }
  else { audioEl.pause(); $('playBtn').textContent = '▶ Reproducir'; }
});
audioEl.addEventListener('ended', () => { $('playBtn').textContent = '▶ Reproducir'; });

// Seek + time
audioEl.addEventListener('timeupdate', () => {
  const pct = (audioEl.currentTime / audioEl.duration) * 100 || 0;
  $('seek').value = pct;
  $('timeLabel').textContent = `${fmtTime(audioEl.currentTime)} / ${fmtTime(audioEl.duration)}`;
});
$('seek').addEventListener('input', () => {
  if (audioEl.duration) audioEl.currentTime = ($('seek').value / 100) * audioEl.duration;
});
$('volume').addEventListener('input', e => {
  if (gainNode) gainNode.gain.value = parseFloat(e.target.value);
  audioEl.volume = parseFloat(e.target.value);
});

// Bindings genéricos para cfg
function bind(id, key, type = 'value', after) {
  const el = $(id);
  const handler = () => {
    cfg[key] = type === 'checked' ? el.checked
             : type === 'number' ? parseFloat(el.value)
             : el.value;
    if (after) after();
  };
  el.addEventListener(type === 'checked' ? 'change' : 'input', handler);
}

bind('vizType', 'vizType');
bind('barColor', 'barColor');
bind('barColor2', 'barColor2');
bind('useGradient', 'useGradient', 'checked');
bind('sensitivity', 'sensitivity', 'number');
bind('barCount', 'barCount', 'number');
bind('smoothing', 'smoothing', 'number', () => { if (analyser) analyser.smoothingTimeConstant = cfg.smoothing; });
bind('barGap', 'barGap', 'number');
bind('glow', 'glow', 'checked');
bind('bgColor1', 'bgColor1');
bind('bgColor2', 'bgColor2');
bind('bgAngle', 'bgAngle', 'number');
bind('bgDim', 'bgDim', 'number');
bind('reactiveBg', 'reactiveBg', 'checked');
bind('spinCover', 'spinCover', 'checked');
bind('titleText', 'titleText');
bind('subText', 'subText');
bind('textColor', 'textColor');
bind('textPos', 'textPos');

// Tipo de fondo: mostrar/ocultar inputs
$('bgType').addEventListener('change', e => {
  cfg.bgType = e.target.value;
  $('bgImageBox').style.display = cfg.bgType === 'image' ? 'block' : 'none';
  $('bgVideoBox').style.display = cfg.bgType === 'video' ? 'block' : 'none';
  const gradOnly = cfg.bgType === 'gradient';
  $('bgAngleRow').style.display = gradOnly ? 'flex' : 'none';
  if (cfg.bgType === 'video' && bgVideoEl.src) bgVideoEl.play();
});

// Imagen de fondo
$('bgImageInput').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const img = new Image();
  img.onload = () => { bgImg = img; };
  img.src = URL.createObjectURL(f);
});
// Video de fondo
$('bgVideoInput').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  bgVideoEl.src = URL.createObjectURL(f);
  bgVideoEl.play().catch(() => {});
});
// Portada
$('coverInput').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  const img = new Image();
  img.onload = () => { coverImg = img; };
  img.src = URL.createObjectURL(f);
});

// Formato
$('aspect').addEventListener('change', e => { cfg.aspect = e.target.value; setCanvasSize(); });

// Grabar / fullscreen
$('recordBtn').addEventListener('click', toggleRecording);
$('fullscreenBtn').addEventListener('click', () => {
  if (!document.fullscreenElement) canvasWrap.requestFullscreen();
  else document.exitFullscreen();
});

// Reset
$('resetBtn').addEventListener('click', () => location.reload());

// Arranca el loop aunque no haya audio (muestra fondo)
loopRunning = true;
render();
