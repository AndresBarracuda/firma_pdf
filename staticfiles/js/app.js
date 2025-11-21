let websocket;
let pdfDoc;
let pdfJsDoc;
let signedImageBase64 = null;
let isPlacingSignature = false;
let signaturePosition = { x: 100, y: 100 };
let canvas, context;
let currentViewport;

// --- CAMBIO PARA HUELLA ---
let signedFingerTemplate = null; // Variable para almacenar la plantilla (ANSI/ISO) o Base64 si lo proporciona el SDK.
let lastErrorMessage = ""; // Para evitar mostrar el mismo error dos veces

// Elementos DOM
const pdfInput = document.getElementById('pdfInput');
const connectBtn = document.getElementById('connectBtn');
const signBtn = document.getElementById('signBtn');
const downloadBtn = document.getElementById('downloadBtn');
const statusDiv = document.getElementById('status');
// --- CAMBIO PARA HUELLA ---
const fingerprintBtn = document.getElementById('fingerprintBtn');
// --- NUEVO: Botón para firma y huella combinadas ---
const signFingerBtn = document.getElementById('signFingerBtn');

// Comprobaciones iniciales de elementos DOM y estados
if (!connectBtn) console.warn('Advertencia: elemento `connectBtn` no encontrado en el DOM.');
if (signBtn) signBtn.disabled = true;
if (fingerprintBtn) fingerprintBtn.disabled = true;
if (signFingerBtn) signFingerBtn.disabled = true;
if (downloadBtn) downloadBtn.disabled = true;

// *** CONSTANTES DE POSICIONAMIENTO NORMALIZADO ***
const FINAL_SIG_WIDTH_PT = 140;
const FINAL_SIG_HEIGHT_PT = 70;
const RENDER_SCALE = 1.5;

// *** CONSTANTES DE AJUSTE DE TINTA (EN PÍXELES DE PREVIEW) ***
const PREVIEW_ADJUST_X = 70;
const PREVIEW_ADJUST_Y = 135;

// *** CONSTANTES PARA HUELLA ***
const FINAL_FINGER_WIDTH_PT = 45;
const FINAL_FINGER_HEIGHT_PT = 90;
let isFingerprintImage = false; // Para distinguir si la imagen actual es huella o firma
let isCombinedImage = false; // Para firma + huella combinadas
async function processImageToBlack(base64) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                // Cambiar píxeles rojos (r alto, g y b bajos) a negro
                if (r > 50 && g < 100 && b < 100) {
                    data[i] = 0;     // R
                    data[i + 1] = 0; // G
                    data[i + 2] = 0; // B
                }
            }
            
            ctx.putImageData(imageData, 0, 0);
            const processedBase64 = canvas.toDataURL('image/png');
            resolve(processedBase64);
        };
        img.src = 'data:image/png;base64,' + base64.replace(/^data:image\/png;base64,/, '');
    });
}

function updateStatus(message) {
    statusDiv.textContent = message;
}

// Cargar PDF (Sin cambios)
pdfInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    updateStatus("Cargando PDF...");
    try {
        const arrayBuffer = await file.arrayBuffer();
        pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
       
        pdfjsLib.GlobalWorkerOptions.workerSrc = '//cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
       
        pdfJsDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        await renderPdfPage(1);
        updateStatus("PDF cargado. Conecta la tableta y firma.");
        downloadBtn.disabled = false;
    } catch (error) {
        updateStatus("Error al cargar PDF: " + error.message);
    }
});

// Renderizar página (Sin cambios)
async function renderPdfPage(pageNum) {
    const page = await pdfJsDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    currentViewport = viewport;

    canvas = document.getElementById('pdfCanvas');
    context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    const renderContext = {
        canvasContext: context,
        viewport: viewport
    };
    await page.render(renderContext).promise;
}

// Conectar WebSocket con lógica de reintento
const WS_URI = "ws://127.0.0.1:10001/";
let reconnectAttempts = 0;
const MAX_RECONNECT = 6;

function connectWebSocket() {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        updateStatus('Ya conectado.');
        return;
    }

    updateStatus('Abriendo conexión WebSocket...');
    console.log('Intentando conectar a', WS_URI, 'intento', reconnectAttempts + 1);

    websocket = new WebSocket(WS_URI);

    const openTimeout = setTimeout(() => {
        updateStatus('No se pudo conectar: tiempo de espera agotado.');
        websocket && websocket.close();
    }, 5000);

    websocket.onopen = (evt) => {
        clearTimeout(openTimeout);
        reconnectAttempts = 0;
        console.log('WebSocket abierto', evt);
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
                isFingerprintImage = false; // Es firma, no huella
                updateStatus('Firma capturada. Haz clic en el PDF para posicionarla.');
                isPlacingSignature = true;
            } else if (data.typeName === 'UgeeFingerBase64') {
                // Procesar imagen de huella a color negro
                processImageToBlack(data.message).then(processedBase64 => {
                    signedImageBase64 = processedBase64;
                    isFingerprintImage = true;
                    updateStatus('Huella capturada. Haz clic en el PDF para posicionarla.');
                    isPlacingSignature = true;
                });
            } else if (data.typeName === 'UgeeSignFBase64') {
                // Procesar imagen combinada para convertir huella roja a negra
                processImageToBlack(data.message).then(processedBase64 => {
                    signedImageBase64 = processedBase64;
                    isFingerprintImage = false;
                    isCombinedImage = true; // Firma + huella combinadas
                    updateStatus('Firma y huella combinadas capturadas. Haz clic en el PDF para posicionarlas.');
                    isPlacingSignature = true;
                });
            } else if (data.typeName === 'UgeeOk' || data.typeName === 'UgeeOK') {
                updateStatus('Operación confirmada.');
            } else if (data.typeName === 'UgeeCancel') {
                updateStatus('Operación cancelada.');
            } else if (data.typeName === 'UgeeClear') {
                updateStatus('Firma borrada. Vuelve a firmar.');
                signedImageBase64 = null;
            } else if (data.typeName === 'UgeeError') {
                if (data.message !== lastErrorMessage) {
                    updateStatus('Error del dispositivo: ' + data.message);
                    console.error('UgeeError:', data.message);
                    lastErrorMessage = data.message;
                }
            } else if (data.typeName === 'UgeeUnSign') {
                updateStatus('Operación de firma no completada: ' + data.message);
            } else {
                console.log('Mensaje no gestionado:', data.typeName, data.message);
            }
        } catch (err) {
            console.error('Error parsing WS message', err, event.data);
        }
    };

    websocket.onerror = (error) => {
        console.error('WebSocket error', error);
        updateStatus('Error de conexión WebSocket: comprueba que el servicio UGEE esté corriendo.');
    };

    websocket.onclose = (evt) => {
        clearTimeout(openTimeout);
        console.log('WebSocket cerrado', evt);
        if (signBtn) signBtn.disabled = true;
        if (fingerprintBtn) fingerprintBtn.disabled = true;
        if (signFingerBtn) signFingerBtn.disabled = true;

        // Intentar reconectar con backoff exponencial
        if (reconnectAttempts < MAX_RECONNECT) {
            const delay = Math.min(5000 * Math.pow(2, reconnectAttempts), 60000);
            reconnectAttempts++;
            updateStatus('Conexión perdida. Reintentando en ' + Math.round(delay/1000) + 's (intento ' + reconnectAttempts + '/' + MAX_RECONNECT + ')');
            console.log('Reintentando conexión en', delay, 'ms');
            setTimeout(connectWebSocket, delay);
        } else {
            updateStatus('No se pudo reconectar al servicio UGEE después de varios intentos.');
        }
    };
}

if (connectBtn) {
    connectBtn.addEventListener('click', () => connectWebSocket());
} else {
    console.warn('connectBtn no existe: no se añadió el listener de conexión.');
}

// Iniciar firma (Sin cambios)
signBtn.addEventListener('click', () => {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
        updateStatus("Conecta primero a la tableta.");
        return;
    }

    const messageStr = '{"typeName": "UgeeStartSign", "message": {"penwidth": "5"}}';
    websocket.send(messageStr);
    updateStatus("Iniciando firma...");
});

// --- CAMBIO PARA HUELLA: Iniciar captura de Huella ---
fingerprintBtn.addEventListener('click', () => {
if (!websocket || websocket.readyState !== WebSocket.OPEN) {
updateStatus("Conecta primero a la tableta.");
return;
}

updateStatus("Iniciando captura de huella...");

// Comando para iniciar solo huella (según demo y documentación SDK)
const startFingerMessage = '{"typeName": "UgeeStartFinger", "message": {"quality": "50"}}';
websocket.send(startFingerMessage);
updateStatus("Coloque el dedo en el sensor.");

// Solicitamos la plantilla ISO después de un breve retraso
setTimeout(() => {
    const getTemplateMessage = '{"typeName": "UgeeGetISOTemplate"}'; 
    websocket.send(getTemplateMessage);
}, 500);
});

// --- NUEVO: Iniciar firma y huella combinadas ---
if (signFingerBtn) {
    signFingerBtn.addEventListener('click', () => {
        if (!websocket || websocket.readyState !== WebSocket.OPEN) {
            updateStatus("Conecta primero a la tableta.");
            return;
        }

        const messageStr = '{"typeName": "UgeeStartSignFinger", "message": {"penwidth": "5", "quality": "50"}}';
        websocket.send(messageStr);
        updateStatus("Iniciando firma y huella combinadas...");
    });
} else {
    console.warn('signFingerBtn no existe: no se añadió el listener de firma y huella combinadas.');
}

// Evento de clic en canvas (Sin cambios)
document.getElementById('pdfCanvas').addEventListener('click', (e) => {
    if (!isPlacingSignature || !signedImageBase64) {
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    signaturePosition.clickX = clickX;
    signaturePosition.clickY = clickY;

    drawSignaturePreview();
    updateStatus("Firma posicionada. Listo para descargar.");
    isPlacingSignature = false;
});

// Dibujar preview (Sin cambios, solo eliminamos el punto morado)
async function drawSignaturePreview() {
    if (!signedImageBase64 || !signaturePosition.clickX) {
        return;
    }

    await renderPdfPage(1);

    const img = new Image();
    let sigWidth, sigHeight;
    if (isFingerprintImage) {
        sigWidth = 68; // Más pequeña y vertical para huella
        sigHeight = 136;
    } else if (isCombinedImage) {
        sigWidth = 200; // Cuadrado para combinada
        sigHeight = 200;
    } else {
        sigWidth = 200;
        sigHeight = 100;
    }

    img.onload = async () => {
        const drawX = signaturePosition.clickX - (sigWidth / 2) + PREVIEW_ADJUST_X;
        const drawY = signaturePosition.clickY - (sigHeight / 2) + PREVIEW_ADJUST_Y;
       
        context.drawImage(img, drawX, drawY, sigWidth, sigHeight);
    };

    img.onerror = () => {
        updateStatus("Error: Firma no se pudo cargar como imagen.");
    };

    let cleanBase64 = signedImageBase64.replace(/^data:image\/png;base64,/, "");
    img.src = "data:image/png;base64," + cleanBase64;
}

// Descargar PDF (Sin cambios significativos, solo la lógica de firma)
downloadBtn.addEventListener('click', async () => {
    if (!pdfDoc || !signedImageBase64 || !signaturePosition.clickX) {
        updateStatus("Carga un PDF, captura una firma y colócala primero.");
        return;
    }
   
    // --- CAMBIO PARA HUELLA: Puedes añadir la lógica para gestionar la plantilla aquí ---
    if (signedFingerTemplate) {
        console.log("Plantilla de huella capturada y lista:", signedFingerTemplate);
        updateStatus(`PDF firmado. Plantilla de huella (${signedFingerTemplate.length} bytes) lista para enviar al servidor.`);
        // Si necesitas incluir la plantilla de huella en los metadatos del PDF, aquí iría la lógica.
    }

    updateStatus("Insertando firma en PDF...");

    try {
        const imageBytes = Uint8Array.from(atob(signedImageBase64.replace(/^data:image\/png;base64,/, "")), c => c.charCodeAt(0));
        const image = await pdfDoc.embedPng(imageBytes);

        const page = pdfDoc.getPage(0);
       
        const { width: pdfWidth, height: pdfHeight } = page.getSize();
       
        // 1. TAMAÑO DE LA FIRMA
        let signatureWidth, signatureHeight;
        if (isFingerprintImage) {
            signatureWidth = FINAL_FINGER_WIDTH_PT;
            signatureHeight = FINAL_FINGER_HEIGHT_PT;
        } else if (isCombinedImage) {
            signatureWidth = 140; // Cuadrado para combinada
            signatureHeight = 140;
        } else {
            signatureWidth = FINAL_SIG_WIDTH_PT;
            signatureHeight = FINAL_SIG_HEIGHT_PT;
        }
       
        // Dimensiones de la preview
        let sigWidthPreview, sigHeightPreview;
        if (isFingerprintImage) {
            sigWidthPreview = 68;
            sigHeightPreview = 136;
        } else if (isCombinedImage) {
            sigWidthPreview = 200;
            sigHeightPreview = 200;
        } else {
            sigWidthPreview = 200;
            sigHeightPreview = 100;
        }

        // 2. CONVERTIR COORDENADAS
        const xNormalized = signaturePosition.clickX / currentViewport.width;
        const yNormalized = signaturePosition.clickY / currentViewport.height;

        const pdfClickX = xNormalized * pdfWidth;
        const pdfClickY = pdfHeight - (yNormalized * pdfHeight);
       
        // 3. POSICIÓN FINAL - APLICAR CENTRADO Y AJUSTE CONVERTIDO
       
        const ratioX = signatureWidth / sigWidthPreview;
        const ratioY = signatureHeight / sigHeightPreview;

        const pdfAdjustX = PREVIEW_ADJUST_X * ratioX;
        const pdfAdjustY = PREVIEW_ADJUST_Y * ratioY;

        const finalX = pdfClickX - (signatureWidth / 2) + pdfAdjustX;
        const finalY = pdfClickY - (signatureHeight / 2) - pdfAdjustY;
       
        console.log("Posición final PDF (Ajustada):", { finalX, finalY, pdfAdjustX, pdfAdjustY });

        // DIBUJAR EN EL PDF
        page.drawImage(image, {
            x: finalX,
            y: finalY,
            width: signatureWidth,
            height: signatureHeight
        });

        const pdfBytes = await pdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = 'pdf_firmado.pdf';
        a.click();

        URL.revokeObjectURL(url);
        updateStatus("PDF firmado descargado.");
        
        // Resetear variables
        signedImageBase64 = null;
        isFingerprintImage = false;
        isCombinedImage = false;
        signaturePosition = { x: 100, y: 100 };
        isPlacingSignature = false;
    } catch (error) {
        updateStatus("Error al firmar PDF: " + error.message);
        console.error("Error detallado:", error);
    }
});

// Cerrar WebSocket (Sin cambios)
window.addEventListener('beforeunload', () => {
    if (websocket) {
        websocket.send('{"typeName": "UgeeCloseSocket"}');
        websocket.close();
    }
});