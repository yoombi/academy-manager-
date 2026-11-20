/* 아이별 학원·숙제 관리 — 공용 로직 (DOM 없이 동작, node/테스트에서도 사용) */
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
    lines.push('PRODID:-//아이별 학원 숙제 관리//KO');
    lines.push('CALSCALE:GREGORIAN');
    lines.push('METHOD:PUBLISH');
    lines.push('X-WR-CALNAME:' + icsEscape(opt.calendarName || '아이별 학원 일정'));
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
    icsEscape: icsEscape,
    foldLine: foldLine,
    buildICS: buildICS
  };

  global.AcademyLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
