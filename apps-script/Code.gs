/**
 * Family Board family board: Google Apps Script backend.
 * Bind this script to the family Google Sheet (Extensions > Apps Script) and deploy it as a web app.
 *
 * Script Properties (Project Settings > Script properties), never stored in GitHub:
 *   PIN          the family PIN the board asks for (required)
 *   CALENDAR_ID  the shared Google calendar id (optional; without it, events are kept in the Events tab)
 *
 * API
 *   GET  ?action=all&pin=XXXX                         -> {ok, data:{settings, events, shopping, todos, meals, trips, notes}}
 *   POST (Content-Type text/plain, JSON body)          -> {ok, ...}
 *        {pin, by, action:"add",    type, item}
 *        {pin, by, action:"update", type, id, item}
 *        {pin, by, action:"delete", type, id}
 *        {pin, by, action:"toggle", type, id}          (shopping/todos: done, notes: pinned)
 *        {pin, by, action:"import", data:{...}}        (bulk add; skips duplicates)
 */

var SCHEMA = {
  Events:   ['id','title','date','time','end','endDate','location','notes','by','createdAt','updatedAt'],
  Shopping: ['id','item','qty','category','note','by','done','createdAt','updatedAt'],
  Todos:    ['id','task','assignee','due','done','by','createdAt','updatedAt','repeat','doneOn','history'],
  Meals:    ['id','date','title','serves','notes','recipes','by','createdAt','updatedAt'],
  Trips:    ['id','name','when','status','details','by','createdAt','updatedAt'],
  Notes:    ['id','text','pinned','by','createdAt','updatedAt'],
  Settings: ['key','value']
};
var TYPE_TO_SHEET = { events:'Events', shopping:'Shopping', todos:'Todos', meals:'Meals', trips:'Trips', notes:'Notes' };
var MAIN_FIELD = { events:'title', shopping:'item', todos:'task', meals:'title', trips:'name', notes:'text' };
var CAL_PAST_DAYS = 45, CAL_FUTURE_DAYS = 400;

/* ---------------- one-off setup (run from the editor) ---------------- */
function setup() {
  var ss = getSS_();
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var cols = SCHEMA[name];
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#f1e7da');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@'); // keep dates as plain text
  });
  var def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
  var st = ss.getSheetByName('Settings');
  if (st.getLastRow() < 2) {
    st.getRange(2, 1, 2, 2).setValues([['title', 'Family Board'], ['members', 'Person 1, Person 2, Person 3']]);
  }
  var props = PropertiesService.getScriptProperties();
  var msg = ['Sheet tabs are ready.'];
  if (!props.getProperty('PIN')) msg.push('Now set the PIN in Project Settings > Script properties.');
  var calId = props.getProperty('CALENDAR_ID');
  if (calId) {
    var cal = CalendarApp.getCalendarById(calId);
    msg.push(cal ? ('Calendar connected: ' + cal.getName()) : 'CALENDAR_ID is set but that calendar could not be opened by this account.');
  } else {
    msg.push('No CALENDAR_ID set, so events will be stored in the Events tab.');
  }
  Logger.log(msg.join('\n'));
  return msg.join('\n');
}

/** Run once from the editor to grant calendar permission and check access. */
function testCalendar() {
  var id = PropertiesService.getScriptProperties().getProperty('CALENDAR_ID');
  var cal = id ? CalendarApp.getCalendarById(id) : null;
  Logger.log(cal ? ('OK: ' + cal.getName() + ', ' + cal.getEvents(new Date(), new Date(Date.now() + 30 * 864e5)).length + ' events in the next 30 days') : 'Calendar not found');
}

/* ---------------- web app entry points ---------------- */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var auth = checkPin_(p.pin);
  if (auth) return json_(auth);
  if ((p.action || 'all') === 'all') return json_(readAll_());
  if (p.action === 'ping') return json_({ ok: true });
  return json_({ ok: false, error: 'unknown_action' });
}

function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  var auth = checkPin_(body.pin);
  if (auth) return json_(auth);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var by = String(body.by || '').slice(0, 40);
    switch (body.action) {
      case 'add':    return json_(add_(body.type, body.item || {}, by));
      case 'update': return json_(update_(body.type, body.id, body.item || {}, by, body.scope));
      case 'delete': return json_(remove_(body.type, body.id, body.scope));
      case 'toggle': return json_(toggle_(body.type, body.id));
      case 'import': return json_(importAll_(body.data || {}, by));
      default:       return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- PIN gate with lockout ---------------- */
function checkPin_(pin) {
  var real = PropertiesService.getScriptProperties().getProperty('PIN');
  if (!real) return { ok: false, error: 'pin_not_set' };
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('pin_fails') || 0);
  if (fails >= 10) return { ok: false, error: 'locked' };
  if (String(pin || '') !== String(real)) {
    cache.put('pin_fails', String(fails + 1), 600);
    return { ok: false, error: 'bad_pin' };
  }
  return null;
}

/* ---------------- read ---------------- */
function readAll_() {
  var out = { settings: readSettings_() };
  ['shopping', 'todos', 'meals', 'trips', 'notes'].forEach(function (t) { out[t] = readSheet_(TYPE_TO_SHEET[t]); });
  var cal = calendar_();
  var warning = '';
  if (cal) {
    try { out.events = readCalendar_(cal); }
    catch (err) { out.events = readSheet_('Events'); warning = 'Calendar could not be read: ' + err.message; }
  } else {
    out.events = readSheet_('Events');
    if (PropertiesService.getScriptProperties().getProperty('CALENDAR_ID')) warning = 'The Google calendar could not be opened, so events come from the Events tab.';
  }
  return { ok: true, data: out, warning: warning, serverTime: new Date().toISOString() };
}

function readSettings_() {
  var rows = sheet_('Settings').getDataRange().getValues().slice(1);
  var s = {};
  rows.forEach(function (r) { if (r[0]) s[String(r[0])] = String(r[1]); });
  if (s.members) s.members = s.members.split(',').map(function (x) { return x.trim(); }).filter(String);
  return s;
}

function readSheet_(name) {
  var sh = sheet_(name);
  var values = sh.getDataRange().getValues();
  var head = values.shift() || [];
  var tz = tz_();
  return values.filter(function (r) { return r[0] !== ''; }).map(function (r) {
    var o = {};
    head.forEach(function (h, i) {
      var v = r[i];
      if (v instanceof Date) v = Utilities.formatDate(v, tz, (h === 'time' || h === 'end') ? 'HH:mm' : 'yyyy-MM-dd');
      o[h] = v;
    });
    if ('done' in o) o.done = o.done === true || String(o.done).toUpperCase() === 'TRUE';
    if ('pinned' in o) o.pinned = o.pinned === true || String(o.pinned).toUpperCase() === 'TRUE';
    if (name === 'Todos' && o.repeat) o.done = String(o.doneOn || '') === Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    if (name === 'Meals') { try { o.recipes = JSON.parse(o.recipes || '[]'); } catch (e) { o.recipes = []; } }
    return o;
  });
}

/* ---------------- calendar ---------------- */
function calendar_() {
  var id = PropertiesService.getScriptProperties().getProperty('CALENDAR_ID');
  if (!id) return null;
  try { return CalendarApp.getCalendarById(id); } catch (e) { return null; }
}

function readCalendar_(cal) {
  var now = new Date();
  var from = new Date(now.getTime() - CAL_PAST_DAYS * 864e5), to = new Date(now.getTime() + CAL_FUTURE_DAYS * 864e5);
  return cal.getEvents(from, to).map(mapEvent_);
}

function mapEvent_(ev) {
  var tz = tz_();
  var s = ev.getStartTime(), e = ev.getEndTime();
  var recurring = ev.isRecurringEvent();
  var o = {
    id: recurring ? ev.getId() + '#' + s.getTime() : ev.getId(),
    title: ev.getTitle(),
    location: ev.getLocation(),
    notes: ev.getDescription(),
    recurring: recurring,
    source: 'calendar'
  };
  if (ev.isAllDayEvent()) {
    o.date = Utilities.formatDate(ev.getAllDayStartDate(), tz, 'yyyy-MM-dd');
    var last = new Date(ev.getAllDayEndDate().getTime() - 864e5);
    o.endDate = Utilities.formatDate(last, tz, 'yyyy-MM-dd');
    o.time = ''; o.end = '';
  } else {
    o.date = Utilities.formatDate(s, tz, 'yyyy-MM-dd');
    o.time = Utilities.formatDate(s, tz, 'HH:mm');
    o.end = Utilities.formatDate(e, tz, 'HH:mm');
    var ed = Utilities.formatDate(e, tz, 'yyyy-MM-dd');
    o.endDate = ed !== o.date ? ed : '';
  }
  return o;
}

function toDate_(ymd, hm) {
  var p = String(ymd).split('-').map(Number);
  var t = String(hm || '00:00').split(':').map(Number);
  // Script time zone is Europe/London (appsscript.json), so local constructor is correct.
  return new Date(p[0], p[1] - 1, p[2], t[0] || 0, t[1] || 0, 0);
}

function addCalendarEvent_(cal, item, by) {
  if (!item.title || !item.date) throw new Error('Event needs a title and date');
  var opts = { description: String(item.notes || ''), location: String(item.location || '') };
  var ev;
  if (item.time) {
    var start = toDate_(item.date, item.time);
    var end = item.end ? toDate_(item.endDate || item.date, item.end) : new Date(start.getTime() + 3600e3);
    if (end <= start) end = new Date(start.getTime() + 3600e3);
    ev = cal.createEvent(String(item.title), start, end, opts);
  } else if (item.endDate && item.endDate !== item.date) {
    var last = toDate_(item.endDate); last.setDate(last.getDate() + 1);
    ev = cal.createAllDayEvent(String(item.title), toDate_(item.date), last, opts);
  } else {
    ev = cal.createAllDayEvent(String(item.title), toDate_(item.date), opts);
  }
  return mapEvent_(ev);
}

function calendarEventExists_(cal, item) {
  var day = toDate_(item.date);
  var title = String(item.title).trim().toLowerCase();
  return cal.getEventsForDay(day).some(function (ev) { return ev.getTitle().trim().toLowerCase() === title; });
}

/**
 * Board ids: a normal event uses its iCalUID (getId(), e.g. "abc123@google.com").
 * One occurrence of a repeating event uses "<iCalUID>#<start millis>", because every occurrence
 * shares the same iCalUID. Older board versions used "@" instead of "#"; both are accepted.
 */
function parseEventId_(id) {
  var m = String(id || '').match(/^(.+)[#@](\d{10,})$/);
  return m ? { uid: m[1], start: Number(m[2]) } : { uid: String(id || ''), start: null };
}

function findCalendarEvent_(cal, id) {
  var p = parseEventId_(id);
  if (p.start === null) return cal.getEventById(p.uid);
  var t = new Date(p.start);
  // Exact occurrence: events overlapping a 2-second window around its start, matched on iCalUID and start time.
  var hits = cal.getEvents(new Date(p.start - 1000), new Date(p.start + 1000)).filter(function (ev) {
    return ev.getId() === p.uid && ev.getStartTime().getTime() === p.start;
  });
  if (hits.length) return hits[0];
  // Fallback: same iCalUID anywhere on that day (e.g. the start was edited in Google Calendar).
  var day = cal.getEventsForDay(t).filter(function (ev) { return ev.getId() === p.uid; });
  return day.length ? day[0] : null;
}

function sameWhen_(ev, item) {
  var cur = mapEvent_(ev);
  return cur.date === String(item.date || '') && cur.time === String(item.time || '') &&
    cur.end === String(item.end || (item.time ? cur.end : '')) &&
    (cur.endDate || cur.date) === String(item.endDate || item.date || '');
}

/* ---------------- write ---------------- */
function add_(type, item, by) {
  if (!TYPE_TO_SHEET[type]) return { ok: false, error: 'bad_type' };
  if (type === 'events') {
    var cal = calendar_();
    if (cal) return { ok: true, item: addCalendarEvent_(cal, item, by) };
  }
  var row = clean_(type, item);
  row.id = row.id || Utilities.getUuid();
  row.by = row.by || by;
  row.createdAt = row.createdAt || new Date().toISOString();
  row.updatedAt = new Date().toISOString();
  appendRow_(TYPE_TO_SHEET[type], row);
  return { ok: true, item: row };
}

function update_(type, id, item, by, scope) {
  if (!TYPE_TO_SHEET[type]) return { ok: false, error: 'bad_type' };
  if (type === 'events' && calendar_()) {
    var cal = calendar_();
    var ev = findCalendarEvent_(cal, id);
    if (!ev) return { ok: false, error: 'Event not found. It may have been changed in Google Calendar; refresh and try again.' };
    if (ev.isRecurringEvent() && scope === 'all') {
      // Whole series: title, place and notes. CalendarApp has no way to read a series' repeat rule,
      // so start/end times for every repeat can't be changed safely from here.
      var series = ev.getEventSeries();
      if (item.title) series.setTitle(String(item.title));
      if ('location' in item) series.setLocation(String(item.location || ''));
      if ('notes' in item) series.setDescription(String(item.notes || ''));
      var moved = item.date && !sameWhen_(ev, item);
      return { ok: true, item: mapEvent_(ev), warning: moved ? 'Title, place and notes were updated on all repeats. To change the time of every repeat, use Google Calendar.' : '' };
    }
    // Single event, or just this occurrence of a repeating event (a CalendarEvent from getEvents()
    // represents one occurrence, so these setters change only that occurrence).
    if (item.title) ev.setTitle(String(item.title));
    if ('location' in item) ev.setLocation(String(item.location || ''));
    if ('notes' in item) ev.setDescription(String(item.notes || ''));
    if (item.date && !sameWhen_(ev, item)) {
      if (item.time) {
        var s = toDate_(item.date, item.time);
        var e = item.end ? toDate_(item.endDate || item.date, item.end) : new Date(s.getTime() + 3600e3);
        if (e <= s) e = new Date(s.getTime() + 3600e3);
        ev.setTime(s, e);
      } else if (item.endDate && item.endDate > item.date) {
        var last = toDate_(item.endDate); last.setDate(last.getDate() + 1);
        ev.setAllDayDates(toDate_(item.date), last);
      } else {
        ev.setAllDayDate(toDate_(item.date));
      }
    }
    return { ok: true, item: mapEvent_(ev) };
  }
  var sh = sheet_(TYPE_TO_SHEET[type]);
  var r = findRow_(sh, id);
  if (!r) return { ok: false, error: 'not_found' };
  var head = SCHEMA[TYPE_TO_SHEET[type]];
  var row = clean_(type, item);
  row.updatedAt = new Date().toISOString();
  head.forEach(function (h, i) {
    if (h !== 'id' && h !== 'createdAt' && (h in row)) sh.getRange(r, i + 1).setValue(row[h]);
  });
  return { ok: true };
}

function remove_(type, id, scope) {
  if (!TYPE_TO_SHEET[type]) return { ok: false, error: 'bad_type' };
  if (type === 'events' && calendar_()) {
    var ev = findCalendarEvent_(calendar_(), id);
    if (!ev) return { ok: true, note: 'already_gone' };
    if (ev.isRecurringEvent() && scope === 'all') ev.getEventSeries().deleteEventSeries();
    else ev.deleteEvent(); // one occurrence, or a normal event
    return { ok: true };
  }
  var sh = sheet_(TYPE_TO_SHEET[type]);
  var r = findRow_(sh, id);
  if (r) sh.deleteRow(r);
  return { ok: true };
}

function toggle_(type, id) {
  var field = type === 'notes' ? 'pinned' : 'done';
  var name = TYPE_TO_SHEET[type];
  if (!name || SCHEMA[name].indexOf(field) < 0) return { ok: false, error: 'bad_type' };
  var sh = sheet_(name);
  var r = findRow_(sh, id);
  if (!r) return { ok: false, error: 'not_found' };
  if (name === 'Todos') {
    var rc = SCHEMA[name].indexOf('repeat') + 1, dc = SCHEMA[name].indexOf('doneOn') + 1;
    if (String(sh.getRange(r, rc).getValue() || '')) {
      // Repeating chore: "done" means done today, so store the date it was last ticked.
      var today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
      var was = String(sh.getRange(r, dc).getValue() || '') === today;
      sh.getRange(r, dc).setNumberFormat('@').setValue(was ? '' : today);
      // Keep a history of the days it was done (last 60), so missed days can be shown.
      var hc = SCHEMA[name].indexOf('history') + 1;
      var hist = String(sh.getRange(r, hc).getValue() || '').split(',').filter(String).filter(function (x) { return x !== today; });
      if (!was) hist.push(today);
      sh.getRange(r, hc).setNumberFormat('@').setValue(hist.sort().slice(-60).join(','));
      sh.getRange(r, SCHEMA[name].indexOf('updatedAt') + 1).setValue(new Date().toISOString());
      return { ok: true, value: !was, doneOn: was ? '' : today };
    }
  }
  var c = SCHEMA[name].indexOf(field) + 1;
  var cur = String(sh.getRange(r, c).getValue()).toUpperCase() === 'TRUE';
  sh.getRange(r, c).setValue(cur ? 'FALSE' : 'TRUE');
  sh.getRange(r, SCHEMA[name].indexOf('updatedAt') + 1).setValue(new Date().toISOString());
  return { ok: true, value: !cur };
}

function importAll_(data, by) {
  var counts = {}, skipped = {};
  if (data.settings) {
    var st = sheet_('Settings');
    Object.keys(data.settings).forEach(function (k) {
      var v = data.settings[k];
      if (Array.isArray(v)) v = v.join(', ');
      var rows = st.getDataRange().getValues();
      var found = 0;
      for (var i = 1; i < rows.length; i++) if (rows[i][0] === k) found = i + 1;
      if (found) st.getRange(found, 2).setValue(String(v)); else st.appendRow([k, String(v)]);
    });
    counts.settings = Object.keys(data.settings).length;
  }
  Object.keys(TYPE_TO_SHEET).forEach(function (type) {
    var list = data[type];
    if (!Array.isArray(list)) return;
    counts[type] = 0; skipped[type] = 0;
    var cal = type === 'events' ? calendar_() : null;
    var existing = cal ? null : readSheet_(TYPE_TO_SHEET[type]);
    list.forEach(function (item) {
      var dup;
      if (cal) dup = calendarEventExists_(cal, item);
      else dup = existing.some(function (x) {
        return String(x[MAIN_FIELD[type]]).trim().toLowerCase() === String(item[MAIN_FIELD[type]] || '').trim().toLowerCase()
          && String(x.date || '') === String(item.date || '');
      });
      if (dup) { skipped[type]++; return; }
      var copy = JSON.parse(JSON.stringify(item));
      delete copy.id;
      add_(type, copy, item.by || by);
      counts[type]++;
    });
  });
  return { ok: true, counts: counts, skipped: skipped };
}

/* ---------------- helpers ---------------- */
function clean_(type, item) {
  var head = SCHEMA[TYPE_TO_SHEET[type]];
  var o = {};
  head.forEach(function (h) {
    if (!(h in item)) return;
    var v = item[h];
    if (h === 'recipes') v = JSON.stringify(v || []);
    else if (typeof v === 'boolean') v = v ? 'TRUE' : 'FALSE';
    else v = v == null ? '' : String(v).slice(0, 20000);
    o[h] = v;
  });
  return o;
}

function appendRow_(name, row) {
  var sh = sheet_(name);
  var vals = SCHEMA[name].map(function (h) { return row[h] == null ? '' : row[h]; });
  var r = sh.getLastRow() + 1;
  var rng = sh.getRange(r, 1, 1, vals.length);
  rng.setNumberFormat('@');
  rng.setValues([vals]);
}

function findRow_(sh, id) {
  var ids = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (var i = 1; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 1;
  return 0;
}

function sheet_(name) {
  var ss = getSS_();
  var sh = ss.getSheetByName(name);
  if (!sh) { setup(); sh = ss.getSheetByName(name); }
  ensureHeader_(sh, name);
  return sh;
}

// Adds any new columns (from SCHEMA) to the end of an existing tab's header row. Existing data is untouched.
var headerChecked_ = {};
function ensureHeader_(sh, name) {
  var cols = SCHEMA[name];
  if (!cols || headerChecked_[name]) return;
  headerChecked_[name] = true;
  var have = sh.getRange(1, 1, 1, cols.length).getValues()[0];
  for (var i = 0; i < cols.length; i++) {
    if (String(have[i] || '') !== cols[i]) {
      if (have[i]) return; // unexpected layout: leave it alone
      sh.getRange(1, i + 1).setValue(cols[i]).setFontWeight('bold').setBackground('#f1e7da');
      sh.getRange(2, i + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@');
    }
  }
}

function tz_() { return Session.getScriptTimeZone() || 'Europe/London'; }

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}


// Works bound to a Sheet or standalone (set Script property SHEET_ID).
function getSS_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}
