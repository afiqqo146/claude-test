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
  var BAY_W = 150, BAY_H = 250, LANE = 120;

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

  // average body colour from the side photo, for the overhead car shape
  function bodyColour(img) {
    try {
      var c = document.createElement('canvas'), w = 48, h = 36;
      c.width = w; c.height = h;
      var x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0, w, h);
      var d = x.getImageData(0, 0, w, h).data;
      var px = function (fx, fy) { var i = (Math.floor(fy * h) * w + Math.floor(fx * w)) * 4; return [d[i], d[i + 1], d[i + 2]]; };
      // studio wall and floor, sampled at the edges where there is no car
      var bgs = [px(.03, .4), px(.03, .55), px(.03, .75), px(.03, .9), px(.97, .5), px(.97, .85)];
      var near = function (r, g, b) {
        return bgs.some(function (c) { return Math.abs(r - c[0]) + Math.abs(g - c[1]) + Math.abs(b - c[2]) < 42; });
      };
      var buckets = {}, best = null, bestN = 0, grey = [0, 0, 0, 0], total = 0;
      for (var yy = Math.floor(h * .5); yy < h * .78; yy++) {
        for (var xx = Math.floor(w * .18); xx < w * .82; xx++) {
          var i = (yy * w + xx) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
          if (near(r, g, b)) continue;
          total++;
          var mx = Math.max(r, g, b), mn = Math.min(r, g, b), s = mx ? (mx - mn) / mx : 0;
          if (s > .28 && mx > 60) { // coloured paint
            var k = (r >> 5) + ',' + (g >> 5) + ',' + (b >> 5);
            var e = buckets[k] || (buckets[k] = [0, 0, 0, 0]);
            e[0] += r; e[1] += g; e[2] += b; e[3]++;
            if (e[3] > bestN) { bestN = e[3]; best = e; }
          } else if (mx > 30) { // white, silver, grey or black paint (tyre/shadow black skipped)
            grey[0] += r; grey[1] += g; grey[2] += b; grey[3]++;
          }
        }
      }
      var pick = best && bestN > total * .12 ? best : grey[3] ? grey : null;
      if (!pick) return null;
      return 'rgb(' + Math.round(pick[0] / pick[3]) + ',' + Math.round(pick[1] / pick[3]) + ',' + Math.round(pick[2] / pick[3]) + ')';
    } catch (err) { return null; } // cross-origin image without CORS
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

      var self = this;
      this.cars.forEach(function (car, i) {
        car._frames = Array.prototype.slice.call(car.querySelectorAll('.ss__frames img'));
        car._wrap = car.querySelector('.ss__frames');
        car._info = parseSpecs(car.getAttribute('data-desc'));
        car._colour = car.getAttribute('data-colour') || null;
        var side = car._frames[2] || car._frames[0];
        var grab = function () {
          if (!car._colour) { car._colour = bodyColour(side); self.paintBay(i); }
        };
        if (side && side.complete && side.naturalWidth) grab(); else if (side) side.addEventListener('load', grab, { once: true });
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
    }

    // ---- overhead floor: one lit bay per car ----
    buildFloor() {
      var n = this.cars.length;
      this.floorW = n * BAY_W + LANE * 2;
      this.floorH = BAY_H + LANE * 2;
      var svg = el('svg', { width: this.floorW, height: this.floorH, viewBox: '0 0 ' + this.floorW + ' ' + this.floorH, 'aria-hidden': 'true' });
      var defs = el('defs', {}, svg);
      var glow = el('radialGradient', { id: 'ssGlow' }, defs);
      el('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '.32' }, glow);
      el('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' }, glow);
      el('rect', { x: 0, y: 0, width: this.floorW, height: this.floorH, fill: 'transparent' }, svg);
      // lane marking along the front of the bays
      el('line', { x1: 40, x2: this.floorW - 40, y1: LANE + BAY_H + 46, y2: LANE + BAY_H + 46, stroke: 'rgba(255,255,255,.35)', 'stroke-width': 3, 'stroke-dasharray': '26 18' }, svg);
      this.bays = [];
      for (var i = 0; i < n; i++) {
        var x = LANE + i * BAY_W, y = LANE;
        var g = el('g', { transform: 'translate(' + x + ',' + y + ')' }, svg);
        el('ellipse', { cx: BAY_W / 2, cy: BAY_H / 2, rx: BAY_W * .62, ry: BAY_H * .5, fill: 'url(#ssGlow)' }, g);
        // the hexagon light from the studio ceiling, seen from above
        var hx = BAY_W / 2, hy = BAY_H / 2, rw = 62, rh = 112, cut = 30;
        el('polygon', {
          points: [hx - rw + cut, hy - rh, hx + rw - cut, hy - rh, hx + rw, hy - rh + cut * 1.6, hx + rw, hy + rh - cut * 1.6, hx + rw - cut, hy + rh, hx - rw + cut, hy + rh, hx - rw, hy + rh - cut * 1.6, hx - rw, hy - rh + cut * 1.6].join(' '),
          fill: 'none', stroke: 'rgba(255,255,255,.75)', 'stroke-width': 3, class: 'ss-hex'
        }, g);
        if (i === 0) el('line', { x1: 0, x2: 0, y1: 0, y2: BAY_H, stroke: 'rgba(255,255,255,.55)', 'stroke-width': 3 }, g);
        el('line', { x1: BAY_W, x2: BAY_W, y1: 0, y2: BAY_H, stroke: 'rgba(255,255,255,.55)', 'stroke-width': 3 }, g);
        // top-down car
        var car = el('g', { transform: 'translate(' + (BAY_W / 2 - 34) + ',' + (BAY_H / 2 - 82) + ')' }, g);
        el('rect', { x: 4, y: 10, width: 60, height: 150, rx: 6, fill: 'rgba(0,0,0,.35)', filter: '' }, car);
        var body = el('rect', { x: 0, y: 0, width: 68, height: 164, rx: 22, fill: '#b9b9b6' }, car);
        el('rect', { x: 8, y: 40, width: 52, height: 26, rx: 8, fill: 'rgba(10,12,16,.78)' }, car);   // windscreen
        el('rect', { x: 10, y: 70, width: 48, height: 52, rx: 6, fill: 'rgba(255,255,255,.12)' }, car); // roof
        el('rect', { x: 10, y: 124, width: 48, height: 18, rx: 6, fill: 'rgba(10,12,16,.7)' }, car);  // rear glass
        el('rect', { x: -6, y: 44, width: 8, height: 10, rx: 3, fill: 'rgba(10,12,16,.75)' }, car);
        el('rect', { x: 66, y: 44, width: 8, height: 10, rx: 3, fill: 'rgba(10,12,16,.75)' }, car);
        // bay number painted on the floor
        var t = el('text', { x: BAY_W / 2, y: BAY_H + 30, 'text-anchor': 'middle', fill: 'rgba(255,255,255,.8)', 'font-size': 15, 'font-weight': 700, 'letter-spacing': 3, 'font-family': 'ui-monospace, Menlo, monospace' }, g);
        t.textContent = 'BAY ' + String(i + 1).padStart(2, '0');
        this.bays.push({ cx: x + BAY_W / 2, cy: y + BAY_H / 2, body: body, hex: g.querySelector('.ss-hex') });
        this.paintBay(i);
      }
      this.cam.appendChild(svg);
    }

    paintBay(i) {
      if (!this.bays || !this.bays[i]) return;
      var c = this.cars[i]._colour;
      if (c) this.bays[i].body.setAttribute('fill', c);
    }

    buildUi() {
      var self = this;
      var labels = (this.getAttribute('data-angles') || 'Front,Front 3/4,Side,Rear 3/4,Rear').split(',');
      this.angleEls = [];
      if (this.anglesEl) {
        var max = Math.max.apply(null, this.cars.map(function (c) { return c._frames.length; }));
        for (var i = 0; i < max; i++) {
          var a = document.createElement('span');
          a.className = 'ss__angle';
          a.textContent = labels[i] || ('View ' + (i + 1));
          this.anglesEl.appendChild(a);
          this.angleEls.push(a);
        }
      }
      this.dotEls = [];
      if (this.dotsEl) {
        this.cars.forEach(function (car, i) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'ss__dot';
          b.setAttribute('aria-label', 'Go to ' + (car.getAttribute('data-title') || 'car ' + (i + 1)));
          b.addEventListener('click', function () { self.jumpTo('walk', i, .02); });
          self.dotsEl.appendChild(b);
          self.dotEls.push(b);
        });
      }
      var back = this.querySelector('.ss__back');
      if (back) back.addEventListener('click', function () { self.jumpTo('intro', 0, 0); });
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
      var close = Math.min(H / (BAY_H + 120), W / (BAY_W * 2.4)) * 1.0;
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
      b.forEach(function (bay, k) { bay.hex.setAttribute('stroke', k === bayOn ? 'rgba(255,214,140,.98)' : 'rgba(255,255,255,.55)'); });

      // cars
      var self = this;
      this.cars.forEach(function (car, k) {
        var on = k === carIdx && carOp > 0.001;
        car.classList.toggle('is-on', on);
        car.style.opacity = on ? carOp : 0;
        if (!on) return;
        var drift = self.phone ? 0 : -panel * 0.13 * W; // move the car left to make room for the panel
        car._wrap.style.transform = 'translateX(' + drift + 'px) scale(' + carZoom + ')';
        car._wrap.style.filter = blur > .2 ? 'blur(' + blur.toFixed(1) + 'px)' : 'none';
        // each angle holds, then the next one fades in on top quickly
        var base = Math.floor(frameF), mix = span(frameF - base, .62, .92);
        car._frames.forEach(function (img, j) {
          var dist = j - frameF;
          var op = j === base ? 1 : j === base + 1 ? mix : 0;
          img.style.opacity = op.toFixed(3);
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
