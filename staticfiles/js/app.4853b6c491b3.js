let websocket;
let pdfDoc;
let pdfJsDoc;
let signedImageBase64 = null;
let isPlacingSignature = false;
let signaturePosition = { x: 100, y: 100 };
let signatures = [];
let sigCounter = 0;
let selectedSignatureIndex = -1;
let isDraggingSignature = false;
let dragOffset = { x: 0, y: 0 };
let isResizing = false;
let resizeHandle = null; // 'nw','ne','sw','se'
let resizeSigIndex = -1;
let resizeStart = { x: 0, y: 0 };
let canvas, context;
let currentViewport;
let canvasBackgroundImageData = null;
let signedFingerTemplate = null;
let lastErrorMessage = "";
const pdfInput = document.getElementById('pdfInput');
const connectBtn = document.getElementById('connectBtn');
const signBtn = document.getElementById('signBtn');
const downloadBtn = document.getElementById('downloadBtn');
const statusDiv = document.getElementById('status');
const pdfFileNameSpan = document.getElementById('pdfFileName');
const fingerprintBtn = document.getElementById('fingerprintBtn');
const signFingerBtn = document.getElementById('signFingerBtn');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageInfo = document.getElementById('pageInfo');
const pageNumberInput = document.getElementById('pageNumberInput');
const goPageBtn = document.getElementById('goPageBtn');
const pageControls = document.getElementById('pageControls');
const downloadSdkBtn = document.getElementById('downloadSdkBtn');
const clearSigsBtn = document.getElementById('clearSigsBtn');


const themeToggleBtn = document.getElementById('themeToggleBtn');
function applyTheme(theme) {
    if (theme === 'dark') {
        document.body.classList.add('theme-dark');
        if (themeToggleBtn) themeToggleBtn.textContent = '☀️';
    } else {
        document.body.classList.remove('theme-dark');
        if (themeToggleBtn) themeToggleBtn.textContent = '🌙';
    }
    try { localStorage.setItem('barracuda_theme', theme); } catch (e) {}
}

(function(){
    try {
        const saved = localStorage.getItem('barracuda_theme') || 'light';
        applyTheme(saved);
    } catch (e) { }
})();
if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
        const isDark = document.body.classList.contains('theme-dark');
        applyTheme(isDark ? 'light' : 'dark');
    });
}


const DOWNLOAD_SDK_URL = 'sdk/Sign05Server-UG0502.zip';

// Inicial
if (!connectBtn) console.warn('Advertencia: elemento `connectBtn` no encontrado en el DOM.');
if (signBtn) signBtn.disabled = true;
if (fingerprintBtn) fingerprintBtn.disabled = true;
if (signFingerBtn) signFingerBtn.disabled = true;
if (downloadBtn) downloadBtn.disabled = true;

// Constantes
const FINAL_SIG_WIDTH_PT = 140;
const FINAL_SIG_HEIGHT_PT = 70;
const FINAL_FINGER_WIDTH_PT = 45;
const FINAL_FINGER_HEIGHT_PT = 90;
const PREVIEW_ADJUST_X = 0;
const PREVIEW_ADJUST_Y = 0;
const COMBINED_FINAL_MAX_WIDTH_PT = 320;
const COMBINED_FINAL_MAX_HEIGHT_PT = 280;

let isFingerprintImage = false;
let isCombinedImage = false;
let currentPage = 1;
let totalPages = 0;
let pageRenderInProgress = false;
let pageScale = 1.0;
let zoomScale = 1.0;

function updateStatus(message) {
    if (statusDiv) statusDiv.textContent = message;
}
async function obtenerIDReal() {
    let res = await fetch('/api/generar-id/');
    let data = await res.json();
    return data.id;
}
async function processImageToBlack(base64) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const c = document.createElement('canvas');
            const ctx = c.getContext('2d');
            c.width = img.width;
            c.height = img.height;
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, c.width, c.height);
            const data = imageData.data;
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i], g = data[i+1], b = data[i+2];
                if (r > 50 && g < 100 && b < 100) {
                    data[i] = 0; data[i+1] = 0; data[i+2] = 0;
                }
            }
            ctx.putImageData(imageData, 0, 0);
            resolve(c.toDataURL('image/png'));
        };
        img.onerror = () => resolve(null);
        img.src = base64.startsWith('data:') ? base64 : ('data:image/png;base64,' + base64);
    });
}
async function processPdfFile(file) {
    if (!file) return;
    if (pdfFileNameSpan) pdfFileNameSpan.textContent = file.name;
    updateStatus('Cargando PDF...');
    try {
        const arrayBuffer = await file.arrayBuffer();
        pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
        pdfJsDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        totalPages = pdfJsDoc.numPages;
        currentPage = 1;
        if (pageControls) pageControls.style.display = 'flex';
        await renderPdfPage(currentPage);
        const pdfCanvasElShow = document.getElementById('pdfCanvas'); if (pdfCanvasElShow) pdfCanvasElShow.style.display = 'block';
        const dropZone = document.getElementById('dropZone'); if (dropZone) dropZone.style.display = 'none';
        const sideZoomControls = document.getElementById('sideZoomControls'); if (sideZoomControls) sideZoomControls.style.display = 'block';
        updateStatus('PDF cargado. Conecta la tableta y firma.');
        if (downloadBtn) downloadBtn.disabled = false;
    } catch (err) {
        const sideZoomControls = document.getElementById('sideZoomControls'); if (sideZoomControls) sideZoomControls.style.display = 'none';
        updateStatus('Error al cargar PDF: ' + (err && err.message ? err.message : err));
    }
}

if (pdfInput) pdfInput.addEventListener('change', (e) => { const file = e.target.files[0]; processPdfFile(file); });

const dropZoneEl = document.getElementById('dropZone');
if (dropZoneEl) {
    dropZoneEl.addEventListener('click', () => { if (pdfInput) pdfInput.click(); });
    dropZoneEl.addEventListener('dragover', (e) => { e.preventDefault(); dropZoneEl.classList.add('dragover'); });
    dropZoneEl.addEventListener('dragleave', (e) => { e.preventDefault(); dropZoneEl.classList.remove('dragover'); });
    dropZoneEl.addEventListener('drop', (e) => {
        e.preventDefault(); dropZoneEl.classList.remove('dragover');
        const f = (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) ? e.dataTransfer.files[0] : null;
        if (f) {
            if (!f.name || !f.name.toLowerCase().endsWith('.pdf')) { updateStatus('Por favor suelta un archivo PDF.'); return; }
            processPdfFile(f);
        }
    });
}


async function renderPdfPage(pageNum) {
    if (!pdfJsDoc || pageRenderInProgress) return;
    pageRenderInProgress = true;
    try {
        const page = await pdfJsDoc.getPage(pageNum);
        canvas = document.getElementById('pdfCanvas');
        context = canvas.getContext('2d');
        const containerWidth = canvas.parentElement.clientWidth || 800;
        const initialViewport = page.getViewport({ scale: 1.0 });
       
        const baseScale = (containerWidth / initialViewport.width) * 0.95;
        pageScale = baseScale * (zoomScale || 1.0);
        const viewport = page.getViewport({ scale: pageScale });

        
        const outputScale = window.devicePixelRatio || 1;
        
        const cssWidth = Math.floor(viewport.width);
        const cssHeight = Math.floor(viewport.height);
        
        canvas.style.width = cssWidth + 'px';
        canvas.style.height = cssHeight + 'px';
        canvas.width = Math.floor(cssWidth * outputScale);
        canvas.height = Math.floor(cssHeight * outputScale);
        context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

        currentViewport = viewport;
        await page.render({ canvasContext: context, viewport }).promise;
        try {
            canvasBackgroundImageData = context.getImageData(0, 0, canvas.width, canvas.height);
        } catch (err) {
            
            console.warn('No se pudo capturar snapshot del canvas para previews rápidos', err);
            canvasBackgroundImageData = null;
        }
    } finally {
        pageRenderInProgress = false;
        if (typeof totalPages === 'number' && pageInfo) {
            pageInfo.textContent = `Página ${currentPage} / ${totalPages}`;
            if (pageNumberInput) pageNumberInput.value = currentPage;
            if (prevPageBtn) prevPageBtn.disabled = currentPage <= 1;
            if (nextPageBtn) nextPageBtn.disabled = currentPage >= totalPages;
        }
        // Redibujar firmas en la página actual después de cualquier render (incluye cambios de zoom)
        try {
            drawAllSignaturesOnCanvas(pageNum);
        } catch (err) {
            // Si drawAllSignaturesOnCanvas no está disponible aún o falla, ignoramos el error
            // (esto puede ocurrir durante la carga inicial)
            // console.warn('No se pudo redibujar firmas tras render:', err);
        }
    }
}


function setZoom(newZoom) {
    const minZ = 0.5, maxZ = 2.5;
    zoomScale = Math.min(maxZ, Math.max(minZ, Number(newZoom) || 1));
    const zoomPct = Math.round(zoomScale * 100);
    const zLabel = document.getElementById('zoomLabel'); if (zLabel) zLabel.textContent = `${zoomPct}%`;
    const zoomRange = document.getElementById('zoomRange'); if (zoomRange) zoomRange.value = zoomScale;
    renderPdfPage(currentPage);
}

function changeZoomBy(delta) { setZoom((zoomScale || 1) + delta); }
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomRangeEl = document.getElementById('zoomRange');
if (zoomInBtn) zoomInBtn.addEventListener('click', () => changeZoomBy(0.1));
if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => changeZoomBy(-0.1));
if (zoomRangeEl) zoomRangeEl.addEventListener('input', (e) => setZoom(e.target.value));
const zLabelInit = document.getElementById('zoomLabel'); if (zLabelInit) zLabelInit.textContent = `${Math.round(zoomScale*100)}%`;


const WS_URI = 'ws://127.0.0.1:10001/';
let reconnectAttempts = 0;
const MAX_RECONNECT = 6;

function connectWebSocket() {
    if (websocket && websocket.readyState === WebSocket.OPEN) { updateStatus('Ya conectado.'); return; }
    updateStatus('Abriendo conexión WebSocket...');
    websocket = new WebSocket(WS_URI);
    const openTimeout = setTimeout(() => { updateStatus('No se pudo conectar: tiempo de espera.'); websocket && websocket.close(); }, 5000);

    websocket.onopen = (evt) => {
        clearTimeout(openTimeout);
        reconnectAttempts = 0;
        updateStatus('Conectado a UGEE. Listo para firmar y huella.');
        if (signBtn) signBtn.disabled = false;
        if (fingerprintBtn) fingerprintBtn.disabled = false;
        if (signFingerBtn) signFingerBtn.disabled = false;
    };

    websocket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('WS mensaje:', data);
            if (data.typeName === 'UgeeSignBase64') {
                signedImageBase64 = data.message;
                isFingerprintImage = false;
                isCombinedImage = false;
                isPlacingSignature = true;
                updateStatus('Firma capturada. Haz clic en el PDF para posicionarla.');
            } else if (data.typeName === 'UgeeFingerBase64') {
                processImageToBlack(data.message).then(processed => {
                    if (processed) signedImageBase64 = processed;
                    isFingerprintImage = true;
                    isPlacingSignature = true;
                    updateStatus('Huella capturada. Haz clic en el PDF para posicionarla.');
                });
            } else if (data.typeName === 'UgeeSignFBase64') {
                processImageToBlack(data.message).then(processed => {
                    if (processed) signedImageBase64 = processed;
                    isCombinedImage = true;
                    isPlacingSignature = true;
                    updateStatus('Firma+huella capturada. Haz clic en el PDF para posicionarla.');
                });
            } else if (data.typeName === 'UgeeOk' || data.typeName === 'UgeeOK') {
                updateStatus('Operación confirmada.');
            } else if (data.typeName === 'UgeeCancel') {
                updateStatus('Operación cancelada.');
            } else if (data.typeName === 'UgeeClear') {
                signedImageBase64 = null;
                updateStatus('Firma borrada. Vuelve a firmar.');
            } else if (data.typeName === 'UgeeError') {
                if (data.message !== lastErrorMessage) { lastErrorMessage = data.message; updateStatus('Error: ' + data.message); console.error('UgeeError', data.message); }
            } else if (data.typeName === 'UgeeUnSign') {
                updateStatus('Operación no completada: ' + data.message);
            } else {
                console.log('Mensaje no gestionado:', data.typeName, data.message);
            }
        } catch (err) { console.error('WS parse error', err, event.data); }
    };

    websocket.onerror = (error) => { console.error('WebSocket error', error); updateStatus('Error de conexión WebSocket: comprueba que el servicio UGEE esté corriendo.'); };

    websocket.onclose = (evt) => {
        console.log('WebSocket cerrado', evt);
        if (signBtn) signBtn.disabled = true;
        if (fingerprintBtn) fingerprintBtn.disabled = true;
        if (signFingerBtn) signFingerBtn.disabled = true;
        if (reconnectAttempts < MAX_RECONNECT) {
            const delay = Math.min(5000 * Math.pow(2, reconnectAttempts), 60000);
            reconnectAttempts++;
            updateStatus('Conexión perdida. Reintentando en ' + Math.round(delay/1000) + 's');
            setTimeout(connectWebSocket, delay);
        } else {
            updateStatus('No se pudo reconectar al servicio UGEE después de varios intentos.');
        }
    };
}

if (connectBtn) connectBtn.addEventListener('click', () => connectWebSocket());

// Descargar Server SDK
if (downloadSdkBtn) downloadSdkBtn.addEventListener('click', () => {
    updateStatus('Iniciando descarga del Server SDK...');
    const a = document.createElement('a');
    a.href = DOWNLOAD_SDK_URL;
    a.target = '_blank';
    a.rel = 'noopener'
    try {
        a.download = 'ugee-server-sdk.zip';
    } catch (e) {}
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => updateStatus('Si la descarga no se inició, contactese con soporte tecnico'), 1500);
});


if (prevPageBtn) prevPageBtn.addEventListener('click', () => { if (currentPage>1){ currentPage--; renderPdfPage(currentPage); } });
if (nextPageBtn) nextPageBtn.addEventListener('click', () => { if (currentPage<totalPages){ currentPage++; renderPdfPage(currentPage); } });
if (goPageBtn && pageNumberInput) goPageBtn.addEventListener('click', () => {
    const target = parseInt(pageNumberInput.value,10);
    if (!isNaN(target) && target>=1 && target<=totalPages) { currentPage = target; renderPdfPage(currentPage); }
});


if (signBtn) signBtn.addEventListener('click', () => {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) { updateStatus('Conecta primero a la tableta.'); return; }
    const messageStr = '{"typeName": "UgeeStartSign", "message": {"penwidth": "5"}}';
    websocket.send(messageStr);
    updateStatus('Iniciando firma...');
});


if (fingerprintBtn) fingerprintBtn.addEventListener('click', () => {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) { updateStatus('Conecta primero a la tableta.'); return; }
    updateStatus('Iniciando captura de huella...');
    const startFingerMessage = '{"typeName": "UgeeStartFinger", "message": {"quality": "50"}}';
    websocket.send(startFingerMessage);
    setTimeout(() => { const getTemplateMessage = '{"typeName": "UgeeGetISOTemplate"}'; websocket.send(getTemplateMessage); }, 500);
});


if (signFingerBtn) signFingerBtn.addEventListener('click', () => {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) { updateStatus('Conecta primero a la tableta.'); return; }
    const messageStr = '{"typeName": "UgeeStartSignFinger", "message": {"penwidth": "5", "quality": "50"}}';
    websocket.send(messageStr);
    updateStatus('Iniciando firma y huella combinadas...');
});
const pdfCanvasEl = document.getElementById('pdfCanvas');
if (pdfCanvasEl) {
    function findSignatureAt(canvasX, canvasY, pageNumber) {
        const radiusCss = 36; // tamaño de selección aproximado en CSS pixels
        for (let i = signatures.length - 1; i >= 0; i--) {
            const s = signatures[i];
            if ((s.page || currentPage) !== pageNumber) continue;
            const vpW = s.viewportWidth && s.viewportWidth > 0 ? s.viewportWidth : pdfCanvasEl.width;
            const vpH = s.viewportHeight && s.viewportHeight > 0 ? s.viewportHeight : pdfCanvasEl.height;
            const sigX = (typeof s.clickX === 'number') ? (s.clickX / vpW) * pdfCanvasEl.width : (pdfCanvasEl.width / 2);
            const sigY = (typeof s.clickY === 'number') ? (s.clickY / vpH) * pdfCanvasEl.height : (pdfCanvasEl.height / 2);
            const scaleFactor = pdfCanvasEl.width / vpW;
            const radius = radiusCss * scaleFactor;
            const dx = canvasX - sigX;
            const dy = canvasY - sigY;
            if (Math.sqrt(dx*dx + dy*dy) <= radius) return i;
        }
        return -1;
    }

    function findHandleAt(canvasX, canvasY, pageNumber) {
        const handleSize = 12; // pixels
        for (let i = signatures.length - 1; i >= 0; i--) {
            const s = signatures[i];
            if ((s.page || currentPage) !== pageNumber) continue;
            if (!s.imageBase64) continue;
            const vpW = s.viewportWidth && s.viewportWidth > 0 ? s.viewportWidth : pdfCanvasEl.width;
            const vpH = s.viewportHeight && s.viewportHeight > 0 ? s.viewportHeight : pdfCanvasEl.height;
            const normX = (typeof s.clickX === 'number') ? (s.clickX / vpW) : 0.5;
            const normY = (typeof s.clickY === 'number') ? (s.clickY / vpH) : 0.5;
            const centerX = normX * pdfCanvasEl.width;
            const centerY = normY * pdfCanvasEl.height;
            let scaledW = (s._normWidth && s._normWidth > 0) ? (s._normWidth * pdfCanvasEl.width) : (pdfCanvasEl.width * (s.isCombinedImage ? 0.45 : (s.isFingerprintImage ? 0.08 : 0.25)));
            let scaledH = (s._normHeight && s._normHeight > 0) ? (s._normHeight * pdfCanvasEl.height) : (pdfCanvasEl.height * (s.isCombinedImage ? 0.35 : (s.isFingerprintImage ? 0.16 : 0.12)));
            const drawX = centerX - (scaledW / 2);
            const drawY = centerY - (scaledH / 2);
            // corners
            const corners = {
                nw: { x: drawX, y: drawY },
                ne: { x: drawX + scaledW, y: drawY },
                sw: { x: drawX, y: drawY + scaledH },
                se: { x: drawX + scaledW, y: drawY + scaledH }
            };
            for (const h of ['nw','ne','sw','se']) {
                const cx = corners[h].x;
                const cy = corners[h].y;
                const dx = canvasX - cx;
                const dy = canvasY - cy;
                if (Math.abs(dx) <= handleSize && Math.abs(dy) <= handleSize) return { index: i, handle: h };
            }
        }
        return null;
    }

    pdfCanvasEl.addEventListener('mousedown', async (e) => {
        const rect = pdfCanvasEl.getBoundingClientRect();
        const clickX_css = e.clientX - rect.left;
        const clickY_css = e.clientY - rect.top;
        const scaleX = pdfCanvasEl.width / rect.width;
        const scaleY = pdfCanvasEl.height / rect.height;
        const canvasX = clickX_css * scaleX;
        const canvasY = clickY_css * scaleY;

        // ¿Se hizo click sobre una manilla de redimensionado?
        const handleHit = findHandleAt(canvasX, canvasY, currentPage);
        if (handleHit && handleHit.index >= 0) {
            // iniciar redimensionado
            isResizing = true;
            resizeHandle = handleHit.handle;
            resizeSigIndex = handleHit.index;
            resizeStart = { x: canvasX, y: canvasY };
            const s = signatures[resizeSigIndex];
            // guardar tamaño original en píxeles
            s._origPixelW = (s._normWidth && s._normWidth > 0) ? (s._normWidth * pdfCanvasEl.width) : (s.viewportWidth ? s.viewportWidth : pdfCanvasEl.width * 0.25);
            s._origPixelH = (s._normHeight && s._normHeight > 0) ? (s._normHeight * pdfCanvasEl.height) : (s.viewportHeight ? s.viewportHeight : pdfCanvasEl.height * 0.12);
            updateStatus('Redimensionando firma...');
            return;
        }

        const foundIdx = findSignatureAt(canvasX, canvasY, currentPage);
        if (foundIdx !== -1) {
            selectedSignatureIndex = foundIdx;
            isDraggingSignature = true;
            const s = signatures[foundIdx];
            const vpW = s.viewportWidth && s.viewportWidth > 0 ? s.viewportWidth : pdfCanvasEl.width;
            const vpH = s.viewportHeight && s.viewportHeight > 0 ? s.viewportHeight : pdfCanvasEl.height;
            const sigX = (typeof s.clickX === 'number') ? (s.clickX / vpW) * pdfCanvasEl.width : (pdfCanvasEl.width / 2);
            const sigY = (typeof s.clickY === 'number') ? (s.clickY / vpH) * pdfCanvasEl.height : (pdfCanvasEl.height / 2);
            dragOffset.x = canvasX - sigX;
            dragOffset.y = canvasY - sigY;
            drawAllSignaturesOnCanvas(currentPage);
            updateSignaturesList();
            return;
        }

        if (!isPlacingSignature || !signedImageBase64) return;
        const sig = {
            id: 'sig_' + (sigCounter++),
            imageBase64: signedImageBase64,
            isFingerprintImage: !!isFingerprintImage,
            isCombinedImage: !!isCombinedImage,
            clickX: canvasX,
            clickY: canvasY,
            viewportWidth: pdfCanvasEl.width,
            viewportHeight: pdfCanvasEl.height,
            page: currentPage
        };
        signatures.push(sig);
        isPlacingSignature = false;
        signedImageBase64 = null;
        isFingerprintImage = false;
        isCombinedImage = false;
        await awaitDrawAllSignaturesForPage(currentPage);
        updateStatus(`Firma colocada (${signatures.length}). Para colocar otra, inicia una nueva firma.`);
        updateSignaturesList();
    });

    window.addEventListener('mousemove', (e) => {
        const rect = pdfCanvasEl.getBoundingClientRect();
        const moveX_css = e.clientX - rect.left;
        const moveY_css = e.clientY - rect.top;
        const scaleX = pdfCanvasEl.width / rect.width;
        const scaleY = pdfCanvasEl.height / rect.height;
        const canvasX = moveX_css * scaleX;
        const canvasY = moveY_css * scaleY;

        // Manejar redimensionado si está activo
        if (isResizing && resizeSigIndex >= 0 && signatures[resizeSigIndex]) {
            const s = signatures[resizeSigIndex];
            const origW = s._origPixelW || (s._normWidth ? s._normWidth * pdfCanvasEl.width : pdfCanvasEl.width * 0.2);
            const origH = s._origPixelH || (s._normHeight ? s._normHeight * pdfCanvasEl.height : pdfCanvasEl.height * 0.12);
            const deltaX = canvasX - resizeStart.x;
            const deltaY = canvasY - resizeStart.y;
            let newW = origW;
            let newH = origH;
            switch (resizeHandle) {
                case 'se': newW = Math.max(10, origW + deltaX); newH = Math.max(10, origH + deltaY); break;
                case 'ne': newW = Math.max(10, origW + deltaX); newH = Math.max(10, origH - deltaY); break;
                case 'nw': newW = Math.max(10, origW - deltaX); newH = Math.max(10, origH - deltaY); break;
                case 'sw': newW = Math.max(10, origW - deltaX); newH = Math.max(10, origH + deltaY); break;
                default: newW = Math.max(10, origW + deltaX); newH = Math.max(10, origH + deltaY); break;
            }
            // Mantener proporción si Shift está presionado
            if (e.shiftKey) {
                const aspect = origW / (origH || 1);
                if (newW / newH > aspect) {
                    newW = newH * aspect;
                } else {
                    newH = newW / (aspect || 1);
                }
            }
            // Clamp a límites razonables
            const maxW = pdfCanvasEl.width * 0.95;
            const maxH = pdfCanvasEl.height * 0.95;
            newW = Math.min(maxW, Math.max(8, newW));
            newH = Math.min(maxH, Math.max(8, newH));

            s._normWidth = newW / pdfCanvasEl.width;
            s._normHeight = newH / pdfCanvasEl.height;
            s.viewportWidth = pdfCanvasEl.width;
            s.viewportHeight = pdfCanvasEl.height;
            drawAllSignaturesOnCanvas(currentPage);
            updateSignaturesList();
            return;
        }

        if (!isDraggingSignature || selectedSignatureIndex < 0) return;
        const canvasXDrag = canvasX;
        const canvasYDrag = canvasY;
        signatures[selectedSignatureIndex].clickX = canvasXDrag - dragOffset.x;
        signatures[selectedSignatureIndex].clickY = canvasYDrag - dragOffset.y;
        signatures[selectedSignatureIndex].viewportWidth = pdfCanvasEl.width;
        signatures[selectedSignatureIndex].viewportHeight = pdfCanvasEl.height;
        
        drawAllSignaturesOnCanvas(currentPage);
        updateSignaturesList();
    });

    window.addEventListener('mouseup', (e) => {
        if (isDraggingSignature) {
            isDraggingSignature = false;
            updateStatus('Firma movida.');
        }
        if (isResizing) {
            isResizing = false;
            resizeHandle = null;
            resizeSigIndex = -1;
            updateStatus('Redimensionado completado.');
        }
    });

    window.addEventListener('keydown', (e) => {
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        // Delete / Backspace: eliminar firma seleccionada
        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedSignatureIndex >= 0) {
            signatures.splice(selectedSignatureIndex, 1);
            selectedSignatureIndex = -1;
            drawAllSignaturesOnCanvas(currentPage);
            updateSignaturesList();
            updateStatus('Firma eliminada.');
            return;
        }

        // '+' o '=' para agrandar, '-' para reducir (cuando hay firma seleccionada)
        if (selectedSignatureIndex >= 0) {
            const s = signatures[selectedSignatureIndex];
            const scaleUpKeys = ['+', '=', 'Add'];
            const scaleDownKeys = ['-', '_', 'Subtract'];
            if (scaleUpKeys.includes(e.key)) {
                if (!s._normWidth || !s._normHeight) { s._normWidth = s._normWidth || 0.20; s._normHeight = s._normHeight || 0.20; }
                s._normWidth = Math.min(0.95, s._normWidth * 1.15);
                s._normHeight = s._normHeight ? Math.min(0.95, s._normHeight * 1.15) : null;
                drawAllSignaturesOnCanvas(currentPage);
                updateSignaturesList();
                updateStatus('Firma agrandada.');
                e.preventDefault();
                return;
            }
            if (scaleDownKeys.includes(e.key)) {
                if (!s._normWidth || !s._normHeight) { s._normWidth = s._normWidth || 0.20; s._normHeight = s._normHeight || 0.20; }
                s._normWidth = Math.max(0.02, s._normWidth * 0.87);
                s._normHeight = s._normHeight ? Math.max(0.02, s._normHeight * 0.87) : null;
                drawAllSignaturesOnCanvas(currentPage);
                updateSignaturesList();
                updateStatus('Firma reducida.');
                e.preventDefault();
                return;
            }
        }
    });
}


async function awaitDrawAllSignaturesForPage(pageNumber) {
    await renderPdfPage(pageNumber);
    drawAllSignaturesOnCanvas(pageNumber);
}

function drawAllSignaturesOnCanvas(pageNumber) {
    if (!Array.isArray(signatures)) return;
    if (!context || !pdfCanvasEl) return;
    const rect = pdfCanvasEl.getBoundingClientRect();
        const scaleCanvasX = pdfCanvasEl.width / rect.width;
        const scaleCanvasY = pdfCanvasEl.height / rect.height;
    if (canvasBackgroundImageData && canvas.width === canvasBackgroundImageData.width && canvas.height === canvasBackgroundImageData.height) {
        context.putImageData(canvasBackgroundImageData, 0, 0);
    } else {
        context.clearRect(0, 0, pdfCanvasEl.width, pdfCanvasEl.height);
    }
    for (let i = 0; i < signatures.length; i++) {
        const s = signatures[i];
        if ((s.page || currentPage) !== pageNumber) continue;
        if (!s.imageBase64) continue;
        const img = new Image();
        ((idx, sig) => {
            img.onload = () => {
                const naturalW = img.naturalWidth || img.width;
                const naturalH = img.naturalHeight || img.height;
                const desiredMaxPreview = {
                    width: sig.isFingerprintImage ? 80 : (sig.isCombinedImage ? 300 : 200),
                    height: sig.isFingerprintImage ? 160 : (sig.isCombinedImage ? 240 : 100)
                };
                const maxUpscale = sig.isCombinedImage ? 1.8 : 1.0;
                const fitScale = Math.min(desiredMaxPreview.width / naturalW, desiredMaxPreview.height / naturalH, maxUpscale);
                const displayWidthCss = naturalW * fitScale;
                const displayHeightCss = naturalH * fitScale;
                const scaledAdjustX = PREVIEW_ADJUST_X * scaleCanvasX;
                const scaledAdjustY = PREVIEW_ADJUST_Y * scaleCanvasY;
                // Determinar tamaño en pixels del buffer actual.
                let scaledSigWidth, scaledSigHeight;
                if (sig._normWidth && sig._normHeight) {
                    // Si ya tenemos el tamaño normalizado guardado, úsalo para escalar proporcionalmente
                    scaledSigWidth = sig._normWidth * pdfCanvasEl.width;
                    scaledSigHeight = sig._normHeight * pdfCanvasEl.height;
                } else {
                    // calcular tamaño en este render y guardar la fracción relativa para futuros renders
                    scaledSigWidth = displayWidthCss * scaleCanvasX;
                    scaledSigHeight = displayHeightCss * scaleCanvasY;
                    try {
                        sig._normWidth = scaledSigWidth / pdfCanvasEl.width;
                        sig._normHeight = scaledSigHeight / pdfCanvasEl.height;
                    } catch (e) {
                        sig._normWidth = null;
                        sig._normHeight = null;
                    }
                }
                // Calcular posición actual a partir de coordenadas normalizadas en el viewport registrado
                const vpW = sig.viewportWidth && sig.viewportWidth > 0 ? sig.viewportWidth : pdfCanvasEl.width;
                const vpH = sig.viewportHeight && sig.viewportHeight > 0 ? sig.viewportHeight : pdfCanvasEl.height;
                const normX = (typeof sig.clickX === 'number') ? (sig.clickX / vpW) : 0.5;
                const normY = (typeof sig.clickY === 'number') ? (sig.clickY / vpH) : 0.5;
                const drawX = (normX * pdfCanvasEl.width) - (scaledSigWidth / 2) + scaledAdjustX;
                const drawY = (normY * pdfCanvasEl.height) - (scaledSigHeight / 2) + scaledAdjustY;
                context.drawImage(img, drawX, drawY, scaledSigWidth, scaledSigHeight);
                
                if (idx === selectedSignatureIndex) {
                    context.save();
                    context.strokeStyle = '#ff5722';
                    context.lineWidth = 2;
                    context.strokeRect(drawX - 4, drawY - 4, scaledSigWidth + 8, scaledSigHeight + 8);
                    // dibujar manillas en las esquinas
                    const handleSz = Math.max(8, Math.floor(12));
                    const corners = [
                        { x: drawX, y: drawY, name: 'nw' },
                        { x: drawX + scaledSigWidth, y: drawY, name: 'ne' },
                        { x: drawX, y: drawY + scaledSigHeight, name: 'sw' },
                        { x: drawX + scaledSigWidth, y: drawY + scaledSigHeight, name: 'se' }
                    ];
                    for (const c of corners) {
                        context.fillStyle = '#ffffff';
                        context.strokeStyle = (isResizing && resizeSigIndex === idx) ? '#ff9800' : '#222222';
                        context.lineWidth = 1;
                        context.beginPath();
                        context.rect(c.x - (handleSz/2), c.y - (handleSz/2), handleSz, handleSz);
                        context.fill();
                        context.stroke();
                    }
                    context.restore();
                }
            };
            img.onerror = () => console.warn('No se pudo cargar imagen de firma para preview');
            img.src = sig.imageBase64 && sig.imageBase64.startsWith('data:') ? sig.imageBase64 : ('data:image/png;base64,' + sig.imageBase64);
        })(i, s);
    }
}


function updateSignaturesList() {
    const listEl = document.getElementById('signaturesList');
    if (!listEl) return;
    listEl.innerHTML = '';
    signatures.forEach((s, idx) => {
        if (!s.id) s.id = 'sig_' + (sigCounter++);
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.justifyContent = 'space-between';
        item.style.padding = '6px 4px';
        item.style.borderBottom = '1px solid #eef2ff';
        const left = document.createElement('div');
        left.style.fontSize = '13px';
        left.style.color = '#0f172a';
        left.textContent = `Firma ${idx+1} • Página ${s.page || currentPage}`;
        const right = document.createElement('div');
        right.style.display = 'flex';
        right.style.gap = '6px';
        const btnSelect = document.createElement('button'); btnSelect.className = 'btn'; btnSelect.style.padding = '6px 8px'; btnSelect.textContent = 'Editar';
        btnSelect.addEventListener('click', () => {
            const curIdx = signatures.findIndex(x => x.id === s.id);
            if (curIdx === -1) return;
            selectedSignatureIndex = curIdx;
            isDraggingSignature = true;
            dragOffset.x = 0; dragOffset.y = 0;
            drawAllSignaturesOnCanvas(s.page || currentPage);
            updateStatus(`Editando firma ${idx+1} — Página ${s.page || currentPage} • x:${Math.round(s.clickX)} y:${Math.round(s.clickY)}`);
        });
        const btnDel = document.createElement('button'); btnDel.className = 'btn secondary'; btnDel.style.padding = '6px 8px'; btnDel.textContent = 'Eliminar';
        btnDel.addEventListener('click', () => {
            const curIdx = signatures.findIndex(x => x.id === s.id);
            if (curIdx === -1) return;
            signatures.splice(curIdx,1);
            if (selectedSignatureIndex === curIdx) selectedSignatureIndex = -1;
            drawAllSignaturesOnCanvas(currentPage);
            updateSignaturesList();
            updateStatus('Firma eliminada.');
        });
        right.appendChild(btnSelect); right.appendChild(btnDel);
        item.appendChild(left); item.appendChild(right);
        listEl.appendChild(item);
    });
    // Actualizar estado del botón Limpiar
    try {
        const clearBtn = document.getElementById('clearSigsBtn');
        if (clearBtn) clearBtn.disabled = (signatures.length === 0);
    } catch (e) {}
}

// Botón Limpiar: elimina la firma seleccionada, o si no hay selección, pregunta y elimina todas
if (clearSigsBtn) {
    clearSigsBtn.addEventListener('click', () => {
        if (selectedSignatureIndex >= 0 && signatures[selectedSignatureIndex]) {
            signatures.splice(selectedSignatureIndex, 1);
            selectedSignatureIndex = -1;
            isDraggingSignature = false;
            drawAllSignaturesOnCanvas(currentPage);
            updateSignaturesList();
            updateStatus('Firma seleccionada eliminada.');
            return;
        }
        if (!signatures || signatures.length === 0) {
            updateStatus('No hay firmas para limpiar.');
            return;
        }
        if (window.confirm && window.confirm('¿Eliminar todas las firmas colocadas en el documento?')) {
            signatures = [];
            selectedSignatureIndex = -1;
            isDraggingSignature = false;
            drawAllSignaturesOnCanvas(currentPage);
            updateSignaturesList();
            updateStatus('Todas las firmas eliminadas.');
        }
    });
}


const finishPlacementBtn = document.getElementById('finishPlacementBtn');
if (finishPlacementBtn) finishPlacementBtn.addEventListener('click', async () => {
    isPlacingSignature = false;
    selectedSignatureIndex = -1;
    isDraggingSignature = false;

    await awaitDrawAllSignaturesForPage(currentPage);
    updateSignaturesList();
    updateStatus('Modo de colocación finalizado.');
});


if (downloadBtn) downloadBtn.addEventListener('click', async () => {
    if (!pdfDoc || !Array.isArray(signatures) || signatures.length === 0) { updateStatus('Carga un PDF y coloca al menos una firma antes de descargar.'); return; }
    if (signedFingerTemplate) console.log('Plantilla de huella lista', signedFingerTemplate);
    updateStatus('Insertando firmas en PDF...');
    try {
        const embedCache = {};
        
        for (const s of signatures) {
            try {
                const dataUrl = s.imageBase64 && s.imageBase64.startsWith('data:') ? s.imageBase64 : ('data:image/png;base64,' + s.imageBase64);
                const base64Str = dataUrl.replace(/^data:image\/(png|jpeg);base64,/, '');
                const imageBytes = Uint8Array.from(atob(base64Str), c => c.charCodeAt(0));
                
                const cacheKey = base64Str;
                let embeddedImage = embedCache[cacheKey];
                if (!embeddedImage) {
                    embeddedImage = await pdfDoc.embedPng(imageBytes);
                    embedCache[cacheKey] = embeddedImage;
                }

                const pageIndex = Math.max(0, Math.min((s.page ? s.page - 1 : currentPage - 1), pdfDoc.getPageCount() - 1));
                const page = pdfDoc.getPage(pageIndex);
                const { width: pdfWidth, height: pdfHeight } = page.getSize();

                const aspect = (embeddedImage.width && embeddedImage.height) ? (embeddedImage.width / embeddedImage.height) : 1;

            
                let finalWidth = FINAL_SIG_WIDTH_PT;
                let finalHeight = FINAL_SIG_HEIGHT_PT;
                if (s.isFingerprintImage) {
                    finalWidth = FINAL_FINGER_WIDTH_PT;
                    finalHeight = FINAL_FINGER_HEIGHT_PT;
                } else if (s.isCombinedImage) {
                    finalWidth = COMBINED_FINAL_MAX_WIDTH_PT;
                    finalHeight = finalWidth / aspect;
                    if (finalHeight > COMBINED_FINAL_MAX_HEIGHT_PT) {
                        finalHeight = COMBINED_FINAL_MAX_HEIGHT_PT;
                        finalWidth = finalHeight * aspect;
                    }
                } else {
                    finalWidth = FINAL_SIG_WIDTH_PT;
                    finalHeight = finalWidth / aspect;
                    if (finalHeight > FINAL_SIG_HEIGHT_PT) {
                        finalHeight = FINAL_SIG_HEIGHT_PT;
                        finalWidth = finalHeight * aspect;
                    }
                }

                // Ajustar tamaño final según el tamaño normalizado que tenga la firma en el canvas (si el usuario la redimensionó)
                try {
                    const baseNorm = s.isFingerprintImage ? 0.08 : (s.isCombinedImage ? 0.45 : 0.20);
                    const norm = (s._normWidth && s._normWidth > 0) ? s._normWidth : baseNorm;
                    const scaleFactor = (norm / baseNorm) || 1;
                    finalWidth = finalWidth * scaleFactor;
                    finalHeight = finalHeight * scaleFactor;
                } catch (e) {}

            
                const vpW = s.viewportWidth || (currentViewport ? currentViewport.width : pdfCanvasEl.width);
                const vpH = s.viewportHeight || (currentViewport ? currentViewport.height : pdfCanvasEl.height);
                const xNormalized = s.clickX / vpW;
                const yNormalized = s.clickY / vpH;
                const pdfClickX = xNormalized * pdfWidth;
                const pdfClickY = pdfHeight - (yNormalized * pdfHeight);
                const finalX = pdfClickX - (finalWidth / 2) + (PREVIEW_ADJUST_X || 0);
                let finalY = pdfClickY - (finalHeight / 2) + (PREVIEW_ADJUST_Y || 0);

                const clampedX = Math.max(0, Math.min(finalX, pdfWidth - finalWidth));
                const clampedY = Math.max(0, Math.min(finalY, pdfHeight - finalHeight));

                page.drawImage(embeddedImage, { x: clampedX, y: clampedY, width: finalWidth, height: finalHeight });
                const fechaID = await obtenerIDReal();
                page.drawText(`ID: ${fechaID}`,{
                    x: clampedX,
                    y: clampedY -5,
                    size: 8,
                    color: PDFLib.rgb(0, 0, 0)
                });
            } catch (innerErr) { console.error('Error al insertar firma individual:', innerErr); }
        }

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'pdf_firmado.pdf'; a.click(); URL.revokeObjectURL(url);
        updateStatus('PDF firmado descargado.');
            
        signatures = [];
        signedImageBase64 = null; isFingerprintImage = false; isCombinedImage = false; signaturePosition = { x:100, y:100 }; isPlacingSignature = false;
    } catch (err) { updateStatus('Error al firmar PDF: ' + (err && err.message ? err.message : err)); console.error(err); }
});

window.addEventListener('beforeunload', () => { if (websocket) { websocket.send('{"typeName": "UgeeCloseSocket"}'); websocket.close(); } });
