(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AutoPurchaseCore = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var D = { tariff: 16, rate: 47, surcharge: 2, limit: 9 };
  function n(v) { v = Number(v); return isFinite(v) ? v : 0; }
  function boxWeight(q, boxes) {
    boxes = boxes || { small: .2, medium: .3, large: .4 };
    return q <= 50 ? n(boxes.small) : q <= 150 ? n(boxes.medium) : n(boxes.large);
  }
  function normalize(items) {
    return (items || []).map(function (x) { return { article: String(x.article || x.art || '').trim(), qty: Math.max(0, Math.floor(n(x.qty))), price: n(x.price), weight: n(x.weight), deliveryFactor: n(x.deliveryFactor) || 1 }; }).filter(function (x) { return x.article && x.qty && x.weight > 0; });
  }
  function calculateParcel(items, options) {
    options = Object.assign({}, D, options || {}); items = normalize(items);
    var qty = items.reduce(function (s, x) { return s + x.qty; }, 0);
    var goodsWeight = items.reduce(function (s, x) { return s + x.qty * x.weight; }, 0);
    var selectedBox = options.boxWeight == null ? boxWeight(qty, options.boxes) : n(options.boxWeight);
    var weight = goodsWeight + selectedBox;
    var goods = items.reduce(function (s, x) { return s + x.qty * x.price; }, 0);
    var baseDelivery = (weight * options.tariff + options.surcharge * items.length) * options.rate;
    var delivery = 0;
    var rows = items.map(function (x, i) {
      var articleWeight = x.qty * x.weight;
      // Historical plan/fact ratios correct the tariff estimate for each article.
      var part = goodsWeight ? weight * options.tariff * options.rate * articleWeight / goodsWeight : 0;
      part += options.surcharge * options.rate;
      part *= x.deliveryFactor;
      delivery += part;
      return Object.assign({}, x, { articleWeight: articleWeight, delivery: part, unitCost: x.price + part / x.qty });
    });
    // Preserve the old exact result when no historical correction is present.
    if (items.every(function (x) { return x.deliveryFactor === 1; })) delivery = baseDelivery;
    return { items: rows, qty: qty, goodsWeight: goodsWeight, boxWeight: weight - goodsWeight, weight: weight, goods: goods, delivery: delivery, total: goods + delivery, averageUnitCost: qty ? (goods + delivery) / qty : 0 };
  }
  function signature(parcels) { return parcels.map(function (p) { return p.map(function (x) { return x.article + ':' + x.qty; }).sort().join('|'); }).sort().join(' / '); }
  function score(parcels, options) { var ps = parcels.map(function (p) { return calculateParcel(p, options); }); return { parcels: ps, total: ps.reduce(function (s, p) { return s + p.total; }, 0), signature: signature(parcels) }; }
  function withQty(parcel, src, qty) {
    var out = parcel.map(function (x) { return Object.assign({}, x); }), found = null;
    out.forEach(function (x) { if (x.article === src.article) found = x; });
    if (found) found.qty += qty; else out.push({ article: src.article, qty: qty, price: src.price, weight: src.weight, deliveryFactor: src.deliveryFactor });
    return out;
  }
  function maxFit(parcel, src, wanted, options) {
    var lo = 0, hi = wanted;
    while (lo < hi) { var mid = Math.ceil((lo + hi) / 2); if (calculateParcel(withQty(parcel, src, mid), options).weight <= options.limit + 1e-9) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function packUnits(items, options, order, fillGaps) {
    var parcels = [];
    order.forEach(function (idx) {
      var src = items[idx], left = src.qty;
      while (left) {
        var placed = false, bestParcel = -1, bestTake = 0;
        for (var p = 0; p < parcels.length; p++) {
          var takeExisting = maxFit(parcels[p], src, left, options);
          if (takeExisting === left) { bestParcel = p; bestTake = left; break; }
          if (fillGaps && takeExisting > bestTake) { bestParcel = p; bestTake = takeExisting; }
        }
        if (bestTake > 0) { parcels[bestParcel] = withQty(parcels[bestParcel], src, bestTake); left -= bestTake; placed = true; }
        if (!left) break;
        if (placed) continue;
        var max = maxFit([], src, left, options);
        if (max < 1) throw new Error('Одна пачка ' + src.article + ' перевищує ліміт посилки');
        var take = Math.min(left, max);
        parcels.push([{ article: src.article, qty: take, price: src.price, weight: src.weight }]); left -= take;
      }
    });
    // Consolidate/swap through best insertion of each split line.
    var changed = true, guard = 0;
    while (changed && guard++ < 20) {
      changed = false;
      outer: for (var a = parcels.length - 1; a >= 0; a--) for (var i = 0; i < parcels[a].length; i++) for (var b = 0; b < parcels.length; b++) if (a !== b) {
        var cand = withQty(parcels[b], parcels[a][i], parcels[a][i].qty);
        if (calculateParcel(cand, options).weight <= options.limit + 1e-9) { parcels[b] = cand; parcels[a].splice(i, 1); if (!parcels[a].length) parcels.splice(a, 1); changed = true; break outer; }
      }
    }
    return parcels;
  }
  function permutations(a, cb, at) { at = at || 0; if (at === a.length) return cb(a.slice()); for (var i = at; i < a.length; i++) { var t = a[at]; a[at] = a[i]; a[i] = t; permutations(a, cb, at + 1); t = a[at]; a[at] = a[i]; a[i] = t; } }
  function optimize(raw, opts) {
    var options = Object.assign({}, D, opts || {}), items = normalize(raw);
    var orders = [], base = items.map(function (_, i) { return i; });
    if (items.length <= 9) permutations(base.slice(), function (x) { orders.push(x); });
    else {
      orders.push(base.slice().sort(function (a, b) { return items[b].qty * items[b].weight - items[a].qty * items[a].weight; }));
      orders.push(base.slice().sort(function (a, b) { return items[b].weight - items[a].weight; }));
      for (var k = 0; k < 30; k++) orders.push(base.slice().sort(function () { return Math.random() - .5; }));
    }
    var seen = {}, plans = [];
    orders.forEach(function (o) { [false, true].forEach(function (fill) { var s = score(packUnits(items, options, o, fill), options); if (!seen[s.signature]) { seen[s.signature] = 1; plans.push(s); } }); });
    plans.sort(function (a, b) { return a.total - b.total || a.parcels.length - b.parcels.length; });
    return { best: plans[0] || score([], options), second: plans[1] || null, lowerBound: Math.ceil((items.reduce(function (s, x) { return s + x.qty * x.weight; }, 0) + n((options.boxes || {}).small || .2)) / options.limit) };
  }
  function parseText(text) {
    var out = [];
    String(text || '').split(/[\n;,]+/).forEach(function (line) { var m = line.trim().match(/^(.+?)\s*(?:[-–—:]|\s)\s*(\d+(?:[.,]\d+)?)\s*(?:шт\.?)?\s*$/i); if (m) out.push({ article: m[1].trim(), qty: Math.floor(Number(m[2].replace(',', '.'))) }); });
    return out;
  }
  function median(a) { a = a.filter(function (x) { return isFinite(x); }).sort(function (x, y) { return x - y; }); if (!a.length) return null; var m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
  function boundedRatio(values, lo, hi) {
    var m = median(values.filter(function (x) { return x > 0; }));
    if (m == null) return 1;
    // These are facts for the exact same article. Applying only part of the
    // deviation systematically underestimates a repeat purchase when there is
    // just one previous parcel. Median + bounds handle noisy history instead.
    return Math.max(lo, Math.min(hi, m));
  }
  function learnHistory(records) {
    records = (records || []).filter(function (r) { return r && n(r.qty) > 0; });
    var prices = [], weights = [], deliveryRatios = [], weightRatios = [];
    records.forEach(function (r) {
      var q = n(r.qty), actualPrice = n(r.actualUnitPrice) || (n(r.sum) > 0 ? n(r.sum) / q : 0);
      var actualWeight = n(r.actualUnitWeight) || (n(r.weightTotal) > 0 ? n(r.weightTotal) / q : 0);
      if (actualPrice > 0) prices.push(actualPrice);
      if (actualWeight > 0) weights.push(actualWeight);
      var pd = n(r.planDelivery), fd = n(r.actualDelivery);
      if (pd > 0 && fd > 0) deliveryRatios.push(fd / pd);
      else {
        var pc = n(r.planUnitCost), fc = n(r.actualUnitCost);
        if (pc > actualPrice && fc > actualPrice) deliveryRatios.push((fc - actualPrice) / (pc - actualPrice));
      }
      var pw = n(r.planParcelWeight), fw = n(r.actualParcelWeight);
      if (pw > 0 && fw > 0) weightRatios.push(fw / pw);
    });
    return { price:median(prices), weight:median(weights), weightFactor:boundedRatio(weightRatios, .7, 1.5), deliveryFactor:boundedRatio(deliveryRatios, .6, 1.8), records:records.length, factualDelivery:deliveryRatios.length, factualWeight:weightRatios.length };
  }
  return { defaults: D, boxWeight: boxWeight, calculateParcel: calculateParcel, optimize: optimize, parseText: parseText, median: median, learnHistory: learnHistory };
}));
