/*
  Sisma Scroll Showroom: behaviour for <sisma-scroll-showroom>.

  The page scroll drives one timeline:
    intro  - overhead view of the whole showroom floor, camera settles on bay 1
    dive   - camera drops into the bay, the car's photos take over
    walk   - scrolling walks around the car (studio angles cross-fade and drift)
    rise   - camera lifts back to the overhead floor
    pan    - camera glides along the floor to the next bay
*/
(function () {
  if (customElements.get('sisma-scroll-showroom')) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var SVGNS = 'http://www.w3.org/2000/svg';
  var BAY_W = 250, BAY_H = 210, HEX_W = 222, HEX_H = 182, LANE = 110;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function span(t, a, b) { return clamp((t - a) / (b - a), 0, 1); }

  // ---- listing text -> details ----
  function parseSpecs(text) {
    var out = { year: '', km: '', origin: '', specs: [] };
    if (!text) return out;
    var m = text.match(/((?:19|20)\d{2})\s*[•·|\/-]\s*([\d][\d.,]*)\s*KM/i);
    if (m) {
      out.year = m[1];
      var n = parseInt(m[2].replace(/[.,]/g, ''), 10);
      if (!isNaN(n)) out.km = n.toLocaleString('en-US') + ' km';
    }
    var o = text.match(/\b([A-Za-z]+)\s+(IMPORT|RECOND)/i);
    if (o) out.origin = tc(o[1] + ' ' + o[2]);
    // [pattern, label]; first match of each label wins, in listing order
    var keys = [
      ['Engine(?:\\s*\\/\\s*Power)?', 'Engine'], ['Transmission', 'Gearbox'],
      ['Horse\\s?power(?:\\s*\\/\\s*Torque)?', 'Power'], ['Power(?:\\s*\\/\\s*Torque)?', 'Power'],
      ['Layout', 'Drive'], ['Drivetrain', 'Drive'], ['Exterior(?:\\s*Colou?r)?', 'Exterior'],
      ['Interior(?:\\s*Colou?r)?', 'Interior'], ['Range', 'Range'], ['Battery', 'Battery']
    ];
    var re = new RegExp('(?:^|[¦\\n]|\\s)(' + keys.map(function (k) { return k[0]; }).join('|') + ')\\s*:\\s*', 'gi');
    var hits = [], h;
    while ((h = re.exec(text))) {
      var label = '';
      for (var k = 0; k < keys.length; k++) if (new RegExp('^' + keys[k][0] + '$', 'i').test(h[1])) { label = keys[k][1]; break; }
      hits.push({ k: label, s: h.index, v: re.lastIndex });
    }
    for (var i = 0; i < hits.length && out.specs.length < 4; i++) {
      var end = i + 1 < hits.length ? hits[i + 1].s : text.length;
      var val = text.slice(hits[i].v, end).split(/\s*[¦\n]\s*|RM\s?\d/)[0].trim().replace(/[,;.\s]+$/, '');
      var dup = out.specs.some(function (s) { return s.k === hits[i].k; });
      if (val && val.length < 70 && !dup) out.specs.push({ k: hits[i].k, v: tc(val) });
    }
    return out;
  }
  function tc(s) {
    if (/[a-z]/.test(s)) return s; // already mixed case, leave it
    return s.toLowerCase().replace(/\b([a-z])([a-z]*)/g, function (w, a, b) {
      return w.length <= 2 || /\d/.test(w) ? w.toUpperCase() : a.toUpperCase() + b;
    }).replace(/\b(\d+(?:\.\d+)?)(l|hp|ps|kw|kwh|nm)\b/gi, function (w, n, u) { return n + (u.toLowerCase() === 'l' ? 'L' : u.toUpperCase()); });
  }

  function el(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  class SismaScrollShowroom extends HTMLElement {
    connectedCallback() {
      this.cars = Array.prototype.slice.call(this.querySelectorAll('.ss__car'));
      if (!this.cars.length) return;
      this.sticky = this.querySelector('.ss__sticky');
      this.floor = this.querySelector('.ss__floor');
      this.cam = this.querySelector('.ss__floor-cam');
      this.titleEl = this.querySelector('.ss__floor-title');
      this.panel = this.querySelector('.ss__panel');
      this.anglesEl = this.querySelector('.ss__angles');
      this.dotsEl = this.querySelector('.ss__dots');
      this.deposit = parseFloat(this.getAttribute('data-deposit') || '10') / 100;
      this.rate = parseFloat(this.getAttribute('data-rate') || '3') / 100;
      this.years = parseFloat(this.getAttribute('data-years') || '9');
      this.currency = this.getAttribute('data-currency') || 'RM';

      this.cars.forEach(function (car) {
        car._frames = Array.prototype.slice.call(car.querySelectorAll('.ss__frames img'));
        car._wrap = car.querySelector('.ss__frames');
        car._info = parseSpecs(car.getAttribute('data-desc'));
      });

      this.buildFloor();
      this.buildUi();
      this.buildTimeline();

      this.onScroll = this.onScroll.bind(this);
      this.onResize = this.onResize.bind(this);
      window.addEventListener('scroll', this.onScroll, { passive: true });
      window.addEventListener('resize', this.onResize);
      this.onResize();
    }

    disconnectedCallback() {
      window.removeEventListener('scroll', this.onScroll);
      window.removeEventListener('resize', this.onResize);
      if (this.onKey) window.removeEventListener('keydown', this.onKey);
    }

    // ---- overhead floor: one lit bay per car, showing the car's front photo ----
    buildFloor() {
      var n = this.cars.length;
      this.floorW = n * BAY_W + LANE * 2;
      this.floorH = BAY_H + LANE * 2;
      var svg = el('svg', { width: this.floorW, height: this.floorH, viewBox: '0 0 ' + this.floorW + ' ' + this.floorH, 'aria-hidden': 'true' });
      var defs = el('defs', {}, svg);
      var glow = el('radialGradient', { id: 'ssGlow' }, defs);
      el('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '.3' }, glow);
      el('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' }, glow);
      // lane marking along the front of the bays
      el('line', { x1: 40, x2: this.floorW - 40, y1: LANE + BAY_H + 46, y2: LANE + BAY_H + 46, stroke: 'rgba(255,255,255,.35)', 'stroke-width': 3, 'stroke-dasharray': '26 18' }, svg);
      this.bays = [];
      var uid = 'ss' + Math.random().toString(36).slice(2, 7);
      var self = this;
      for (let i = 0; i < n; i++) {
        var x = LANE + i * BAY_W, y = LANE;
        var title = this.cars[i].getAttribute('data-title') || 'car ' + (i + 1);
        var g = el('g', { transform: 'translate(' + x + ',' + y + ')', class: 'ss__bay', tabindex: '0', role: 'button', 'aria-label': 'Walk around the ' + title }, svg);
        g.addEventListener('click', function (e) { e.stopPropagation(); self.goCar(i, 0); });
        g.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); self.goCar(i, 0); }
        });
        el('ellipse', { cx: BAY_W / 2, cy: BAY_H / 2, rx: BAY_W * .6, ry: BAY_H * .6, fill: 'url(#ssGlow)' }, g);
        // hexagon light from the studio ceiling, framing the bay
        var hx = BAY_W / 2, hy = BAY_H / 2, rw = HEX_W / 2, rh = HEX_H / 2, cx = 34, cy = 30;
        var pts = [hx - rw + cx, hy - rh, hx + rw - cx, hy - rh, hx + rw, hy - rh + cy, hx + rw, hy + rh - cy, hx + rw - cx, hy + rh, hx - rw + cx, hy + rh, hx - rw, hy + rh - cy, hx - rw, hy - rh + cy].join(' ');
        var clip = el('clipPath', { id: uid + 'h' + i }, defs);
        el('polygon', { points: pts }, clip);
        el('polygon', { points: pts, fill: '#8c8c8a' }, g);
        // the car's front photo, cropped so the car sits in the middle of the hexagon
        var front = this.cars[i]._frames[0];
        if (front) {
          var iw = HEX_W * 1.35, ih = iw * .75;
          var img = el('image', {
            x: hx - iw / 2, y: hy - ih * .62, width: iw, height: ih,
            preserveAspectRatio: 'xMidYMid slice', 'clip-path': 'url(#' + uid + 'h' + i + ')'
          }, g);
          var setSrc = function (im, node) {
            var src = im.currentSrc || im.src;
            if (src) { node.setAttribute('href', src); node.setAttributeNS('http://www.w3.org/1999/xlink', 'href', src); }
          };
          setSrc(front, img);
          front.addEventListener('load', setSrc.bind(null, front, img));
        }
        var hex = el('polygon', { points: pts, fill: 'none', class: 'ss__hexline' }, g);
        if (i === 0) el('line', { x1: 0, x2: 0, y1: 4, y2: BAY_H - 4, stroke: 'rgba(255,255,255,.55)', 'stroke-width': 3 }, g);
        el('line', { x1: BAY_W, x2: BAY_W, y1: 4, y2: BAY_H - 4, stroke: 'rgba(255,255,255,.55)', 'stroke-width': 3 }, g);
        // bay number painted on the floor
        var t = el('text', { x: BAY_W / 2, y: BAY_H + 30, 'text-anchor': 'middle', fill: 'rgba(255,255,255,.8)', 'font-size': 15, 'font-weight': 700, 'letter-spacing': 3, 'font-family': 'ui-monospace, Menlo, monospace' }, g);
        t.textContent = 'BAY ' + String(i + 1).padStart(2, '0');
        this.bays.push({ cx: x + hx, cy: y + hy, g: g });
      }
      this.cam.appendChild(svg);
    }

    buildUi() {
      var self = this;
      var labels = (this.getAttribute('data-angles') || 'Front,Front 3/4,Side,Rear 3/4,Rear').split(',');
      this.angleEls = [];
      if (this.anglesEl) {
        var max = Math.max.apply(null, this.cars.map(function (c) { return c._frames.length; }));
        for (var i = 0; i < max; i++) {
          let a = document.createElement('button'), j = i;
          a.type = 'button';
          a.className = 'ss__angle';
          a.textContent = labels[i] || ('View ' + (i + 1));
          a.addEventListener('click', function (e) { e.stopPropagation(); self.goCar(self.cur ? self.cur.car : 0, j); });
          this.anglesEl.appendChild(a);
          this.angleEls.push(a);
        }
        this.nextBtn = document.createElement('button');
        this.nextBtn.type = 'button';
        this.nextBtn.className = 'ss__angle ss__angle--next';
        this.nextBtn.textContent = 'Next car \u203a';
        this.nextBtn.addEventListener('click', function (e) { e.stopPropagation(); self.nextCar(); });
        this.anglesEl.appendChild(this.nextBtn);
      }
      this.dotEls = [];
      if (this.dotsEl) {
        this.cars.forEach(function (car, i) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'ss__dot';
          b.setAttribute('aria-label', 'Go to ' + (car.getAttribute('data-title') || 'car ' + (i + 1)));
          b.addEventListener('click', function () { self.goCar(i, 0); });
          self.dotsEl.appendChild(b);
          self.dotEls.push(b);
        });
      }
      var back = this.querySelector('.ss__back');
      if (back) back.addEventListener('click', function (e) { e.stopPropagation(); self.jumpTo('intro', 0, 0); });

      // click or tap anywhere on the car (or empty floor) to move on
      var stage = this.querySelector('.ss__stage');
      if (stage) stage.addEventListener('click', function () { self.step(1); });
      if (this.floor) this.floor.addEventListener('click', function () { self.step(1); });

      // arrow keys while the showroom fills the screen
      window.addEventListener('keydown', this.onKey = function (e) {
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
        var tag = (document.activeElement && document.activeElement.tagName) || '';
        if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
        var r = self.getBoundingClientRect();
        if (r.top > 1 || r.bottom < window.innerHeight - 1) return;
        if (e.key === 'ArrowRight') { e.preventDefault(); self.step(1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); self.step(-1); }
      });
    }

    // scroll position (as a fraction of the walk segment) that shows angle j cleanly
    walkP(j, n) {
      if (n < 2) return .5;
      var u = j / (n - 1), lo = 0, hi = 1;
      for (var k = 0; k < 30; k++) { var m = (lo + hi) / 2; if (ease(m) < u) lo = m; else hi = m; }
      var p = .08 + lo * .84;
      return j === 0 ? Math.max(p, .16) : p; // angle 0: wait until the panel is in
    }

    goCar(i, j) {
      var n = this.cars[i]._frames.length;
      j = clamp(j, 0, n - 1);
      this.jumpTo('walk', i, this.walkP(j, n));
    }

    nextCar() {
      var c = this.cur ? this.cur.car : 0;
      if (c + 1 < this.cars.length) this.goCar(c + 1, 0);
      else this.jumpTo('outro', c, 1);
    }

    // one click / tap / arrow press = one step through the showroom
    step(dir) {
      var c = this.cur || { type: 'intro', car: 0, frame: 0, frames: 1 }, last = this.cars.length - 1;
      if (c.type === 'walk') {
        var j = c.frame + dir;
        if (j >= 0 && j < c.frames) return this.goCar(c.car, j);
        if (dir > 0) return this.nextCar();
        if (c.car > 0) return this.goCar(c.car - 1, this.cars[c.car - 1]._frames.length - 1);
        return this.jumpTo('intro', 0, 0);
      }
      if (dir > 0) {
        if (c.type === 'intro' || c.type === 'dive') return this.goCar(c.car, 0);
        if (c.type === 'outro') return;
        return c.car < last ? this.goCar(c.car + 1, 0) : this.jumpTo('outro', c.car, 1);
      }
      if (c.type === 'intro') return;
      var target = c.type === 'dive' ? c.car - 1 : c.car;
      if (target < 0) return this.jumpTo('intro', 0, 0);
      this.goCar(target, this.cars[target]._frames.length - 1);
    }

    // timeline in "screens" of scrolling
    buildTimeline() {
      var segs = [{ type: 'intro', len: 1.1 }];
      var n = this.cars.length;
      for (var i = 0; i < n; i++) {
        segs.push({ type: 'dive', car: i, len: .7 });
        segs.push({ type: 'walk', car: i, len: Math.max(1.6, this.cars[i]._frames.length * .5) });
        segs.push({ type: 'rise', car: i, len: .6 });
        if (i < n - 1) segs.push({ type: 'pan', car: i, len: .8 });
      }
      segs.push({ type: 'outro', car: n - 1, len: .5 });
      var at = 0;
      segs.forEach(function (s) { s.start = at; at += s.len; });
      this.segs = segs;
      this.total = at;
    }

    onResize() {
      var w = window.innerWidth;
      // keep the height steady while a phone's address bar hides and shows
      if (!this.vh || Math.abs(w - this.lastW) > 40 || !('ontouchstart' in window)) {
        this.vh = window.innerHeight;
        this.lastW = w;
      }
      this.style.setProperty('--ss-vh', this.vh + 'px');
      this.style.height = (this.total * this.vh + this.vh) + 'px';
      this.phone = w < 750;
      this.onScroll();
    }

    jumpTo(type, car, p) {
      var s = this.segs.find(function (s) { return s.type === type && (s.car === undefined || s.car === car); });
      if (!s) return;
      var top = this.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: top + (s.start + s.len * p) * this.vh, behavior: reduce.matches ? 'auto' : 'smooth' });
    }

    onScroll() {
      if (this.ticking) return;
      this.ticking = true;
      var self = this;
      requestAnimationFrame(function () { self.ticking = false; self.render(); });
    }

    render() {
      var rect = this.getBoundingClientRect();
      var t = clamp(-rect.top / this.vh, 0, this.total - 0.0001);
      var seg = this.segs[0];
      for (var i = 0; i < this.segs.length; i++) if (t >= this.segs[i].start) seg = this.segs[i];
      var p = clamp((t - seg.start) / seg.len, 0, 1);

      var W = this.sticky.clientWidth, H = this.sticky.clientHeight;
      var close = Math.min(H / (BAY_H + 150), W / (BAY_W * (this.phone ? 1.25 : 2.2)));
      var wide = Math.min(W / (this.floorW + 40), H / (this.floorH + 40));
      wide = Math.min(wide, close * .8);
      var cx, cy, s, floorOp = 1, carOp = 0, carIdx = seg.car || 0, frameF = 0, carZoom = 1, blur = 0, panel = 0, titleOp = 0;
      var b = this.bays;

      if (seg.type === 'intro') {
        var e = ease(span(p, .25, 1));
        var fx = this.floorW / 2, fy = this.floorH / 2;
        cx = lerp(fx, b[0].cx, e); cy = lerp(fy, b[0].cy, e); s = lerp(wide, close, e);
        titleOp = 1 - span(p, .35, .75);
        carIdx = 0;
      } else if (seg.type === 'dive') {
        var d = ease(p);
        cx = b[carIdx].cx; cy = b[carIdx].cy; s = close * lerp(1, 3.2, d);
        floorOp = 1 - span(p, .2, .45);
        carOp = span(p, .3, .6);
        carZoom = lerp(1.22, 1, ease(span(p, .3, 1)));
        blur = lerp(14, 0, span(p, .3, .9));
      } else if (seg.type === 'walk') {
        cx = b[carIdx].cx; cy = b[carIdx].cy; s = close * 3.2;
        floorOp = 0; carOp = 1;
        frameF = ease(span(p, .08, .92)) * (this.cars[carIdx]._frames.length - 1);
        panel = ease(span(p, 0, .14));
      } else if (seg.type === 'rise') {
        var r = ease(p);
        cx = b[carIdx].cx; cy = b[carIdx].cy; s = close * lerp(3.2, 1, r);
        floorOp = span(p, .5, .8);
        carOp = 1 - span(p, .3, .6);
        carZoom = lerp(1, 1.18, r);
        blur = lerp(0, 12, span(p, .15, .7));
        frameF = this.cars[carIdx]._frames.length - 1;
        panel = 1 - span(p, 0, .35);
      } else if (seg.type === 'pan') {
        var q = ease(p);
        cx = lerp(b[carIdx].cx, b[carIdx + 1].cx, q); cy = b[carIdx].cy;
        s = close * (1 - .22 * Math.sin(Math.PI * p));
      } else { // outro
        cx = lerp(b[carIdx].cx, this.floorW / 2, ease(p)); cy = lerp(b[carIdx].cy, this.floorH / 2, ease(p));
        s = lerp(close, wide, ease(p));
        titleOp = span(p, .4, 1);
      }

      // floor camera
      this.cam.style.transform = 'translate(' + (W / 2) + 'px,' + (H / 2) + 'px) scale(' + s + ') translate(' + (-cx) + 'px,' + (-cy) + 'px)';
      this.floor.style.opacity = floorOp;
      this.floor.style.visibility = floorOp <= 0.001 ? 'hidden' : 'visible';
      if (this.titleEl) this.titleEl.style.opacity = titleOp;
      var bayOn = seg.type === 'pan' ? Math.round(lerp(carIdx, carIdx + 1, ease(p))) : carIdx;
      b.forEach(function (bay, k) { bay.g.classList.toggle('is-on', k === bayOn); });
      this.cur = { type: seg.type, car: carIdx, frame: Math.round(frameF), frames: this.cars[carIdx]._frames.length };

      // cars
      var self = this;
      this.cars.forEach(function (car, k) {
        var on = k === carIdx && carOp > 0.001;
        car.classList.toggle('is-on', on);
        car.style.opacity = on ? carOp : 0;
        if (!on) return;
        car._wrap.style.transform = 'scale(' + carZoom.toFixed(4) + ')';
        // desktop: size the photos so they always fill the height, and centre the car in the
        // space left of the panel, a little smaller so long cars (side view) fit beside it
        var box = null;
        if (!self.phone) {
          var pw = self.panel ? self.panel.offsetWidth * panel : 0;
          var iw = Math.max(W * (1 - .45 * pw / W), (H + 2) / .75, W - pw), ih = iw * .75;
          box = { l: ((W - pw) / 2 - iw / 2).toFixed(1) + 'px', t: ((H - ih) * .72).toFixed(1) + 'px', w: iw.toFixed(1) + 'px', h: ih.toFixed(1) + 'px' };
        }
        car._wrap.style.filter = blur > .2 ? 'blur(' + blur.toFixed(1) + 'px)' : 'none';
        // each angle holds, then the next one fades in on top quickly
        var base = Math.floor(frameF), mix = span(frameF - base, .62, .92);
        car._frames.forEach(function (img, j) {
          var dist = j - frameF;
          var op = j === base ? 1 : j === base + 1 ? mix : 0;
          img.style.opacity = op.toFixed(3);
          if (box) { img.style.left = box.l; img.style.top = box.t; img.style.width = box.w; img.style.height = box.h; img.style.right = 'auto'; img.style.bottom = 'auto'; }
          else if (img.style.width) { img.style.left = img.style.top = img.style.width = img.style.height = img.style.right = img.style.bottom = ''; }
          // small sideways drift and zoom so the cut between angles feels like a camera move
          img.style.transform = reduce.matches ? 'none' : 'translateX(' + (dist * -3).toFixed(2) + '%) scale(' + (1.02 + Math.abs(dist) * .03).toFixed(3) + ')';
        });
      });

      // panel and UI
      var showUi = (seg.type === 'walk' || seg.type === 'dive' && p > .6 || seg.type === 'rise' && p < .4) ? 1 : 0;
      this.style.setProperty('--ss-ui', showUi);
      this.style.setProperty('--ss-ui-pe', showUi ? 'auto' : 'none');
      this.style.setProperty('--ss-panel-x', ((1 - panel) * 105) + '%');
      this.style.setProperty('--ss-panel-y', ((1 - panel) * 105) + '%');
      if (this.panel) this.panel.inert = panel < .5;
      if (this.filled !== carIdx) this.fillPanel(carIdx);
      var fi = Math.round(frameF);
      this.angleEls.forEach(function (a, j) { a.classList.toggle('is-on', j === fi); a.hidden = j >= self.cars[carIdx]._frames.length; });
      this.dotEls.forEach(function (d, j) { d.classList.toggle('is-on', j === carIdx); });
      if (this.nextBtn) this.nextBtn.textContent = carIdx < this.cars.length - 1 ? 'Next car \u203a' : 'Finish \u203a';
    }

    fillPanel(i) {
      this.filled = i;
      var car = this.cars[i], info = car._info, q = function (s) { return this.querySelector(s); }.bind(this.panel);
      if (!this.panel) return;
      var meta = [info.year, info.km, info.origin].filter(Boolean).join('  ·  ');
      q('[data-ss-meta]').textContent = meta || (car.getAttribute('data-vendor') || '');
      q('[data-ss-name]').textContent = car.getAttribute('data-title') || '';
      q('[data-ss-price]').textContent = car.getAttribute('data-price') || '';
      var list = q('[data-ss-specs]');
      list.textContent = '';
      info.specs.forEach(function (s) {
        var li = document.createElement('li');
        var a = document.createElement('span'); a.textContent = s.k;
        var b = document.createElement('span'); b.textContent = s.v;
        li.appendChild(a); li.appendChild(b); list.appendChild(li);
      });
      list.hidden = !info.specs.length;
      var url = car.getAttribute('data-url') || '#';
      q('[data-ss-link]').setAttribute('href', url);
      var enq = q('[data-ss-enquire]');
      if (enq && enq.hasAttribute('data-wa')) {
        var msg = 'Hi Sisma, I\'m interested in the ' + (car.getAttribute('data-title') || '') + ' (' + location.origin + url + ')';
        enq.setAttribute('href', 'https://wa.me/' + enq.getAttribute('data-wa') + '?text=' + encodeURIComponent(msg));
      }
      // hire-purchase estimate: flat rate, as Malaysian car loans are quoted
      var price = parseFloat(car.getAttribute('data-price-num') || '0');
      var est = q('[data-ss-est]');
      if (price > 0 && est) {
        var loan = price * (1 - this.deposit);
        var monthly = loan * (1 + this.rate * this.years) / (this.years * 12);
        q('[data-ss-est-val]').textContent = this.currency + ' ' + Math.round(monthly).toLocaleString('en-US') + ' / month';
        q('[data-ss-est-note]').textContent = Math.round(this.deposit * 100) + '% down, ' + this.years + ' years at ' + (this.rate * 100).toFixed(2).replace(/\.?0+$/, '') + '% flat. Estimate only, subject to bank approval.';
        est.hidden = false;
      } else if (est) est.hidden = true;
    }
  }

  customElements.define('sisma-scroll-showroom', SismaScrollShowroom);
})();
