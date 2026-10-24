(function () {
  'use strict';
  var root = document.documentElement;
  root.classList.add('js');
  var beam = null;
  document.addEventListener('pointermove', function (e) {
    if (beam) return;
    beam = requestAnimationFrame(function () {
      root.style.setProperty('--mx', e.clientX + 'px');
      root.style.setProperty('--my', e.clientY + 'px');
      beam = null;
    });
  }, { passive: true });

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: 0.12 });
    document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });
  } else {
    document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('in'); });
  }

  var form = document.querySelector('[data-scan]');
  if (form) {
    var file = form.querySelector('#file');
    var area = form.querySelector('#statement');
    var name = form.querySelector('[data-file-name]');
    var drop = form.querySelector('.drop');
    var load = function (f) {
      if (!f) return;
      if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') { name.textContent = 'PDF files are not supported. Export a CSV, or paste the text instead.'; return; }
      if (f.size > 1400000) { name.textContent = 'That file is too big. Try a shorter period, around six months.'; return; }
      var reader = new FileReader();
      reader.onload = function () { area.value = String(reader.result || ''); name.textContent = f.name + ' loaded'; };
      reader.onerror = function () { name.textContent = 'That file could not be read.'; };
      reader.readAsText(f);
    };
    file.addEventListener('change', function () { load(file.files[0]); });
    ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { load(e.dataTransfer && e.dataTransfer.files[0]); });
    form.addEventListener('submit', function (e) {
      var b = e.submitter;
      if (b && b.dataset.busy) { setTimeout(function () { b.disabled = true; b.firstElementChild.textContent = b.dataset.busy; }, 0); }
    });
  }

  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var el = document.querySelector(btn.getAttribute('data-copy'));
      if (!el || !navigator.clipboard) return;
      navigator.clipboard.writeText(el.textContent).then(function () {
        var old = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = old; }, 1600);
      });
    });
  });
})();
