(function(){
  'use strict';

  function extractTokenFromHash(){
    var hash = window.location.hash || '';
    if (hash.indexOf('#token=') === 0) return hash.substring(7);
    return '';
  }

  function extractTokenFromQuery(){
    try {
      var url = new URL(window.location.href);
      var tk = url.searchParams.get('token') || '';
      return tk;
    } catch(e){
      return '';
    }
  }

  function byId(id){ return document.getElementById(id); }

  document.addEventListener('DOMContentLoaded', function(){

    // ===== Token na URL (?token=) ou hash (#token=) → input hidden =====
    var tokenInput = byId('fg-token');
    if (tokenInput && !tokenInput.value){
      var tkq = extractTokenFromQuery();
      if (tkq) tokenInput.value = tkq;
    }
    if (tokenInput && !tokenInput.value){
      var tkh = extractTokenFromHash();
      if (tkh) tokenInput.value = tkh;
    }

    // ===== Modal de vídeo =====
    var openBtn = byId('btn-open-video');
    var modal   = byId('fg-video-modal');
    var iframe  = byId('fg-video-iframe');

    function openModal(){
      if (!modal || !iframe) return;
      modal.hidden = false;
      modal.setAttribute('aria-hidden','false');
      iframe.src = (window.FGFORM && FGFORM.embedUrl) ? FGFORM.embedUrl : '';
    }
    function closeModal(){
      if (!modal || !iframe) return;
      iframe.src = '';
      modal.hidden = true;
      modal.setAttribute('aria-hidden','true');
    }

    if (openBtn) openBtn.addEventListener('click', openModal);
    if (modal) {
      modal.addEventListener('click', function(ev){
        var t = ev.target;
        if (t && t.closest && t.closest('[data-close="1"]')) closeModal();
      });
    }
    document.addEventListener('keydown', function(ev){
      if (modal && !modal.hidden && ev.key === 'Escape') closeModal();
    });

    // ===== Câmera / captura =====
    var btnOpen  = byId('btn-open-camera');
    var btnClose = byId('btn-close-camera');
    var btnShot  = byId('btn-capture');
    var btnClear = byId('btn-clear-photo');

    var video    = byId('camera');
    var area     = byId('camera-area');
    var canvas   = byId('snapshot');
    var preview  = byId('preview-img');
    var hiddenB64= byId('backup_photo_data');

    var stream = null;

    async function openCamera(){
      var constraintsList = [
        { video: { facingMode: { exact: 'environment' } }, audio:false },
        { video: { facingMode: 'environment' }, audio:false },
        { video: true, audio:false }
      ];
      for (var i=0; i<constraintsList.length; i++){
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraintsList[i]);
          if (video) video.srcObject = stream;
          if (area) area.style.display = 'block';
          if (preview) preview.style.display = 'none';
          if (canvas) canvas.style.display  = 'none';
          return;
        } catch(e) { /* tenta o próximo */ }
      }
      alert('Não foi possível acessar a câmera traseira neste dispositivo.');
    }

    function closeCamera(){
      if (stream) {
        stream.getTracks().forEach(function(t){ t.stop(); });
        stream = null;
      }
      if (area) area.style.display = 'none';
    }

    function capture(){
      var w = (video && video.videoWidth)  ? video.videoWidth  : 1280;
      var h = (video && video.videoHeight) ? video.videoHeight : 720;
      if (!canvas) return;
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, w, h);
      var dataURL = canvas.toDataURL('image/jpeg', 0.92);
      if (hiddenB64) hiddenB64.value = dataURL;
      if (preview) {
        preview.src = dataURL;
        preview.style.display = 'block';
      }
      canvas.style.display = 'none';
      closeCamera();
    }

    function clearPhoto(){
      if (hiddenB64) hiddenB64.value = '';
      if (preview) {
        preview.src = '';
        preview.style.display = 'none';
      }
    }

    if (btnOpen)  btnOpen.addEventListener('click', openCamera);
    if (btnClose) btnClose.addEventListener('click', closeCamera);
    if (btnShot)  btnShot.addEventListener('click', capture);
    if (btnClear) btnClear.addEventListener('click', clearPhoto);
  });
})();
