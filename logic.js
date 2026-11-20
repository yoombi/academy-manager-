/* 엄마다했쏙 — 공용 로직 (DOM 없이 동작, node/테스트에서도 사용) */
(function (global) {
  'use strict';

  var DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];
  var DAY_LONGS = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일'];
  var ICS_BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

  function pad2(n) { return String(n).padStart(2, '0'); }

  /* ---------- 날짜/시간 ---------- */

  function dateKey(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseDateKey(s) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || ''));
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  /* 월=1 … 일=7 */
  function dayIndex(d) { return ((d.getDay() + 6) % 7) + 1; }
  function dayLabel(i) { return DAY_LABELS[i - 1] || ''; }
  function dayLong(i) { return DAY_LONGS[i - 1] || ''; }

  function hhmmToMinutes(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    var h = Number(m[1]), mi = Number(m[2]);
    if (h > 24 || mi > 59) return null;
    return h * 60 + mi;
  }

  function minutesToHHMM(mins) {
    var m = ((Math.round(mins) % 1440) + 1440) % 1440;
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }

  function hhmmOf(date) { return pad2(date.getHours()) + ':' + pad2(date.getMinutes()); }

  /* "오후 4:30" */
  function clockText(hhmm) {
    var mins = hhmmToMinutes(hhmm);
    if (mins == null) return '';
    var h = Math.floor(mins / 60), m = mins % 60;
    var ampm = h < 12 ? '오전' : '오후';
    var hh = h % 12;
    if (hh === 0) hh = 12;
    return ampm + ' ' + hh + ':' + pad2(m);
  }

  function rangeText(a, b) {
    var s = clockText(a);
    if (!s) return '';
    var e = clockText(b);
    return e ? s + '–' + e : s;
  }

  function atTime(date, hhmm) {
    var mins = hhmmToMinutes(hhmm);
    if (mins == null) mins = 0;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(mins / 60), mins % 60, 0, 0);
  }

  function diffDays(a, b) {
    return Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
  }

  function monthDay(date) { return (date.getMonth() + 1) + '/' + date.getDate(); }

  function dateLongText(date) {
    return (date.getMonth() + 1) + '월 ' + date.getDate() + '일 ' + dayLong(dayIndex(date));
  }

  /* 이번 주 월요일 */
  function weekStart(date) {
    var idx = dayIndex(date);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() - (idx - 1));
  }

  function weekDates(date) {
    var start = weekStart(date);
    var out = [];
    for (var i = 0; i < 7; i++) out.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    return out;
  }

  /* ---------- 수업 ---------- */

  function classOn(cls, date) {
    return (cls.days || []).indexOf(dayIndex(date)) >= 0;
  }

  /* 시간이 비어 있는 일정(도서관 등)은 종일(allDay)로 본다 */
  function classBounds(cls, date) {
    var base = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
    var startMin = hhmmToMinutes(cls.start);
    if (startMin == null) {
      return { allDay: true, start: base, end: new Date(base.getTime() + 86400000) };
    }
    var endMin = hhmmToMinutes(cls.end);
    if (endMin == null || endMin <= startMin) endMin = startMin + 60;
    return {
      allDay: false,
      start: new Date(base.getTime() + startMin * 60000),
      end: new Date(base.getTime() + endMin * 60000)
    };
  }

  /* 오늘 수업 상태 + 다음 수업 정보
     state: ongoing(수업 중) | today(오늘 남음) | future(다음 수업) | none */
  function classStatus(cls, now) {
    if (hhmmToMinutes(cls.start) == null) return { state: 'none' }; /* 시간 미정 일정은 셈에서 제외 */
    if (classOn(cls, now)) {
      var b = classBounds(cls, now);
      if (now >= b.start && now < b.end) return { state: 'ongoing', start: b.start, end: b.end, daysAhead: 0 };
      if (now < b.start) return { state: 'today', start: b.start, end: b.end, daysAhead: 0 };
    }
    for (var i = 1; i <= 15; i++) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      if (classOn(cls, d)) {
        var bb = classBounds(cls, d);
        return { state: 'future', start: bb.start, end: bb.end, daysAhead: i };
      }
    }
    return { state: 'none' };
  }

  /* 가장 가까운 수업 (진행 중인 수업이 있으면 그것을 우선) */
  function nextClass(classes, now) {
    var best = null;
    (classes || []).forEach(function (cls) {
      var st = classStatus(cls, now);
      if (st.state === 'none') return;
      if (!best) { best = { cls: cls, status: st }; return; }
      if (st.start < best.status.start) best = { cls: cls, status: st };
    });
    return best;
  }

  function todaysClasses(classes, now) {
    return (classes || []).filter(function (c) { return classOn(c, now); })
      .sort(function (a, b) { return (hhmmToMinutes(a.start) || 0) - (hhmmToMinutes(b.start) || 0); });
  }

  /* ---------- 숙제 ---------- */

  function dueInfo(due, now) {
    var d = parseDateKey(due);
    if (!d) return { label: '마감일 없음', tone: 'none', days: null };
    var diff = diffDays(d, now);
    if (diff < 0) return { label: diff === -1 ? '어제 마감' : (-diff) + '일 지남', tone: 'late', days: diff };
    if (diff === 0) return { label: '오늘 마감', tone: 'today', days: 0 };
    if (diff === 1) return { label: '내일 마감', tone: 'soon', days: 1 };
    if (diff <= 3) return { label: 'D-' + diff, tone: 'soon', days: diff };
    if (diff <= 7) return { label: 'D-' + diff, tone: 'later', days: diff };
    return { label: monthDay(d), tone: 'later', days: diff };
  }

  function sortHomeworks(list) {
    return (list || []).slice().sort(function (a, b) {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      var da = a.due || '9999-12-31', db = b.due || '9999-12-31';
      if (da !== db) return da < db ? -1 : 1;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
  }

  /* ---------- 비밀번호(관리자 잠금) 해시 ----------
     PIN 은 평문으로 저장하지 않는다. salt + SHA-256 반복 해시만 저장한다.
     (기기에 저장되는 4자리 잠금장치라 강한 암호가 아니라 “아이가 못 건드리게” 하는 수준) */

  var SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8Bytes(str) {
    var s = String(str == null ? '' : str);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        var c2 = s.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          i++;
        }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  /* SHA-256 (문자열 → 16진수 64자리). 외부 라이브러리·crypto.subtle 없이 동작 */
  function sha256Hex(input) {
    var K = SHA256_K;
    var bytes = utf8Bytes(input);
    var bits = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    var hi = Math.floor(bits / 4294967296);
    var lo = bits >>> 0;
    bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
    bytes.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);

    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Array(64);
    for (var off = 0; off < bytes.length; off += 64) {
      for (var i = 0; i < 16; i++) {
        w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) |
          (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
      }
      for (i = 16; i < 64; i++) {
        var x = w[i - 15], y = w[i - 2];
        var s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
        var s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[i] + w[i]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (n) { return ('00000000' + ((n >>> 0).toString(16))).slice(-8); }).join('');
  }

  var PIN_ROUNDS = 800;

  /* salt + PIN 을 여러 번 해시해 저장용 해시를 만든다 (PIN 평문은 어디에도 남기지 않음) */
  function pinHash(pin, salt) {
    var h = sha256Hex(String(salt) + ':' + String(pin));
    for (var i = 0; i < PIN_ROUNDS; i++) h = sha256Hex(h + ':' + salt);
    return h;
  }

  /* 기기마다 다른 salt (crypto 가 없으면 Math.random 으로 대체) */
  function randomSalt() {
    var c = (typeof crypto !== 'undefined' && crypto) ||
      (typeof globalThis !== 'undefined' && globalThis.crypto) || null;
    var out = '';
    if (c && typeof c.getRandomValues === 'function') {
      try {
        var arr = new Uint8Array(16);
        c.getRandomValues(arr);
        for (var i = 0; i < arr.length; i++) out += ('0' + arr[i].toString(16)).slice(-2);
        return out;
      } catch (e) { /* 아래로 */ }
    }
    for (var j = 0; j < 32; j++) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  }

  /* 4자리 숫자 PIN 인지 */
  function isPinShape(pin) { return /^[0-9]{4}$/.test(String(pin == null ? '' : pin)); }

  /* ---------- .ics 내보내기 ---------- */

  function utf8Len(ch) {
    var c = ch.codePointAt(0);
    if (c < 0x80) return 1;
    if (c < 0x800) return 2;
    if (c < 0x10000) return 3;
    return 4;
  }

  function icsEscape(text) {
    return String(text == null ? '' : text)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  /* RFC 5545 75옥텟 접기 (UTF-8 문자를 쪼개지 않음) */
  function foldLine(line) {
    var out = [], cur = '', bytes = 0;
    Array.from(String(line)).forEach(function (ch) {
      var b = utf8Len(ch);
      if (cur && bytes + b > 73) { out.push(cur); cur = ''; bytes = 0; }
      cur += ch; bytes += b;
    });
    out.push(cur);
    return out.join('\r\n ');
  }

  function utcStamp(d) {
    return d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) +
      'T' + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds()) + 'Z';
  }

  function ymdCompact(d) {
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
  }

  /* opt: { kids, classes, homeworks, now, includeClasses, includeHomeworks,
             alarmMinutes, calendarName } */
  function buildICS(opt) {
    opt = opt || {};
    var now = opt.now || new Date();
    var kids = opt.kids || [];
    var lines = [];
    var kidName = function (id) {
      var k = kids.filter(function (x) { return x.id === id; })[0];
      return k ? k.name : '';
    };

    lines.push('BEGIN:VCALENDAR');
    lines.push('VERSION:2.0');
    lines.push('PRODID:-//엄마다했쏙//KO');
    lines.push('CALSCALE:GREGORIAN');
    lines.push('METHOD:PUBLISH');
    lines.push('X-WR-CALNAME:' + icsEscape(opt.calendarName || '엄마다했쏙 일정'));
    lines.push('X-WR-TIMEZONE:Asia/Seoul');

    if (opt.includeClasses !== false) {
      (opt.classes || []).forEach(function (c) {
        var days = (c.days || []).slice().sort(function (a, b) { return a - b; });
        if (!days.length) return;
        var first = null;
        for (var i = 0; i < 8 && !first; i++) {
          var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
          if (days.indexOf(dayIndex(d)) >= 0) first = d;
        }
        if (!first) return;
        var b = classBounds(c, first);
        var kid = kidName(c.kidId);
        var summary = (kid ? '[' + kid + '] ' : '') + (c.name || '학원');
        var desc = [kid, c.place, c.memo].filter(Boolean).join(' · ');
        lines.push('BEGIN:VEVENT');
        lines.push('UID:' + c.id + '@academy-manager');
        lines.push('DTSTAMP:' + utcStamp(now));
        if (b.allDay) {
          lines.push('DTSTART;VALUE=DATE:' + ymdCompact(b.start));
          lines.push('DTEND;VALUE=DATE:' + ymdCompact(b.end));
        } else {
          lines.push('DTSTART:' + utcStamp(b.start));
          lines.push('DTEND:' + utcStamp(b.end));
        }
        lines.push('RRULE:FREQ=WEEKLY;BYDAY=' + days.map(function (i) { return ICS_BYDAY[i - 1]; }).join(','));
        lines.push('SUMMARY:' + icsEscape(summary));
        if (desc) lines.push('DESCRIPTION:' + icsEscape(desc));
        if (c.place) lines.push('LOCATION:' + icsEscape(c.place));
        var lead = Number(opt.alarmMinutes);
        if (lead > 0 && !b.allDay) {
          lines.push('BEGIN:VALARM');
          lines.push('TRIGGER:-PT' + lead + 'M');
          lines.push('ACTION:DISPLAY');
          lines.push('DESCRIPTION:' + icsEscape(summary));
          lines.push('END:VALARM');
        }
        lines.push('END:VEVENT');
      });
    }

    if (opt.includeHomeworks !== false) {
      (opt.homeworks || []).forEach(function (h) {
        if (h.done) return;
        var d = parseDateKey(h.due);
        if (!d) return;
        var kid = kidName(h.kidId);
        var summary = '[숙제] ' + (h.title || '') + (kid ? ' (' + kid + ')' : '');
        var desc = [kid, h.className, h.memo].filter(Boolean).join(' · ');
        lines.push('BEGIN:VEVENT');
        lines.push('UID:hw-' + h.id + '@academy-manager');
        lines.push('DTSTAMP:' + utcStamp(now));
        lines.push('DTSTART;VALUE=DATE:' + ymdCompact(d));
        lines.push('DTEND;VALUE=DATE:' + ymdCompact(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)));
        lines.push('SUMMARY:' + icsEscape(summary));
        if (desc) lines.push('DESCRIPTION:' + icsEscape(desc));
        lines.push('TRANSP:TRANSPARENT');
        lines.push('END:VEVENT');
      });
    }

    lines.push('END:VCALENDAR');
    return lines.map(foldLine).join('\r\n') + '\r\n';
  }

  var api = {
    DAY_LABELS: DAY_LABELS,
    DAY_LONGS: DAY_LONGS,
    pad2: pad2,
    dateKey: dateKey,
    parseDateKey: parseDateKey,
    startOfDay: startOfDay,
    dayIndex: dayIndex,
    dayLabel: dayLabel,
    dayLong: dayLong,
    hhmmToMinutes: hhmmToMinutes,
    minutesToHHMM: minutesToHHMM,
    hhmmOf: hhmmOf,
    clockText: clockText,
    rangeText: rangeText,
    atTime: atTime,
    diffDays: diffDays,
    monthDay: monthDay,
    dateLongText: dateLongText,
    weekStart: weekStart,
    weekDates: weekDates,
    classOn: classOn,
    classBounds: classBounds,
    classStatus: classStatus,
    nextClass: nextClass,
    todaysClasses: todaysClasses,
    dueInfo: dueInfo,
    sortHomeworks: sortHomeworks,
    sha256Hex: sha256Hex,
    pinHash: pinHash,
    randomSalt: randomSalt,
    isPinShape: isPinShape,
    icsEscape: icsEscape,
    foldLine: foldLine,
    buildICS: buildICS
  };

  global.AcademyLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
