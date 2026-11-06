/*
  Sisma Showroom Rail: behaviour for <sisma-showroom-rail>.
  - works with native touch scroll, trackpad, mouse drag, arrows and keyboard
  - the car nearest the centre becomes "active" and its details show below
  - price tags swing with the rail's speed, then settle like a pendulum
*/
(function () {
  if (customElements.get('sisma-showroom-rail')) return;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Reads year, mileage and origin from listing text. Handles the formats used
  // on the store, e.g. "2022 • 7,226 KM • JAPAN IMPORT", "VPR31352024 | 1,500 KM",
  // "Z2025 • 52km • Japan Import".
  function parseSpecs(text) {
    var out = { year: '', km: '', origin: '' };
    if (!text) return out;
    var m = text.match(/((?:19|20)\d{2})\s*[•·|\/-]\s*([\d][\d.,]*)\s*KM/i);
    if (m) {
      out.year = m[1];
      var n = parseInt(m[2].replace(/[.,]/g, ''), 10);
      if (!isNaN(n)) out.km = n.toLocaleString('en-US') + ' km';
    } else {
      var y = text.match(/((?:19|20)\d{2})\s*[•·|]/) || text.match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
      if (y) out.year = y[1];
    }
    var o = text.match(/\b([A-Za-z]+)\s+(IMPORT|RECOND)/i);
    if (o) out.origin = o[1] + ' ' + o[2];
    return out;
  }

  // "JAPAN IMPORT" -> "Japan Import", keeps short codes like "UK"
  function titleCase(s) {
    return s.split(' ').map(function (w) {
      return w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ');
  }

  class SismaShowroomRail extends HTMLElement {
    connectedCallback() {
      this.rail = this.querySelector('.sr__rail');
      this.items = Array.prototype.slice.call(this.querySelectorAll('.sr__item'));
      if (!this.rail || !this.items.length) return;

      this.info = this.querySelector('.sr__info');
      this.out = {
        count: this.querySelector('[data-sr-count]'),
        name: this.querySelector('[data-sr-name]'),
        meta: this.querySelector('[data-sr-meta]'),
        price: this.querySelector('[data-sr-price]'),
        link: this.querySelector('[data-sr-link]')
      };
      this.prev = this.querySelector('.sr__arrow--prev');
      this.next = this.querySelector('.sr__arrow--next');

      // fill year / km on each tag from the listing description
      this.items.forEach(function (item) {
        var specs = parseSpecs(item.getAttribute('data-desc'));
        item._specs = specs;
        var y = item.querySelector('.sr__tag-year');
        var k = item.querySelector('.sr__tag-km');
        if (y && !y.textContent.trim()) y.textContent = specs.year;
        if (k && !k.textContent.trim()) k.textContent = specs.km;
        item.style.setProperty('--k', (0.75 + Math.random() * 0.5).toFixed(2));
      });

      this.active = -1;
      this.swing = 0;
      this.swingVel = 0;
      this.lastX = this.rail.scrollLeft;
      this.lastT = performance.now();

      this.onScroll = this.onScroll.bind(this);
      this.tick = this.tick.bind(this);
      this.rail.addEventListener('scroll', this.onScroll, { passive: true });
      window.addEventListener('resize', this.onScroll);

      if (this.prev) this.prev.addEventListener('click', this.step.bind(this, -1));
      if (this.next) this.next.addEventListener('click', this.step.bind(this, 1));
      this.rail.addEventListener('keydown', this.onKey.bind(this));
      this.bindDrag();
      this.bindCardClicks();

      var start = parseInt(this.getAttribute('data-start') || '0', 10) || 0;
      start = Math.min(Math.max(start, 0), this.items.length - 1);
      this.goTo(start, false);
      this.setActive(start);
      this.raf = requestAnimationFrame(this.tick);
    }

    disconnectedCallback() {
      cancelAnimationFrame(this.raf);
      window.removeEventListener('resize', this.onScroll);
    }

    centerOf(i) {
      var el = this.items[i];
      return el.offsetLeft + el.offsetWidth / 2 - this.rail.clientWidth / 2;
    }

    nearest() {
      var x = this.rail.scrollLeft, best = 0, bestD = Infinity;
      for (var i = 0; i < this.items.length; i++) {
        var d = Math.abs(this.centerOf(i) - x);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }

    goTo(i, smooth) {
      i = Math.min(Math.max(i, 0), this.items.length - 1);
      this.rail.scrollTo({
        left: this.centerOf(i),
        behavior: smooth === false || reduceMotion.matches ? 'auto' : 'smooth'
      });
    }

    step(dir) { this.goTo((this.active < 0 ? 0 : this.active) + dir); }

    onKey(e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); this.step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.step(-1); }
      else if (e.key === 'Home') { e.preventDefault(); this.goTo(0); }
      else if (e.key === 'End') { e.preventDefault(); this.goTo(this.items.length - 1); }
    }

    onScroll() {
      var i = this.nearest();
      if (i !== this.active) this.setActive(i);
    }

    setActive(i) {
      var prevActive = this.active;
      this.active = i;
      this.items.forEach(function (item, n) {
        var on = n === i;
        item.classList.toggle('is-active', on);
        var card = item.querySelector('.sr__card');
        if (card) {
          card.setAttribute('tabindex', on ? '0' : '-1');
          if (on) card.setAttribute('aria-current', 'true'); else card.removeAttribute('aria-current');
        }
      });

      var item = this.items[i];
      var s = item._specs || {};
      var meta = [s.year, s.km, s.origin ? titleCase(s.origin) : ''].filter(Boolean).join('  ·  ');
      if (this.out.count) this.out.count.textContent = String(i + 1).padStart(2, '0') + ' / ' + String(this.items.length).padStart(2, '0');
      if (this.out.name) this.out.name.textContent = item.getAttribute('data-title') || '';
      if (this.out.meta) this.out.meta.textContent = meta;
      if (this.out.price) this.out.price.textContent = item.getAttribute('data-price') || '';
      if (this.out.link) this.out.link.setAttribute('href', item.getAttribute('data-url') || '#');
      if (this.prev) this.prev.disabled = i === 0;
      if (this.next) this.next.disabled = i === this.items.length - 1;

      if (this.info && prevActive !== -1 && !reduceMotion.matches) {
        this.info.classList.remove('is-changing');
        void this.info.offsetWidth; // restart the animation
        this.info.classList.add('is-changing');
      }
    }

    // pendulum: rail speed pushes the tags, a spring brings them back
    tick(t) {
      var dt = Math.min((t - this.lastT) / 1000, 0.05) || 0.016;
      var x = this.rail.scrollLeft;
      var v = (x - this.lastX) / dt; // px per second
      this.lastX = x;
      this.lastT = t;
      if (!reduceMotion.matches) {
        var target = Math.max(-24, Math.min(24, -v * 0.02));
        var stiffness = 60, damping = 5.5;
        var force = (target - this.swing) * stiffness - this.swingVel * damping;
        this.swingVel += force * dt;
        this.swing += this.swingVel * dt;
        if (Math.abs(this.swing) < 0.01 && Math.abs(this.swingVel) < 0.01) this.swing = 0;
        this.style.setProperty('--_swing', this.swing.toFixed(2) + 'deg');
      }
      this.raf = requestAnimationFrame(this.tick);
    }

    // mouse drag (touch uses native scrolling)
    bindDrag() {
      var self = this, rail = this.rail, down = false, startX = 0, startLeft = 0, moved = 0, lastX = 0, lastT = 0, vel = 0;
      rail.addEventListener('pointerdown', function (e) {
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        down = true; moved = 0; vel = 0;
        startX = lastX = e.clientX; lastT = performance.now();
        startLeft = rail.scrollLeft;
      });
      window.addEventListener('pointermove', function (e) {
        if (!down) return;
        var dx = e.clientX - startX;
        moved = Math.max(moved, Math.abs(dx));
        if (moved > 4 && !rail.classList.contains('is-dragging')) {
          rail.classList.add('is-dragging');
        }
        if (rail.classList.contains('is-dragging')) {
          var now = performance.now();
          vel = (e.clientX - lastX) / Math.max(now - lastT, 1);
          lastX = e.clientX; lastT = now;
          rail.scrollLeft = startLeft - dx;
        }
      });
      window.addEventListener('pointerup', function () {
        if (!down) return;
        down = false;
        if (!rail.classList.contains('is-dragging')) return;
        rail.classList.remove('is-dragging');
        // fling: carry some momentum into the next car
        var fling = Math.round(-vel * 1.2);
        var target = self.nearest() + Math.max(-3, Math.min(3, Math.abs(vel) > 0.5 ? Math.sign(fling) * Math.ceil(Math.abs(fling) / 2) : 0));
        self.goTo(target);
        self._justDragged = true;
        setTimeout(function () { self._justDragged = false; }, 50);
      });
    }

    // clicking a side car brings it to the centre; clicking the centre car opens it
    bindCardClicks() {
      var self = this;
      this.items.forEach(function (item, n) {
        var card = item.querySelector('.sr__card');
        if (!card) return;
        card.addEventListener('click', function (e) {
          if (self._justDragged) { e.preventDefault(); return; }
          if (n !== self.active) { e.preventDefault(); self.goTo(n); }
        });
        card.addEventListener('dragstart', function (e) { e.preventDefault(); });
      });
    }
  }

  customElements.define('sisma-showroom-rail', SismaShowroomRail);
})();
