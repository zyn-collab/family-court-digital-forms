/* === Demo Features — Signature Pad, Selfie Capture, Image Validation, SMS Mock === */

window.MediaCapture = (function () {

  /* ─── SIGNATURE PAD ─────────────────────────────────────────────── */

  function initSignaturePad(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    let drawing = false;
    let paths = [];
    let currentPath = [];

    function resizeCanvas() {
      const rect = canvas.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = 200 * dpr;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = '200px';
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1a1a2e';
      redraw();
    }

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      const touch = e.touches ? e.touches[0] : e;
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top
      };
    }

    function startDraw(e) {
      e.preventDefault();
      drawing = true;
      currentPath = [getPos(e)];
    }

    function moveDraw(e) {
      if (!drawing) return;
      e.preventDefault();
      const pos = getPos(e);
      currentPath.push(pos);
      // smoother strokes — draw a quadratic curve through the
      // midpoint of the last two samples instead of straight segments
      const n = currentPath.length;
      if (n >= 3) {
        const p0 = currentPath[n - 3], p1 = currentPath[n - 2], p2 = currentPath[n - 1];
        const m0 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
        const m1 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        ctx.beginPath();
        ctx.lineCap = 'round';
        ctx.moveTo(m0.x, m0.y);
        ctx.quadraticCurveTo(p1.x, p1.y, m1.x, m1.y);
        ctx.stroke();
      } else if (n === 2) {
        ctx.beginPath();
        ctx.lineCap = 'round';
        ctx.moveTo(currentPath[0].x, currentPath[0].y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      }
    }

    function endDraw(e) {
      if (!drawing) return;
      drawing = false;
      if (currentPath.length > 0) {
        paths.push(currentPath);
        currentPath = [];
      }
      // Store data URL in hidden input
      const hiddenInput = document.getElementById(canvasId + '_data');
      if (hiddenInput) hiddenInput.value = canvas.toDataURL('image/png');
    }

    function redraw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Draw guide line
      const h = parseInt(canvas.style.height);
      ctx.save();
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(20, h * 0.75);
      ctx.lineTo(parseInt(canvas.style.width) - 20, h * 0.75);
      ctx.stroke();
      ctx.restore();
      // Redraw paths
      ctx.strokeStyle = '#1a1a2e';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([]);
      paths.forEach(path => {
        if (path.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) {
          ctx.lineTo(path[i].x, path[i].y);
        }
        ctx.stroke();
      });
    }

    function clear() {
      paths = [];
      currentPath = [];
      redraw();
      const hiddenInput = document.getElementById(canvasId + '_data');
      if (hiddenInput) hiddenInput.value = '';
    }

    function isEmpty() {
      return paths.length === 0;
    }

    function getDataURL() {
      return paths.length > 0 ? canvas.toDataURL('image/png') : '';
    }

    // Events
    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', moveDraw);
    canvas.addEventListener('mouseup', endDraw);
    canvas.addEventListener('mouseleave', endDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', moveDraw, { passive: false });
    canvas.addEventListener('touchend', endDraw);

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    return { clear, isEmpty, getDataURL, redraw, resize: resizeCanvas };
  }

  function renderSignaturePadHTML(fieldKey) {
    return `
    <div class="field-group signature-pad-group" data-key="${fieldKey}">
      <label class="field-label">
        <span class="required-mark">*</span>
        <span class="dv">ސޮއި</span>
        <span class="en" hidden> — Signature</span>
      </label>
      <div class="signature-pad-wrapper">
        <canvas id="${fieldKey}_canvas" class="signature-canvas"></canvas>
        <input type="hidden" id="${fieldKey}_data" name="${fieldKey}">
        <div class="signature-pad-actions">
          <button type="button" class="btn-sm" onclick="window.MediaCapture.signaturePads['${fieldKey}'].clear()">
            <span class="dv">ފޮހެލާ</span>
            <span class="en" hidden>Clear</span>
          </button>
        </div>
      </div>
      <p class="field-hint"><span class="dv">މައުސް ނުވަތަ އިނގިލިން ސޮއިކުރައްވާ</span>
        <span class="en" hidden>Sign using mouse or finger</span></p>
      <div class="field-error" id="err_${fieldKey}"></div>
    </div>`;
  }

  // Store signature pad instances
  const signaturePads = {};


  /* ─── SELFIE CAPTURE ────────────────────────────────────────────── */

  function renderSelfieHTML(fieldKey) {
    return `
    <div class="field-group selfie-group" data-key="${fieldKey}">
      <label class="field-label">
        <span class="required-mark">*</span>
        <span class="dv">ސެލްފީ (ފޮޓޯ ނެގުން)</span>
        <span class="en" hidden> — Live Selfie Verification</span>
      </label>
      <p class="field-hint">
        <span class="dv">ފޯމު ހުށަހަޅާ ފަރާތުގެ ސެލްފީއެއް ނެގުމަށް. ފޮޓޯ ނެގުމަށް ތިރީގައިވާ ބަޓަނަށް ފިތާލައްވާ.</span>
        <span class="en" hidden>Take a live selfie for identity verification. Press the button below to capture.</span>
      </p>
      <div class="selfie-capture-area" id="${fieldKey}_area">
        <video id="${fieldKey}_video" class="selfie-video" autoplay playsinline style="display:none;"></video>
        <canvas id="${fieldKey}_canvas" class="selfie-canvas" style="display:none;"></canvas>
        <img id="${fieldKey}_preview" class="selfie-preview" style="display:none;" alt="Selfie preview">
        <input type="hidden" id="${fieldKey}_data" name="${fieldKey}">
        <div class="selfie-actions">
          <button type="button" class="btn btn-secondary selfie-start-btn" id="${fieldKey}_startBtn"
            onclick="window.MediaCapture.startCamera('${fieldKey}')">
            <span class="dv">ކެމެރާ ހުޅުވާ</span>
            <span class="en" hidden>Open Camera</span>
          </button>
          <button type="button" class="btn btn-primary selfie-capture-btn" id="${fieldKey}_captureBtn"
            style="display:none;" onclick="window.MediaCapture.captureSelfie('${fieldKey}')">
            <span class="dv">ފޮޓޯ ނަންގަވާ</span>
            <span class="en" hidden>Capture</span>
          </button>
          <button type="button" class="btn-sm selfie-retake-btn" id="${fieldKey}_retakeBtn"
            style="display:none;" onclick="window.MediaCapture.retakeSelfie('${fieldKey}')">
            <span class="dv">އަލުން ނަންގަވާ</span>
            <span class="en" hidden>Retake</span>
          </button>
        </div>
      </div>
      <div class="field-error" id="err_${fieldKey}"></div>
    </div>`;
  }

  let activeStreams = {};

  async function startCamera(fieldKey) {
    const video = document.getElementById(fieldKey + '_video');
    const startBtn = document.getElementById(fieldKey + '_startBtn');
    const captureBtn = document.getElementById(fieldKey + '_captureBtn');
    const preview = document.getElementById(fieldKey + '_preview');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
      });
      activeStreams[fieldKey] = stream;
      video.srcObject = stream;
      video.style.display = 'block';
      preview.style.display = 'none';
      startBtn.style.display = 'none';
      captureBtn.style.display = 'inline-flex';
    } catch (err) {
      alert('ކެމެރާ ހުޅުވޭ ގޮތް ނުވި. ބްރައުޒަރުގެ ކެމެރާ ހުއްދަ ޗެކް ކުރައްވާ.\n\nCould not access camera. Please check browser permissions.');
    }
  }

  function captureSelfie(fieldKey) {
    const video = document.getElementById(fieldKey + '_video');
    const canvas = document.getElementById(fieldKey + '_canvas');
    const preview = document.getElementById(fieldKey + '_preview');
    const hidden = document.getElementById(fieldKey + '_data');
    const captureBtn = document.getElementById(fieldKey + '_captureBtn');
    const retakeBtn = document.getElementById(fieldKey + '_retakeBtn');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    // save the photo as others see the person — not mirrored
    ctx.drawImage(video, 0, 0);

    const dataURL = canvas.toDataURL('image/jpeg', 0.85);
    preview.src = dataURL;
    preview.style.display = 'block';
    hidden.value = dataURL;
    video.style.display = 'none';
    captureBtn.style.display = 'none';
    retakeBtn.style.display = 'inline-flex';

    // Stop camera
    stopCamera(fieldKey);
  }

  function retakeSelfie(fieldKey) {
    const preview = document.getElementById(fieldKey + '_preview');
    const hidden = document.getElementById(fieldKey + '_data');
    const retakeBtn = document.getElementById(fieldKey + '_retakeBtn');

    preview.style.display = 'none';
    hidden.value = '';
    retakeBtn.style.display = 'none';
    startCamera(fieldKey);
  }

  function stopCamera(fieldKey) {
    if (activeStreams[fieldKey]) {
      activeStreams[fieldKey].getTracks().forEach(t => t.stop());
      delete activeStreams[fieldKey];
    }
  }


  /* ─── IMAGE ATTACHMENT VALIDATION ───────────────────────────────── */

  const IMAGE_MIN_WIDTH = 300;   // px
  const IMAGE_MIN_HEIGHT = 300;  // px
  const IMAGE_MIN_SIZE = 50000;  // 50KB
  const IMAGE_MAX_SIZE = 10 * 1024 * 1024; // 10MB

  function renderImageUploadHTML(fieldKey, labelDv, labelEn) {
    return `
    <div class="field-group image-upload-group" data-key="${fieldKey}">
      <label class="field-label">
        <span class="dv">${labelDv}</span>
        <span class="en" hidden> — ${labelEn}</span>
      </label>
      <p class="field-hint">
        <span class="dv">ފޮޓޯ މަދުވެގެން ${IMAGE_MIN_WIDTH}x${IMAGE_MIN_HEIGHT} ޕިކްސެލް، ސައިޒް މަދުވެގެން 50KB</span>
        <span class="en" hidden>Photo must be at least ${IMAGE_MIN_WIDTH}x${IMAGE_MIN_HEIGHT} pixels, minimum 50KB</span>
      </p>
      <input type="file" id="${fieldKey}" name="${fieldKey}" accept="image/*"
        class="field-input file-input" onchange="window.MediaCapture.validateImage('${fieldKey}')">
      <div class="image-preview-box" id="${fieldKey}_preview" style="display:none;">
        <img id="${fieldKey}_img" class="image-preview-thumb" alt="">
        <span id="${fieldKey}_info" class="image-info"></span>
      </div>
      <div class="field-error" id="err_${fieldKey}"></div>
    </div>`;
  }

  function validateImage(fieldKey) {
    const input = document.getElementById(fieldKey);
    const errEl = document.getElementById('err_' + fieldKey);
    const previewBox = document.getElementById(fieldKey + '_preview');
    const previewImg = document.getElementById(fieldKey + '_img');
    const infoEl = document.getElementById(fieldKey + '_info');

    if (!input.files || !input.files[0]) {
      previewBox.style.display = 'none';
      return;
    }

    const file = input.files[0];
    errEl.textContent = '';
    errEl.classList.remove('visible');

    // Check file size
    if (file.size < IMAGE_MIN_SIZE) {
      showImageError(fieldKey, 'ފައިލް ސައިޒް ކުޑަ. މަދުވެގެން 50KB ބޭނުންވާނެ.');
      input.value = '';
      previewBox.style.display = 'none';
      return;
    }
    if (file.size > IMAGE_MAX_SIZE) {
      showImageError(fieldKey, 'ފައިލް ސައިޒް ބޮޑު. ގިނަވެގެން 10MB.');
      input.value = '';
      previewBox.style.display = 'none';
      return;
    }

    // Check dimensions
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = function () {
      URL.revokeObjectURL(url);
      if (img.width < IMAGE_MIN_WIDTH || img.height < IMAGE_MIN_HEIGHT) {
        showImageError(fieldKey,
          `ފޮޓޯ ކުޑަ: ${img.width}x${img.height}px. މަދުވެގެން ${IMAGE_MIN_WIDTH}x${IMAGE_MIN_HEIGHT}px ބޭނުންވާނެ. / Image too small: ${img.width}x${img.height}px. Minimum ${IMAGE_MIN_WIDTH}x${IMAGE_MIN_HEIGHT}px required.`);
        input.value = '';
        previewBox.style.display = 'none';
        return;
      }
      // Valid — show preview
      previewImg.src = URL.createObjectURL(input.files[0]);
      infoEl.textContent = `${img.width}x${img.height}px | ${(file.size / 1024).toFixed(0)}KB`;
      previewBox.style.display = 'flex';
      errEl.textContent = '';
      errEl.classList.remove('visible');
    };
    img.onerror = function () {
      showImageError(fieldKey, 'ފައިލް ރީޑް ނުކުރެވުނު. / Could not read image file.');
      input.value = '';
    };
    img.src = url;
  }

  function showImageError(fieldKey, msg) {
    const errEl = document.getElementById('err_' + fieldKey);
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.add('visible');
    }
  }


  /* ─── FILE UPLOAD (generic — for receipt, etc.) ─────────────────── */

  function renderFileUploadHTML(fieldKey, labelDv, labelEn, accept) {
    return `
    <div class="field-group" data-key="${fieldKey}">
      <label class="field-label">
        <span class="dv">${labelDv}</span>
        <span class="en" hidden> — ${labelEn}</span>
      </label>
      <input type="file" id="${fieldKey}" name="${fieldKey}" accept="${accept || ' */*'}"
        class="field-input file-input">
      <div class="field-error" id="err_${fieldKey}"></div>
    </div>`;
  }


  /* ─── SMS NOTIFICATION MOCK ─────────────────────────────────────── */

  function generateSMSPreview(data) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB') + ' ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return {
      to: data.contact_number || '7XXXXXX',
      message: `Family Court: ${data.form_code || 'Fm-C-B20'} form submitted to Family Court at ${dateStr} by ID ${data.id_number || 'AXXXXXX'} from phone ${data.contact_number || '7XXXXXX'}. Ref: ${data.ref_code || 'VS-XXXX'}.`,
      message_dv: `ފެމިލީ ކޯޓު: ${data.form_code || 'Fm-C-B20'} ފޯމު ފެމިލީ ކޯޓަށް ހުށަހެޅިއްޖެ. ތާރީޚް: ${dateStr}. އައިޑީ: ${data.id_number || 'AXXXXXX'}. ފޯނު: ${data.contact_number || '7XXXXXX'}. ރެފް: ${data.ref_code || 'VS-XXXX'}.`
    };
  }

  function showSMSModal(smsData) {
    const modal = document.getElementById('smsModal');
    if (!modal) return;
    document.getElementById('smsTo').textContent = smsData.to;
    document.getElementById('smsMessage').textContent = smsData.message;
    document.getElementById('smsMessageDv').textContent = smsData.message_dv;
    modal.style.display = 'flex';
  }


  /* ─── PAYMENT STEP ──────────────────────────────────────────────── */

  function renderPaymentStepHTML() {
    return `
    <div class="payment-step-panel">
      <div class="payment-icon">${window.FcIcons ? FcIcons.svg('card', 28) : ''}</div>
      <h3 class="payment-title">
        <span class="dv">ފީ ދެއްކުން</span>
        <span class="en" hidden>Fee Payment</span>
      </h3>
      <p class="payment-desc">
        <span class="dv">ފޯމު ހުށަހެޅުމުގެ ކުރިން ފީ ދައްކަވާ. ތިރީގައިވާ ލިންކުން ޕޭމަންޓް ގޭޓްވޭއަށް ގޮސް ފީ ދެއްކެވުމަށްފަހު ރީސީޓް އެޓޭޗް ކުރައްވާ.</span>
        <span class="en" hidden>Please pay the submission fee before submitting. Use the link below to go to the payment gateway, then attach the receipt.</span>
      </p>
      <div class="payment-amount">
        <span class="dv">ފީ: 25.00 ރުފިޔާ</span>
        <span class="en" hidden>Fee: MVR 25.00</span>
      </div>
      <a href="https://payment.gov.mv" target="_blank" rel="noopener" class="btn btn-primary payment-link" id="paymentGatewayLink">
        <span class="dv">ޕޭމަންޓް ގޭޓްވޭ ހުޅުއްވާ</span>
        <span class="en" hidden>Open Payment Gateway</span>
      </a>
      <div class="payment-receipt-upload">
        <label class="field-label">
          <span class="required-mark">*</span>
          <span class="dv">ޕޭމަންޓް ރީސީޓް</span>
          <span class="en" hidden> — Payment Receipt</span>
        </label>
        <input type="file" id="payment_receipt" name="payment_receipt" accept="image/*,.pdf"
          class="field-input file-input">
        <p class="field-hint">
          <span class="dv">ޕޭމަންޓް ރީސީޓް ފޮޓޯ ނުވަތަ PDF</span>
          <span class="en" hidden>Upload receipt photo or PDF</span>
        </p>
        <div class="field-error" id="err_payment_receipt"></div>
      </div>
    </div>`;
  }


  /* ─── PUBLIC API ────────────────────────────────────────────────── */

  return {
    // Signature
    initSignaturePad, renderSignaturePadHTML, signaturePads,
    // Selfie
    renderSelfieHTML, startCamera, captureSelfie, retakeSelfie, stopCamera,
    // Image
    renderImageUploadHTML, validateImage,
    // File
    renderFileUploadHTML,
    // SMS
    generateSMSPreview, showSMSModal,
    // Payment
    renderPaymentStepHTML
  };
})();
