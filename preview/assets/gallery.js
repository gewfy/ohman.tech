/* ═══════════════════════════════════════════════════════════════
   GALLERY VIEWER

   Full-screen image viewer for the project galleries. Opens out of the
   thumbnail it was launched from, browses with keys, wheel-free swipe
   and buttons, and zooms to pan with the pointer.
   ═══════════════════════════════════════════════════════════════ */

(() => {
  const viewer = document.querySelector('.viewer');
  if (!viewer) return;

  const stage = viewer.querySelector('.viewer__stage');
  const full = viewer.querySelector('.viewer__img');
  const capEl = viewer.querySelector('.viewer__caption');
  const countEl = viewer.querySelector('.viewer__count');
  const btnClose = viewer.querySelector('.viewer__close');
  const btnPrev = viewer.querySelector('.viewer__prev');
  const btnNext = viewer.querySelector('.viewer__next');

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SERVO = 'cubic-bezier(.22, 1.16, .36, 1)';

  /* Every shot on the page in document order, so the lead photograph is
     part of the same sequence as the gallery tiles. */
  const shots = Array.from(document.querySelectorAll('.shot'));
  if (!shots.length) return;

  /* Captions carry markup so a photo credit can link out; the button label
     needs the plain text of it. */
  const plain = (html) => {
    const el = document.createElement('div');
    el.innerHTML = html;
    return el.textContent.trim();
  };

  const items = shots.map((btn) => {
    const thumb = btn.querySelector('img');
    const caption = btn.dataset.caption || '';
    if (!btn.hasAttribute('aria-label')) {
      const label = plain(caption) || thumb.alt;
      btn.setAttribute('aria-label', `View full screen: ${label}`);
    }
    return {
      btn,
      thumb,
      src: btn.dataset.full || thumb.currentSrc || thumb.src,
      alt: thumb.alt || '',
      caption
    };
  });

  const pad = (n) => String(n).padStart(2, '0');

  let index = -1;
  let opener = null;
  let zoomed = false;

  /* ─────────────────── Open / close ─────────────────── */

  function lockScroll() {
    const bar = innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (bar > 0) document.body.style.paddingRight = bar + 'px';
  }

  function unlockScroll() {
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
  }

  /* Grid tiles are cropped, so match the cover scale rather than the box:
     the picture then starts at the size it appears in the tile and grows
     from the same centre. The fade hides what the crop was hiding. */
  function tileTransform(thumb) {
    const from = thumb.getBoundingClientRect();
    const to = full.getBoundingClientRect();
    if (!to.width || !from.width) return null;
    const scale = Math.max(from.width / to.width, from.height / to.height);
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    return `translate(${dx}px, ${dy}px) scale(${scale})`;
  }

  function riseFrom(thumb) {
    if (reduced) return;
    const start = tileTransform(thumb);
    if (!start) return;
    full.animate(
      [
        { transform: start, opacity: .35 },
        { transform: 'none', opacity: 1 }
      ],
      { duration: 420, easing: SERVO }
    );
  }

  async function show(i, animate) {
    index = (i + items.length) % items.length;
    const item = items[index];

    setZoom(false);
    full.src = item.src;
    full.alt = item.alt;
    capEl.innerHTML = item.caption;
    countEl.textContent = `${pad(index + 1)} / ${pad(items.length)}`;

    try {
      await full.decode();
    } catch {
      /* a decode error still leaves the <img> to report onerror itself */
    }

    if (animate === 'rise') riseFrom(item.thumb);
    else if (animate && !reduced) {
      full.animate(
        [
          { opacity: 0, transform: `translateX(${animate === 'next' ? 24 : -24}px)` },
          { opacity: 1, transform: 'none' }
        ],
        { duration: 260, easing: 'ease-out' }
      );
    }

    preload(index + 1);
    preload(index - 1);
  }

  function preload(i) {
    const item = items[(i + items.length) % items.length];
    const img = new Image();
    img.src = item.src;
  }

  function open(i) {
    opener = document.activeElement;
    viewer.hidden = false;
    lockScroll();
    document.getElementById('top').setAttribute('aria-hidden', 'true');
    if (!reduced) {
      viewer.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 220,
        easing: 'linear'
      });
    }
    show(i, 'rise');
    btnClose.focus({ preventScroll: true });
  }

  function close() {
    const thumb = items[index] && items[index].thumb;
    const done = () => {
      viewer.hidden = true;
      full.removeAttribute('src');
      unlockScroll();
      document.getElementById('top').removeAttribute('aria-hidden');
      if (opener) opener.focus({ preventScroll: true });
      opener = null;
    };

    setZoom(false);

    if (reduced || !thumb || !inView(thumb)) {
      if (reduced) return done();
      viewer.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 180,
        easing: 'linear'
      }).finished.then(done, done);
      return;
    }

    const end = tileTransform(thumb);
    if (!end) return done();

    viewer.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 320,
      easing: 'ease-in'
    });
    full
      .animate([{ transform: 'none' }, { transform: end }], {
        duration: 320,
        easing: 'ease-in'
      })
      .finished.then(done, done);
  }

  function inView(el) {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight;
  }

  /* ─────────────────── Zoom to pan ─────────────────── */

  const ZOOM = 2.4;
  let base = null;   // the fitted box, measured before any zoom transform

  function setZoom(on, ev) {
    zoomed = on;
    viewer.classList.toggle('is-zoomed', on);
    if (!on) {
      base = null;
      full.style.transform = '';
      return;
    }
    base = full.getBoundingClientRect();
    panTo(ev);
  }

  /* Pointer position maps to the hidden overflow, so moving to an edge
     shows that edge rather than dragging by a matching amount. */
  function panTo(ev) {
    if (!zoomed || !base) return;
    const box = stage.getBoundingClientRect();
    const px = ev ? (ev.clientX - box.left) / box.width : 0.5;
    const py = ev ? (ev.clientY - box.top) / box.height : 0.5;
    const overX = Math.max(0, (base.width * ZOOM - box.width) / 2);
    const overY = Math.max(0, (base.height * ZOOM - box.height) / 2);
    const x = (0.5 - Math.min(1, Math.max(0, px))) * 2 * overX;
    const y = (0.5 - Math.min(1, Math.max(0, py))) * 2 * overY;
    full.style.transform = `translate(${x}px, ${y}px) scale(${ZOOM})`;
  }

  addEventListener('resize', () => { if (zoomed) setZoom(false); });

  /* ─────────────────── Wiring ─────────────────── */

  shots.forEach((btn, i) => {
    btn.addEventListener('click', () => open(i));
  });

  btnClose.addEventListener('click', close);
  btnPrev.addEventListener('click', () => show(index - 1, 'prev'));
  btnNext.addEventListener('click', () => show(index + 1, 'next'));

  full.addEventListener('click', (ev) => {
    ev.stopPropagation();
    setZoom(!zoomed, ev);
  });
  /* Anything but the photograph itself dismisses; the image handler above
     stops its own clicks from reaching here. */
  stage.addEventListener('click', (ev) => {
    if (ev.target !== full) close();
  });
  stage.addEventListener('pointermove', (ev) => {
    if (zoomed && ev.pointerType === 'mouse') panTo(ev);
  });

  addEventListener('keydown', (ev) => {
    if (viewer.hidden) return;
    switch (ev.key) {
      case 'Escape':
        ev.preventDefault();
        zoomed ? setZoom(false) : close();
        break;
      case 'ArrowRight':
      case ' ':
        ev.preventDefault();
        show(index + 1, 'next');
        break;
      case 'ArrowLeft':
        ev.preventDefault();
        show(index - 1, 'prev');
        break;
      case 'Home':
        ev.preventDefault();
        show(0, 'prev');
        break;
      case 'End':
        ev.preventDefault();
        show(items.length - 1, 'next');
        break;
      case 'Tab':
        trap(ev);
        break;
    }
  });

  /* Gathered per keypress: a caption credit adds a link to the tab order */
  function trap(ev) {
    const stops = Array.from(
      viewer.querySelectorAll('a[href], button')
    ).filter((el) => el.offsetParent);
    if (!stops.length) return;

    const first = stops[0];
    const last = stops[stops.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  }

  /* Swipe: sideways to browse, down to dismiss. */
  let start = null;
  stage.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse') return;
    start = { x: ev.clientX, y: ev.clientY };
  });
  stage.addEventListener('pointerup', (ev) => {
    if (!start) return;
    const dx = ev.clientX - start.x;
    const dy = ev.clientY - start.y;
    start = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      show(index + (dx < 0 ? 1 : -1), dx < 0 ? 'next' : 'prev');
    } else if (dy > 90) {
      close();
    }
  });
})();
