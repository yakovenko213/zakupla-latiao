(function () {
  'use strict';
  var LS_KEY = 'autopurchase-openai-settings-v1', DB_NAME = 'autopurchase-local-v1';
  var history = {}, last = null, importedRows = [], applicationRows = [];
  function $(s) { return document.querySelector(s); }
  function val(s) { var e = $(s); return Number(((e && e.value) || '').replace(',', '.')) || 0; }
  function ev(e) { return Number(((e && e.value) || '').replace(',', '.')) || 0; }
  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function cash(v) { return v.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' грн'; }
  function purchaseTargets() { return typeof window.autopurchasePurchaseTargets === 'function' ? window.autopurchasePurchaseTargets() : []; }
  function commitParcels(parcels) {
    var target = $('#autoTargetPurchase'), targetPid = target && target.value;
    if (!targetPid) { alert('Оберіть існуючу закупку, до якої потрібно додати посилки'); return; }
    if (!parcels.length) { alert('Оберіть хоча б одну посилку'); return; }
    var total = parcels.reduce(function (sum, p) { return sum + p.total; }, 0);
    if (confirm('Додати ' + parcels.length + ' посилок на ' + cash(total) + ' до обраної закупки?')) {
      window.dispatchEvent(new CustomEvent('autopurchase:commit', { detail: { plan: { parcels: parcels }, options: last.options, targetPid: targetPid } }));
    }
  }
  function createPurchaseFromPlan(parcels) {
    if (!parcels.length) { alert('Оберіть хоча б одну посилку'); return; }
    var total = parcels.reduce(function (sum, p) { return sum + p.total; }, 0);
    if (confirm('Створити нову закупку з ' + parcels.length + ' посилок на ' + cash(total) + '?')) {
      window.dispatchEvent(new CustomEvent('autopurchase:commit', { detail: { plan:{ parcels:parcels }, options:last.options, createNew:true } }));
    }
  }
  function articleKey(v) { return String(v == null ? '' : v).replace(/[\u00a0\s]/g, '').replace(/^['"`]+/, '').replace(/\.0+$/, '').toLowerCase(); }
  function numeric(v) { if (typeof v === 'number') return isFinite(v) ? v : 0; var n = Number(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.+-]/g, '')); return isFinite(n) ? n : 0; }
  function settings() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (_) { return {}; } }
  function saveSettings() { localStorage.setItem(LS_KEY, JSON.stringify({ token: $('#autoToken').value.trim(), model: $('#autoModel').value })); }
  function options() { return { tariff: val('#autoTariff'), rate: val('#autoRate'), surcharge: val('#autoSurcharge'), limit: val('#autoLimit'), boxes: { small: val('#autoBoxS'), medium: val('#autoBoxM'), large: val('#autoBoxL') } }; }
  function fileData(file) { return new Promise(function (ok, no) { var r = new FileReader(); r.onload = function () { ok(String(r.result)); }; r.onerror = no; r.readAsDataURL(file); }); }
  function dbOpen() { return new Promise(function (ok, no) { var r = indexedDB.open(DB_NAME, 1); r.onupgradeneeded = function () { r.result.createObjectStore('data'); }; r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error); }; }); }
  function storeRows(rows) { return dbOpen().then(function (db) { return new Promise(function (ok, no) { var tx = db.transaction('data', 'readwrite'); tx.objectStore('data').put(rows, 'history'); tx.oncomplete = function () { db.close(); ok(); }; tx.onerror = function () { no(tx.error); }; }); }); }
  function loadRows() { return dbOpen().then(function (db) { return new Promise(function (ok, no) { var r = db.transaction('data').objectStore('data').get('history'); r.onsuccess = function () { db.close(); ok(r.result || []); }; r.onerror = function () { no(r.error); }; }); }); }
  function rebuild() { build(applicationRows.concat(importedRows)); }
  function build(rows) { history = {}; (rows || []).forEach(function (raw) { var r = Object.assign({}, raw), key = articleKey(r.article != null ? r.article : (r.art != null ? r.art : r['Артикул'])); if (!key) return; r.article = key; r.qty = numeric(r.qty != null ? r.qty : (r.quantity != null ? r.quantity : r['К-сть'])); r.sum = numeric(r.sum != null ? r.sum : (r.total != null ? r.total : r['Сума закупки'])); r.weightTotal = numeric(r.weightTotal != null ? r.weightTotal : (r.totalWeight != null ? r.totalWeight : r['ВАГА ТОВАРУ НА СКЛАДІ'])); r.unitPrice = numeric(r.unitPrice != null ? r.unitPrice : r.price); r.unitWeight = numeric(r.unitWeight != null ? r.unitWeight : r.weight); (history[key] || (history[key] = [])).push(r); }); }
  function outputText(x) { if (x.output_text) return x.output_text; return (x.output || []).reduce(function (all, item) { return all.concat(item.content || []); }, []).map(function (c) { return c.text || ''; }).join(''); }
  function analyzeFile(file) {
    var cfg = settings(); if (!cfg.token) return Promise.reject(Error('Спочатку збережіть API-ключ OpenAI на цьому ПК'));
    return fileData(file).then(function (data) {
      var prompt = 'Прочитай УСІ вкладки цієї таблиці. Ігноруй вкладки: транзакції, оплати, Рахуємо вагу, чистий бланк. Знайди колонки за змістом заголовків: Артикул, К-сть, Сума закупки, ВАГА ТОВАРУ НА СКЛАДІ, ВИКУП?. Одна посилка — об’єднані клітинки суми/ваги або однаковий фон. Пропусти помилки формул, порожню суму/артикул, повернення і снеки. Артикули через перенос розділи. Якщо одна сума повторена в групі, розподіли її пропорційно кількості, щоб сума рядків дорівнювала сумі групи. Поверни ВИКЛЮЧНО JSON-масив без markdown: [{"article":"3250","qty":40,"sum":133,"weightTotal":0.8,"purchased":true,"date":1,"source":"назва вкладки"}]. sum — гривні; для вкладок у доларах помнож суму на курс ' + val('#autoRate') + '. Не вигадуй відсутні числа, використовуй null.';
      return fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'Authorization': 'Bearer ' + cfg.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: cfg.model || 'gpt-5-mini', input: [{ role: 'user', content: [{ type: 'input_file', filename: file.name, file_data: data }, { type: 'input_text', text: prompt }] }] }) });
    }).then(function (r) { return r.json().then(function (x) { if (!r.ok) throw Error((x.error && x.error.message) || 'OpenAI API: ' + r.status); return x; }); }).then(function (x) { var text = outputText(x), m = text.match(/\[[\s\S]*\]/); if (!m) throw Error('ШІ не повернув таблицю у форматі JSON'); var rows = JSON.parse(m[0]); if (!Array.isArray(rows)) throw Error('Некоректна відповідь ШІ'); return rows; });
  }
  function read() { var status = $('#autoSourceStatus'); status.textContent = 'Читаємо збережені дані…'; var cached = loadRows().catch(function () { return []; }), remote = window.AutoPurchaseDatabase ? window.AutoPurchaseDatabase.load().catch(function () { return []; }) : Promise.resolve([]), internal = $('#autoInternal').checked && typeof window.autopurchaseRefreshData === 'function' ? window.autopurchaseRefreshData() : Promise.resolve([]); Promise.all([cached, remote, internal]).then(function (sets) { importedRows = sets[1].length ? sets[1] : sets[0]; applicationRows = Array.isArray(sets[2]) ? sets[2] : []; rebuild(); status.textContent = 'Готово: історія ' + importedRows.length + ' записів' + (sets[1].length ? ' із Firestore' : ' з резервної копії на ПК') + (applicationRows.length ? ' · із усіх закупок системи: ' + applicationRows.length : ''); }).catch(function (e) { status.textContent = 'Помилка читання: ' + e.message; }); }
  function upload() { var files = Array.from($('#autoFiles').files || []), status = $('#autoSourceStatus'); if (!files.length) return showError('Виберіть файл .xlsx, .xls або .csv'); status.textContent = 'ШІ аналізує всі вкладки…'; var all = []; files.reduce(function (p, file) { return p.then(function () { status.textContent = 'ШІ аналізує «' + file.name + '»…'; return analyzeFile(file).then(function (rows) { all = all.concat(rows); }); }); }, Promise.resolve()).then(function () { if (!all.length) throw Error('ШІ не знайшов придатних рядків'); return storeRows(all); }).then(function () { importedRows = all; rebuild(); status.textContent = 'Локальна копія готова: ' + all.length + ' записів. Зберігаємо у Firestore…'; if (!window.AutoPurchaseDatabase) throw Error('Firebase недоступний'); return window.AutoPurchaseDatabase.save(all, files.map(function (f) { return f.name; }).join(', ')); }).then(function () { status.textContent = 'Назавжди збережено у Firestore: ' + all.length + ' записів'; }).catch(function (e) { if (all.length) status.textContent = 'Дані прочитані й доступні для розрахунку (' + all.length + '), але Firestore відповів: ' + e.message; else status.textContent = 'Помилка аналізу: ' + e.message; }); }
  function choice(art) {
    var a = history[articleKey(art)] || [];
    var learned = AutoPurchaseCore.learnHistory(a);
    var catalog = typeof window.autopurchaseLookupArticle === 'function' ? window.autopurchaseLookupArticle(art) : null;
    var oldCatalogPrice = typeof window.autopurchaseCatalogPurchasePrice === 'function' ? numeric(window.autopurchaseCatalogPurchasePrice(art)) : 0;
    var catalogPrice = catalog ? numeric(catalog.price) : oldCatalogPrice;
    var catalogWeight = catalog ? numeric(catalog.weight) : 0;
    var learnedFacts = Math.max(learned.factualDelivery || 0, learned.factualWeight || 0);
    return { price:learned.price || catalogPrice || 0, weight:learned.weight || (catalogWeight > 0 ? catalogWeight * learned.weightFactor : 0), deliveryFactor:learned.deliveryFactor, warn:learnedFacts ? ('Артикул ' + art + ': прогноз уточнено за планом/фактом ' + learnedFacts + ' попередніх закупок.') : '', records:a.length, catalog:!!catalog };
  }
  function showError(s) { $('#autoResults').hidden = false; $('#autoResults').innerHTML = '<div class="auto-card auto-warn">' + esc(s) + '</div>'; }
  function calculate() {
    var button = $('#autoCalculate'), refresh = typeof window.autopurchaseRefreshData === 'function' ? window.autopurchaseRefreshData() : Promise.resolve();
    if (button) button.disabled = true;
    Promise.resolve(refresh).then(function (rows) { if (Array.isArray(rows)) { applicationRows = $('#autoInternal').checked ? rows : []; rebuild(); } }).catch(function () {}).then(function () {
      var warnings = [], combined = {};
      AutoPurchaseCore.parseText($('#autoOrder').value).forEach(function (x) { var key = articleKey(x.article); if (!combined[key]) combined[key] = { article:key, qty:0 }; combined[key].qty += x.qty; });
      var items = Object.keys(combined).map(function (key) { var x = combined[key], c = choice(key); if (c.warn) warnings.push(c.warn); return { article:key, qty:x.qty, price:c.price, weight:c.weight, deliveryFactor:c.deliveryFactor, records:c.records, catalog:c.catalog }; });
      var missing = items.filter(function (x) { return !x.price || !x.weight; });
      if (!items.length) return showError('Не розпізнано рядків. Формат: 3250 - 40 шт');
      if (missing.length) return showError('Не вистачає даних після перевірки всіх закупок, імпортованої історії та каталогу: ' + missing.map(function (x) { var what = !x.price && !x.weight ? 'ціни й ваги' : (!x.price ? 'ціни' : 'ваги'); var found = []; if (x.records) found.push('історичних рядків: ' + x.records); if (x.catalog) found.push('товар є в каталозі'); return x.article + ' — ' + what + (found.length ? ' (' + found.join(', ') + ')' : ' (артикул ніде не знайдено)'); }).join('; ') + '.');
      try { last = { result:AutoPurchaseCore.optimize(items, options()), options:options() }; renderPlan(warnings); } catch (e) { showError(e.message); }
    }).finally(function () { if (button) button.disabled = false; });
  }
  function render(warnings) { var b = last.result.best, s = last.result.second, h = '<div class="auto-card"><h3>Найкращий план: ' + b.parcels.length + ' посилок</h3>' + (warnings.length ? '<p class="auto-warn">' + warnings.map(esc).join('<br>') + '</p>' : '') + '<div class="tablewrap"><table><thead><tr><th>Посилка</th><th>Артикул</th><th>К-сть</th><th>Вага</th><th>Товар</th><th>Доставка</th><th>Разом</th></tr></thead><tbody>'; b.parcels.forEach(function (p, i) { p.items.forEach(function (x, j) { h += '<tr><td>' + (j ? '' : i + 1) + '</td><td>' + esc(x.article) + '</td><td>' + x.qty + '</td><td>' + x.articleWeight.toFixed(3) + '</td><td>' + cash(x.price * x.qty) + '</td><td>' + cash(x.delivery) + '</td><td>' + cash(x.price * x.qty + x.delivery) + '</td></tr>'; }); }); h += '</tbody></table></div><p><b>Товар:</b> ' + cash(b.parcels.reduce(function (a, p) { return a + p.goods; }, 0)) + ' · <b>доставка:</b> ' + cash(b.parcels.reduce(function (a, p) { return a + p.delivery; }, 0)) + ' · <b>разом:</b> ' + cash(b.total) + '</p><p>Нижня межа: ' + last.result.lowerBound + ' посилок' + (s ? ' · другий варіант дорожчий на ' + cash(s.total - b.total) : '') + '</p><button class="btn primary" id="autoPreview">Записати в систему</button></div>'; $('#autoResults').hidden = false; $('#autoResults').innerHTML = h; $('#autoPreview').onclick = function () { if (confirm('Підтвердити запис плану на ' + cash(b.total) + '?')) window.dispatchEvent(new CustomEvent('autopurchase:commit', { detail: { plan: b, options: last.options } })); }; }
  function renderPlan(warnings) {
    var b = last.result.best, s = last.result.second;
    var h = '<div class="auto-card auto-plan"><h3>Найкращий план: ' + b.parcels.length + ' ' + (b.parcels.length === 1 ? 'посилка' : 'посилки') + '</h3>';
    if (warnings.length) h += '<p class="auto-warn">' + warnings.map(esc).join('<br>') + '</p>';
    b.parcels.forEach(function (p, i) {
      h += '<section class="auto-card auto-parcel"><h3><label class="auto-parcel-choice"><input class="auto-parcel-select" type="checkbox" data-parcel-index="' + i + '" checked><span>Посилка №' + (i + 1) + '</span></label></h3>' +
        '<div class="stats auto-kpis">' +
        '<div><small>Планова вага</small><b>' + p.weight.toFixed(3) + ' кг</b></div>' +
        '<div><small>Товар / коробка</small><b>' + p.goodsWeight.toFixed(3) + ' / ' + p.boxWeight.toFixed(3) + ' кг</b></div>' +
        '<div><small>Планова доставка</small><b>' + cash(p.delivery) + '</b></div>' +
        '<div><small>Закупівля товару</small><b>' + cash(p.goods) + '</b></div>' +
        '<div><small>Планові витрати</small><b>' + cash(p.total) + '</b></div>' +
        '<div><small>Середня собівартість</small><b>' + cash(p.averageUnitCost) + ' / пачка</b></div></div>' +
        '<div class="tablewrap"><table class="auto-plan-table"><thead><tr><th>Артикул</th><th>К-сть</th><th>Вага товару</th><th>Ціна пачки</th><th>Сума закупівлі</th><th>Доставка артикула</th><th>Доставка / пачка</th><th>Собівартість пачки</th><th>Повна собівартість</th></tr></thead><tbody>';
      p.items.forEach(function (x) {
        h += '<tr><td>' + esc(x.article) + '</td><td>' + x.qty + '</td><td>' + x.articleWeight.toFixed(3) + ' кг</td><td>' + cash(x.price) + '</td><td>' + cash(x.price * x.qty) + '</td><td>' + cash(x.delivery) + '</td><td>' + cash(x.delivery / x.qty) + '</td><td><b>' + cash(x.unitCost) + '</b></td><td>' + cash(x.unitCost * x.qty) + '</td></tr>';
      });
      h += '</tbody></table></div></section>';
    });
    h += '<div class="auto-summary"><span><b>Усього товар:</b> ' + cash(b.parcels.reduce(function (a, p) { return a + p.goods; }, 0)) + '</span><span><b>Доставка:</b> ' + cash(b.parcels.reduce(function (a, p) { return a + p.delivery; }, 0)) + '</span><span><b>Усі витрати:</b> ' + cash(b.total) + '</span></div>';
    var targets = purchaseTargets();
    h += '<p class="auto-plan-note">Нижня межа: ' + last.result.lowerBound + ' посилок' + (s ? ' · другий варіант дорожчий на ' + cash(s.total - b.total) : '') + '</p>' +
      '<div class="auto-commit-box"><label><span>Додати до закупки</span><select class="ul" id="autoTargetPurchase">' +
      (targets.length ? targets.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + (x.date ? ' · ' + esc(x.date) : '') + '</option>'; }).join('') : '<option value="">Немає створених закупок</option>') +
      '</select></label><div class="auto-commit-actions"><button class="btn" id="autoAddSelected" type="button"' + (targets.length ? '' : ' disabled') + '>Додати вибрані</button><button class="btn primary" id="autoAddAll" type="button"' + (targets.length ? '' : ' disabled') + '>Додати всі посилки</button><button class="btn auto-create-purchase" id="autoCreatePurchase" type="button">Створити нову закупку</button></div></div></div>';
    $('#autoResults').hidden = false; $('#autoResults').innerHTML = h;
    $('#autoAddSelected').onclick = function () {
      var selected = Array.from(document.querySelectorAll('.auto-parcel-select:checked')).map(function (e) { return b.parcels[Number(e.getAttribute('data-parcel-index'))]; }).filter(Boolean);
      commitParcels(selected);
    };
    $('#autoAddAll').onclick = function () { commitParcels(b.parcels.slice()); };
    $('#autoCreatePurchase').onclick = function () { createPurchaseFromPlan(b.parcels.slice()); };
  }
  document.addEventListener('DOMContentLoaded', function () { var cfg = settings(); $('#autoModel').value = cfg.model || 'gpt-5-mini'; $('#autoToken').value = cfg.token || ''; $('#autoBtn').onclick = function () { $('#autoModal').hidden = false; read(); }; $('#autoClose').onclick = function () { $('#autoModal').hidden = true; }; $('#autoUpload').onclick = upload; $('#autoRead').onclick = read; $('#autoCalculate').onclick = calculate; $('#autoSaveToken').onclick = function () { saveSettings(); alert('Ключ збережено локально у цьому браузері'); }; });
}());
