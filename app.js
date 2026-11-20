/* 아이별 학원·숙제 관리 — 화면/상태 (모든 데이터는 localStorage 에 저장) */
(function () {
  'use strict';

  var L = window.AcademyLogic;
  var STORE_KEY = 'academy-manager:v1';
  var APP_VERSION = '1.2.0';

  var COLORS = ['#6366f1', '#ef4444', '#f97316', '#f59e0b', '#22c55e', '#14b8a6', '#0ea5e9', '#ec4899'];
  var EMOJIS = ['🦊', '🐰', '🐻', '🐼', '🐯', '🐶', '🐱', '🐨', '🦁', '🐥', '🐙', '🦄'];
  var TABS = [
    { id: 'today', label: '오늘', icon: '☀️' },
    { id: 'schedule', label: '시간표', icon: '🗓️' },
    { id: 'homework', label: '숙제', icon: '✅' },
    { id: 'settings', label: '설정', icon: '⚙️' }
  ];

  var state = {
    view: 'today',
    kid: 'all',
    hwFilter: 'open',
    data: null,
    sheet: null,
    dayKey: null,
    installEvent: null,
    swReg: null,
    /* 관리자 잠금: 해제 상태는 이번 화면(세션)에서만 유지되고 새로고침하면 다시 잠긴다 */
    unlocked: false,
    pinFails: 0,
    pinBlockUntil: 0,
    lastActivity: 0
  };

  /* ================= 저장 ================= */

  function defaultSettings() {
    return { notifyClass: true, classLeadMin: 30, notifyHomework: true, homeworkTime: '20:00' };
  }

  /* 관리자(엄마) 잠금 설정 — PIN 평문은 저장하지 않고 salt + 해시만 둔다 */
  function blankLock() {
    return { hash: '', salt: '', autoLockMin: 5, updatedAt: null };
  }

  function normalizeLock(raw) {
    var lock = blankLock();
    if (!raw || typeof raw !== 'object') return lock;
    var hash = typeof raw.hash === 'string' ? raw.hash.trim().toLowerCase() : '';
    var salt = typeof raw.salt === 'string' ? raw.salt.trim() : '';
    /* 해시가 온전한 64자리 16진수일 때만 잠금으로 인정 (깨진 값이면 잠기지 않게) */
    if (/^[0-9a-f]{64}$/.test(hash) && salt) {
      lock.hash = hash;
      lock.salt = salt;
    }
    var mins = Number(raw.autoLockMin);
    if ([1, 5, 10, 30, 0].indexOf(mins) >= 0) lock.autoLockMin = mins;
    lock.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : null;
    return lock;
  }

  function blankData() {
    return {
      version: 1,
      kids: [],
      classes: [],
      routines: [],
      homeworks: [],
      checks: {},
      settings: defaultSettings(),
      lock: blankLock(),
      fired: {},
      createdAt: new Date().toISOString()
    };
  }

  function normalizeData(raw) {
    var d = Object.assign(blankData(), raw || {});
    d.kids = (Array.isArray(d.kids) ? d.kids : [])
      .filter(function (k) { return k && k.id && k.name; })
      .map(function (k) {
        return { id: String(k.id), name: String(k.name), color: k.color || COLORS[0], emoji: k.emoji || '🙂' };
      });
    d.classes = (Array.isArray(d.classes) ? d.classes : [])
      .filter(function (c) { return c && c.id && c.name; })
      .map(function (c) {
        return {
          id: String(c.id),
          kidId: c.kidId ? String(c.kidId) : '',
          name: String(c.name),
          days: (Array.isArray(c.days) ? c.days : []).map(Number).filter(function (n) { return n >= 1 && n <= 7; }),
          start: L.hhmmToMinutes(c.start) == null ? '' : c.start,
          end: c.end || '',
          place: c.place || '',
          memo: c.memo || ''
        };
      });
    d.routines = (Array.isArray(d.routines) ? d.routines : [])
      .filter(function (r) { return r && r.id && r.title; })
      .map(function (r) {
        return {
          id: String(r.id),
          kidId: r.kidId ? String(r.kidId) : '',
          title: String(r.title),
          days: (Array.isArray(r.days) ? r.days : []).map(Number).filter(function (n) { return n >= 1 && n <= 7; }),
          time: r.time || '',
          memo: r.memo || ''
        };
      });
    d.homeworks = (Array.isArray(d.homeworks) ? d.homeworks : [])
      .filter(function (h) { return h && h.id && h.title; })
      .map(function (h) {
        return {
          id: String(h.id),
          kidId: h.kidId ? String(h.kidId) : '',
          classId: h.classId ? String(h.classId) : '',
          title: String(h.title),
          due: h.due || '',
          memo: h.memo || '',
          done: !!h.done,
          doneAt: h.doneAt || null,
          createdAt: h.createdAt || new Date().toISOString()
        };
      });
    d.checks = raw && raw.checks && typeof raw.checks === 'object' ? raw.checks : {};
    d.settings = Object.assign(defaultSettings(), raw && raw.settings ? raw.settings : {});
    /* 예전 백업(lock 없음)도 그대로 열린다 — 잠금 없음으로 채운다 */
    d.lock = normalizeLock(raw && raw.lock);
    d.fired = raw && raw.fired && typeof raw.fired === 'object' ? raw.fired : {};
    return d;
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      return normalizeData(JSON.parse(raw));
    } catch (e) {
      return null;
    }
  }

  function save() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(state.data));
      return true;
    } catch (e) {
      toast('저장 공간이 부족해 저장하지 못했어요.');
      return false;
    }
  }

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ================= 관리자(엄마) 잠금 ================= */

  function lockInfo() {
    if (!state.data || !state.data.lock) return blankLock();
    return state.data.lock;
  }

  function hasPin() { return !!lockInfo().hash; }

  /* 잠금이 걸려 있고 아직 풀지 않은 상태 = 수정·설정 불가 */
  function lockRequired() { return hasPin() && !state.unlocked; }

  function markActivity() { state.lastActivity = Date.now(); }

  function lockNow(silent) {
    if (!hasPin()) return false;
    state.unlocked = false;
    state.sheet = null;
    if (!silent) toast('관리자 잠금을 다시 걸었어요');
    return true;
  }

  function unlockSession() {
    state.unlocked = true;
    state.pinFails = 0;
    state.pinBlockUntil = 0;
    markActivity();
  }

  /* 비밀번호 설정·변경 (해시만 저장) */
  function setPin(pin, autoLockMin) {
    if (!L.isPinShape(pin)) return { ok: false, error: '4자리 숫자를 입력해 주세요.' };
    var salt = L.randomSalt();
    var mins = autoLockMin == null ? lockInfo().autoLockMin : Number(autoLockMin);
    if ([1, 5, 10, 30, 0].indexOf(mins) < 0) mins = 5;
    state.data.lock = {
      hash: L.pinHash(pin, salt),
      salt: salt,
      autoLockMin: mins,
      updatedAt: new Date().toISOString()
    };
    save();
    unlockSession();
    return { ok: true };
  }

  /* 비밀번호 삭제 = 잠금 끄기 (잠금이 풀린 상태에서만 가능) */
  function clearPin() {
    state.data.lock = Object.assign(blankLock(), { autoLockMin: lockInfo().autoLockMin });
    save();
    unlockSession();
    return { ok: true };
  }

  function setLockAutoMin(mins) {
    var m = Number(mins);
    if ([1, 5, 10, 30, 0].indexOf(m) < 0) return;
    state.data.lock = Object.assign(blankLock(), lockInfo(), { autoLockMin: m });
    save();
  }

  /* 입력한 PIN 확인. 5번 틀리면 30초 동안 막는다 */
  function verifyPin(pin) {
    var lock = lockInfo();
    if (!lock.hash) { unlockSession(); return true; }
    var now = Date.now();
    if (state.pinBlockUntil > now) return false;
    if (L.pinHash(String(pin == null ? '' : pin), lock.salt) === lock.hash) {
      unlockSession();
      return true;
    }
    state.pinFails += 1;
    if (state.pinFails >= 5) {
      state.pinFails = 0;
      state.pinBlockUntil = now + 30000;
    }
    return false;
  }

  /* 일정 시간 손을 대지 않으면 다시 잠근다 (0 이면 자동 잠금 없음) */
  function autoLockCheck() {
    if (!hasPin() || !state.unlocked) return false;
    var mins = Number(lockInfo().autoLockMin);
    if (!(mins > 0)) return false;
    if (Date.now() - state.lastActivity < mins * 60000) return false;
    state.unlocked = false;
    state.sheet = null;
    renderAll();
    toast('오랫동안 그대로 있어서 관리자 잠금을 다시 걸었어요');
    return true;
  }

  /* 잠금이 걸려 있으면 PIN 시트를 먼저 띄운다 */
  function guardEdit(run) {
    if (!lockRequired()) { run(); return true; }
    openPinSheet('unlock', run);
    return false;
  }

  /* 항목 보기: 잠긴 상태면 읽기 전용 시트로 */
  function openItemSheet(type, id) {
    state.sheet = { type: type, id: id || null, readOnly: lockRequired() };
    renderAll();
    if (state.sheet && !state.sheet.readOnly) {
      var input = document.querySelector('.sheet input, .sheet select');
      if (input && input.focus) setTimeout(function () { try { input.focus(); } catch (e) {} }, 80);
    }
  }

  /* ================= 조회 ================= */

  function kidById(id) {
    return state.data.kids.filter(function (k) { return k.id === id; })[0] || null;
  }
  function classById(id) {
    return state.data.classes.filter(function (c) { return c.id === id; })[0] || null;
  }
  function routineById(id) {
    return state.data.routines.filter(function (r) { return r.id === id; })[0] || null;
  }
  function homeworkById(id) {
    return state.data.homeworks.filter(function (h) { return h.id === id; })[0] || null;
  }

  function scopedClasses() {
    return state.data.classes.filter(function (c) { return state.kid === 'all' || c.kidId === state.kid; });
  }
  function scopedHomeworks() {
    return state.data.homeworks.filter(function (h) { return state.kid === 'all' || h.kidId === state.kid; });
  }
  function scopedRoutines() {
    return state.data.routines.filter(function (r) { return state.kid === 'all' || r.kidId === state.kid; });
  }
  function todayRoutines() {
    var idx = L.dayIndex(new Date());
    return scopedRoutines()
      .filter(function (r) { return (r.days || []).indexOf(idx) >= 0; })
      .sort(function (a, b) {
        var am = L.hhmmToMinutes(String(a.time || '').split('~')[0]);
        var bm = L.hhmmToMinutes(String(b.time || '').split('~')[0]);
        if (am == null && bm == null) return a.title.localeCompare(b.title, 'ko');
        if (am == null) return 1;
        if (bm == null) return -1;
        return am - bm;
      });
  }
  function routineKey(id, dateKey) { return id + '|' + dateKey; }
  function isRoutineDone(r, dateKey) { return !!state.data.checks[routineKey(r.id, dateKey)]; }
  function routineStats(list, dateKey) {
    var done = list.filter(function (r) { return isRoutineDone(r, dateKey); }).length;
    return { done: done, total: list.length, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
  }
  function openRoutinesToday() {
    var key = L.dateKey(new Date());
    return todayRoutines().filter(function (r) { return !isRoutineDone(r, key); });
  }
  function openHomeworksDue() {
    var key = L.dateKey(new Date());
    return scopedHomeworks().filter(function (h) { return !h.done && h.due && h.due <= key; });
  }
  function todayOpenCount() {
    var key = L.dateKey(new Date());
    var rt = todayRoutines().filter(function (r) { return !isRoutineDone(r, key); }).length;
    return rt + openHomeworksDue().length;
  }

  /* ================= 데이터 조작 ================= */

  function upsertKid(input) {
    var name = String(input.name || '').trim();
    if (!name) return { ok: false, error: '아이 이름을 입력해 주세요.' };
    var kid = input.id ? kidById(input.id) : null;
    if (kid) {
      kid.name = name;
      if (input.color) kid.color = input.color;
      if (input.emoji) kid.emoji = input.emoji;
    } else {
      kid = {
        id: uid('kid'),
        name: name,
        color: input.color || COLORS[state.data.kids.length % COLORS.length],
        emoji: input.emoji || EMOJIS[state.data.kids.length % EMOJIS.length]
      };
      state.data.kids.push(kid);
    }
    save();
    return { ok: true, kid: kid };
  }

  function deleteKid(id) {
    state.data.kids = state.data.kids.filter(function (k) { return k.id !== id; });
    state.data.classes = state.data.classes.filter(function (c) { return c.kidId !== id; });
    state.data.routines = state.data.routines.filter(function (r) { return r.kidId !== id; });
    state.data.homeworks = state.data.homeworks.filter(function (h) { return h.kidId !== id; });
    if (state.kid === id) state.kid = 'all';
    save();
  }

  function upsertClass(input) {
    var name = String(input.name || '').trim();
    var days = (Array.isArray(input.days) ? input.days : [])
      .map(Number)
      .filter(function (n) { return n >= 1 && n <= 7; })
      .sort(function (a, b) { return a - b; });
    if (!name) return { ok: false, error: '학원 이름을 입력해 주세요.' };
    if (!days.length) return { ok: false, error: '요일을 하나 이상 선택해 주세요.' };
    if (!input.kidId || !kidById(input.kidId)) return { ok: false, error: '아이를 선택해 주세요.' };
    var start = L.hhmmToMinutes(input.start) == null ? '' : input.start;
    var end = '';
    if (start) {
      var startMin = L.hhmmToMinutes(start);
      var endMin = L.hhmmToMinutes(input.end);
      if (endMin != null && endMin <= startMin) return { ok: false, error: '종료 시간은 시작 시간보다 늦어야 해요.' };
      end = endMin != null ? L.minutesToHHMM(endMin) : L.minutesToHHMM(startMin + 60);
    }
    var payload = {
      kidId: input.kidId,
      name: name,
      days: days,
      start: start,
      end: end,
      place: String(input.place || '').trim(),
      memo: String(input.memo || '').trim()
    };
    var item = input.id ? classById(input.id) : null;
    if (item) Object.assign(item, payload);
    else {
      item = Object.assign({ id: uid('cls') }, payload);
      state.data.classes.push(item);
    }
    save();
    return { ok: true, item: item };
  }

  function deleteClass(id) {
    state.data.classes = state.data.classes.filter(function (c) { return c.id !== id; });
    state.data.homeworks.forEach(function (h) { if (h.classId === id) h.classId = ''; });
    save();
  }

  function upsertRoutine(input) {
    var title = String(input.title || '').trim();
    var days = (Array.isArray(input.days) ? input.days : [])
      .map(Number).filter(function (n) { return n >= 1 && n <= 7; })
      .sort(function (a, b) { return a - b; });
    if (!title) return { ok: false, error: '할 일 내용을 입력해 주세요.' };
    if (!days.length) return { ok: false, error: '요일을 하나 이상 선택해 주세요.' };
    if (!input.kidId || !kidById(input.kidId)) return { ok: false, error: '아이를 선택해 주세요.' };
    var payload = {
      kidId: input.kidId,
      title: title,
      days: days,
      time: String(input.time || '').trim(),
      memo: String(input.memo || '').trim()
    };
    var item = input.id ? routineById(input.id) : null;
    if (item) Object.assign(item, payload);
    else {
      item = Object.assign({ id: uid('rt') }, payload);
      state.data.routines.push(item);
    }
    save();
    return { ok: true, item: item };
  }

  function deleteRoutine(id) {
    state.data.routines = state.data.routines.filter(function (r) { return r.id !== id; });
    save();
  }

  function toggleRoutine(id) {
    var key = routineKey(id, L.dateKey(new Date()));
    if (state.data.checks[key]) delete state.data.checks[key];
    else state.data.checks[key] = Date.now();
    save();
  }

  function upsertHomework(input) {
    var title = String(input.title || '').trim();
    if (!title) return { ok: false, error: '숙제 내용을 입력해 주세요.' };
    if (!input.kidId || !kidById(input.kidId)) return { ok: false, error: '아이를 선택해 주세요.' };
    var payload = {
      kidId: input.kidId,
      classId: input.classId || '',
      title: title,
      due: input.due || L.dateKey(new Date()),
      memo: String(input.memo || '').trim()
    };
    var item = input.id ? homeworkById(input.id) : null;
    if (item) Object.assign(item, payload);
    else {
      item = Object.assign({ id: uid('hw'), done: false, doneAt: null, createdAt: new Date().toISOString() }, payload);
      state.data.homeworks.push(item);
    }
    save();
    return { ok: true, item: item };
  }

  function deleteHomework(id) {
    state.data.homeworks = state.data.homeworks.filter(function (h) { return h.id !== id; });
    save();
  }

  function toggleHomework(id) {
    var h = homeworkById(id);
    if (!h) return;
    h.done = !h.done;
    h.doneAt = h.done ? new Date().toISOString() : null;
    save();
  }

  /* ================= 표시 도우미 ================= */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function kidTag(id) {
    var k = kidById(id);
    if (!k) return '';
    return '<span class="tag" style="--c:' + esc(k.color) + '"><span class="tag-emoji" aria-hidden="true">' +
      esc(k.emoji) + '</span>' + esc(k.name) + '</span>';
  }

  function kidAccent(id) {
    var k = kidById(id);
    return k ? k.color : '#94a3b8';
  }

  function classTag(classId) {
    var c = classId ? classById(classId) : null;
    return c ? '<span class="tag tag-plain">' + esc(c.name) + '</span>' : '';
  }

  function timeLabel(c) {
    return c.start ? L.rangeText(c.start, c.end) : '시간 미정';
  }

  function whenText(date, now) {
    var ms = date - now;
    if (ms <= 0) return '지금';
    var mins = Math.round(ms / 60000);
    if (mins < 1) return '곧 시작';
    if (mins < 60) return mins + '분 남음';
    if (mins < 24 * 60) {
      var h = Math.floor(mins / 60), m = mins % 60;
      return m ? h + '시간 ' + m + '분 남음' : h + '시간 남음';
    }
    var dd = L.diffDays(date, now);
    if (dd === 1) return '내일 ' + L.clockText(L.hhmmOf(date));
    return dd + '일 후 ' + L.clockText(L.hhmmOf(date));
  }

  function liveText(cls, now) {
    var st = L.classStatus(cls, now);
    if (st.state === 'ongoing') return '수업 중 · ' + L.clockText(L.hhmmOf(st.end)) + ' 종료';
    if (st.state === 'none') return '';
    return whenText(st.start, now);
  }

  function headerLine() {
    var now = new Date();
    var parts = [L.dateLongText(now)];
    var n = todayOpenCount();
    parts.push(n > 0 ? '오늘 할 일 ' + n + '개' : '오늘 할 일 모두 완료 🎉');
    return parts.join(' · ');
  }

  /* ================= 상단/탭 ================= */

  function renderKidBar() {
    var chips = '<button class="kidchip' + (state.kid === 'all' ? ' on' : '') + '" data-action="set-kid" data-kid="all">전체</button>';
    chips += state.data.kids.map(function (k) {
      var on = state.kid === k.id;
      return '<button class="kidchip' + (on ? ' on' : '') + '" data-action="set-kid" data-kid="' + k.id + '"' +
        ' style="--c:' + esc(k.color) + '">' +
        '<span class="kidchip-emoji" aria-hidden="true">' + esc(k.emoji) + '</span>' + esc(k.name) + '</button>';
    }).join('');
    chips += '<button class="kidchip kidchip-add" data-action="add-kid" aria-label="아이 추가">＋</button>';
    return chips;
  }

  function renderTabBar() {
    var n = todayOpenCount();
    return TABS.map(function (t) {
      var on = state.view === t.id;
      var badge = (t.id === 'homework' && n > 0) ? '<span class="tab-badge">' + n + '</span>' : '';
      return '<button class="tab' + (on ? ' on' : '') + '" data-action="set-view" data-view="' + t.id + '"' +
        ' aria-current="' + (on ? 'page' : 'false') + '">' +
        '<span class="tab-icon" aria-hidden="true">' + t.icon + '</span>' +
        '<span class="tab-label">' + t.label + '</span>' + badge + '</button>';
    }).join('');
  }

  /* ================= 본문 ================= */

  function renderMain() {
    if (state.kid !== 'all' && !kidById(state.kid)) state.kid = 'all';
    /* 잠겨 있으면 설정 화면은 안내 카드로 막는다 (해시·새로고침·hash 링크로 바로 들어와도 동일) */
    if (state.view === 'settings' && lockRequired()) return lockedCard();
    if (!state.data.kids.length) {
      /* 아이가 없어도 설정(백업 복원 등)은 열 수 있어야 한다 */
      return state.view === 'settings' ? viewSettings() : onboardingCard();
    }
    if (state.view === 'schedule') return viewSchedule();
    if (state.view === 'homework') return viewHomework();
    if (state.view === 'settings') return viewSettings();
    return viewToday();
  }

  function onboardingCard() {
    return '<section class="card intro">' +
      '<div class="intro-emoji" aria-hidden="true">📚</div>' +
      '<h2>아이별 학원·숙제 관리</h2>' +
      '<p>아이를 등록하면 학원 시간표와 매일 체크리스트를 한 화면에서 볼 수 있어요. 입력한 내용은 이 휴대폰에만 저장됩니다.</p>' +
      '<ol class="steps">' +
      '<li><b>1</b><span>아이 추가 (이름·색상)</span></li>' +
      '<li><b>2</b><span>학원 등록 (요일·시간)</span></li>' +
      '<li><b>3</b><span>체크리스트로 매일 확인</span></li>' +
      '</ol>' +
      '<div class="intro-actions">' +
      '<button class="btn primary block" data-action="add-kid">아이 추가하기</button>' +
      '<button class="btn ghost block" data-action="load-sample">예시 계획표로 둘러보기</button>' +
      '<button class="btn ghost block" data-action="import-json">백업 불러오기</button>' +
      '</div></section>';
  }

  /* ---------- 오늘 ---------- */

  function viewToday() {
    var now = new Date();
    var classes = scopedClasses();
    var todays = L.todaysClasses(classes, now);
    var todayKey = L.dateKey(now);
    var dueHomeworks = L.sortHomeworks(openHomeworksDue());
    var next = L.nextClass(classes, now);
    var html = '';

    if (!state.data.classes.length) {
      html += '<section class="card notice">' +
        '<h2>아직 학원 일정이 없어요</h2>' +
        '<p>요일과 시간을 등록하면 오늘의 학원과 다음 수업까지 남은 시간을 알려드려요.</p>' +
        '<button class="btn primary" data-action="add-class">학원 등록하기</button></section>';
    } else if (next) {
      var st = next.status;
      html += '<section class="card hero" style="--c:' + esc(kidAccent(next.cls.kidId)) + '">' +
        '<div class="hero-top">' +
        '<span class="hero-eyebrow">' + (st.state === 'ongoing' ? '지금 수업 중' : '다음 수업') + '</span>' +
        '<span class="hero-when">' + esc(L.rangeText(next.cls.start, next.cls.end)) + '</span>' +
        '</div>' +
        '<div class="hero-name">' + esc(next.cls.name) + '</div>' +
        '<div class="hero-sub">' + kidTag(next.cls.kidId) +
        '<span class="hero-remain" data-live="cls:' + next.cls.id + '">' + esc(liveText(next.cls, now)) + '</span>' +
        '</div>' +
        (next.cls.place ? '<div class="hero-place">📍 ' + esc(next.cls.place) + '</div>' : '') +
        '<div class="hero-actions"><button class="btn tiny" data-action="edit-class" data-id="' + next.cls.id + '">일정 보기</button>' +
        (next.cls.memo ? '<span class="hero-memo">' + esc(next.cls.memo) + '</span>' : '') + '</div>' +
        '</section>';
    } else {
      html += '<section class="card hero" style="--c:var(--muted)">' +
        '<span class="hero-eyebrow">다음 수업</span>' +
        '<div class="hero-name">예정된 수업이 없어요</div>' +
        '<div class="hero-sub"><span class="hero-remain">학원 일정을 확인해 주세요</span></div></section>';
    }

    html += '<section class="card">' +
      '<header class="card-head"><h2>오늘의 학원</h2>' +
      '<span class="card-count">' + todays.length + '개</span>' +
      '<button class="btn tiny ghost" data-action="add-class">＋ 추가</button></header>' +
      (todays.length
        ? '<ul class="list">' + todays.map(function (c) { return classRow(c, now); }).join('') + '</ul>'
        : '<p class="empty">오늘은 등록된 학원이 없어요. 여유로운 하루 보내세요 🌿</p>') +
      '</section>';

    html += checklistCard({ compact: true });

    html += '<section class="card">' +
      '<header class="card-head"><h2>마감 숙제</h2>' +
      '<span class="card-count">' + dueHomeworks.length + '개</span>' +
      '<button class="btn tiny ghost" data-action="add-homework">＋ 추가</button></header>' +
      (dueHomeworks.length
        ? '<ul class="hwl">' + dueHomeworks.slice(0, 4).map(function (h) { return hwItem(h, now); }).join('') + '</ul>' +
        (dueHomeworks.length > 4 ? '<button class="btn tiny ghost block" data-action="set-view" data-view="homework">' + (dueHomeworks.length - 4) + '개 더 보기</button>' : '')
        : '<p class="empty">마감이 임박한 숙제가 없어요. 필요한 숙제는 ＋로 추가해 보세요.</p>') +
      '</section>';

    return html;
  }

  function classRow(c, now) {
    var st = L.classStatus(c, now);
    var label = !c.start ? '오늘' : (st.state === 'ongoing' ? '수업 중' : (st.state === 'today' ? liveText(c, now) : '오늘'));
    return '<li><button class="row" data-action="edit-class" data-id="' + c.id + '">' +
      '<span class="row-dot" style="--c:' + esc(kidAccent(c.kidId)) + '"></span>' +
      '<span class="row-main">' +
      '<span class="row-title">' + esc(c.name) + '</span>' +
      '<span class="row-sub">' + esc(timeLabel(c)) + (c.place ? ' · ' + esc(c.place) : '') + '</span>' +
      '</span>' +
      '<span class="row-side">' +
      '<span class="pill' + (st.state === 'ongoing' ? ' pill-live' : '') + '">' + esc(label) + '</span>' +
      (kidTag(c.kidId) ? '<span class="row-kid">' + kidTag(c.kidId) + '</span>' : '') +
      '</span></button></li>';
  }

  function hwItem(h, now) {
    var due = L.dueInfo(h.due, now);
    var meta = kidTag(h.kidId) + classTag(h.classId);
    return '<li class="hw' + (h.done ? ' is-done' : '') + '">' +
      '<button class="check' + (h.done ? ' on' : '') + '" data-action="toggle-hw" data-id="' + h.id + '"' +
      ' role="checkbox" aria-checked="' + (h.done ? 'true' : 'false') + '"' +
      ' aria-label="' + esc(h.title) + ' 완료 표시">' + (h.done ? '✓' : '') + '</button>' +
      '<button class="hw-body" data-action="edit-hw" data-id="' + h.id + '">' +
      '<span class="hw-title">' + esc(h.title) + '</span>' +
      (meta || h.memo ? '<span class="hw-meta">' + meta + (h.memo ? '<span class="hw-memo">' + esc(h.memo) + '</span>' : '') + '</span>' : '') +
      '</button>' +
      '<span class="due due--' + due.tone + '">' + esc(h.done ? '완료' : due.label) + '</span>' +
      '</li>';
  }

  /* ---------- 체크리스트 (오늘의 루틴) ---------- */

  function checklistCard(opts) {
    opts = opts || {};
    var compact = !!opts.compact;
    var key = L.dateKey(new Date());
    var list = todayRoutines();
    var groups = state.kid === 'all' ? state.data.kids : state.data.kids.filter(function (k) { return k.id === state.kid; });
    var totalStats = routineStats(list, key);

    var body = groups.map(function (k) {
      var mine = list.filter(function (r) { return r.kidId === k.id; });
      var stats = routineStats(mine, key);
      var open = mine.filter(function (r) { return !isRoutineDone(r, key); });
      var shown = compact ? open.slice(0, 3) : mine;
      var more = compact ? open.length - shown.length : 0;
      if (!mine.length) return '';
      return '<div class="kid-block" style="--c:' + esc(k.color) + '">' +
        '<div class="kid-block-head">' +
        '<span class="tag" style="--c:' + esc(k.color) + '"><span class="tag-emoji" aria-hidden="true">' + esc(k.emoji) + '</span>' + esc(k.name) + '</span>' +
        '<span class="prog-text">' + stats.done + '/' + stats.total + '</span>' +
        '</div>' +
        '<div class="prog"><span style="width:' + stats.pct + '%"></span></div>' +
        (shown.length
          ? '<ul class="hwl">' + shown.map(function (r) { return routineItem(r, key); }).join('') + '</ul>'
          : '<p class="empty small">오늘 체크리스트를 모두 마쳤어요 👏</p>') +
        (more > 0 ? '<button class="btn tiny ghost block" data-action="set-view" data-view="homework">' + more + '개 더 보기</button>' : '') +
        '</div>';
    }).filter(Boolean).join('');

    if (!list.length) {
      body = '<p class="empty">오늘은 체크리스트가 없어요. ＋로 매일 할 일을 등록해 보세요.</p>';
    }

    return '<section class="card">' +
      '<header class="card-head"><h2>오늘의 체크리스트</h2>' +
      '<span class="card-count">' + totalStats.done + '/' + totalStats.total + '</span>' +
      '<button class="btn tiny ghost" data-action="add-routine">＋ 할 일</button></header>' +
      body + '</section>';
  }

  function routineItem(r, key) {
    var done = isRoutineDone(r, key);
    return '<li class="hw' + (done ? ' is-done' : '') + '">' +
      '<button class="check' + (done ? ' on' : '') + '" data-action="toggle-routine" data-id="' + r.id + '"' +
      ' role="checkbox" aria-checked="' + (done ? 'true' : 'false') + '"' +
      ' aria-label="' + esc(r.title) + ' 완료 표시">' + (done ? '✓' : '') + '</button>' +
      '<button class="hw-body" data-action="edit-routine" data-id="' + r.id + '">' +
      '<span class="hw-title">' + esc(r.title) + '</span>' +
      (r.time || r.memo
        ? '<span class="hw-meta">' + (r.time ? '<span class="rt-time">' + esc(r.time) + '</span>' : '') +
        (r.memo ? '<span class="hw-memo">' + esc(r.memo) + '</span>' : '') + '</span>'
        : '') +
      '</button></li>';
  }

  /* ---------- 시간표 ---------- */

  function viewSchedule() {
    var now = new Date();
    var all = scopedClasses();
    var days = L.weekDates(now);
    var todayKey = L.dateKey(now);

    var rows = days.map(function (d) {
      var idx = L.dayIndex(d);
      var items = all.filter(function (c) { return (c.days || []).indexOf(idx) >= 0; })
        .sort(function (a, b) { return (L.hhmmToMinutes(a.start) || 0) - (L.hhmmToMinutes(b.start) || 0); });
      var isToday = L.dateKey(d) === todayKey;
      return '<div class="wrow' + (isToday ? ' is-today' : '') + '">' +
        '<div class="wday"><b>' + L.dayLabel(idx) + '</b><span>' + L.monthDay(d) + '</span></div>' +
        '<div class="witems">' +
        (items.length ? items.map(classChip).join('') : '<span class="wempty">—</span>') +
        '</div></div>';
    }).join('');

    var managed = state.data.classes.slice().sort(function (a, b) {
      return (L.hhmmToMinutes(a.start) || 0) - (L.hhmmToMinutes(b.start) || 0);
    }).map(function (c) {
      return '<li><div class="mng">' +
        '<span class="row-dot" style="--c:' + esc(kidAccent(c.kidId)) + '"></span>' +
        '<div class="mng-main">' +
        '<div class="mng-title">' + esc(c.name) + '</div>' +
        '<div class="mng-sub">' + (c.days || []).map(L.dayLabel).join('·') + ' · ' + esc(timeLabel(c)) +
        (c.place ? ' · ' + esc(c.place) : '') + '</div>' +
        '<div class="mng-tags">' + kidTag(c.kidId) + (c.memo ? '<span class="tag tag-plain">' + esc(c.memo) + '</span>' : '') + '</div>' +
        '</div>' +
        '<button class="btn tiny" data-action="edit-class" data-id="' + c.id + '">수정</button>' +
        '</div></li>';
    }).join('');

    return '<section class="card">' +
      '<header class="card-head"><h2>이번 주 시간표</h2>' +
      '<button class="btn tiny" data-action="add-class">＋ 학원</button></header>' +
      '<div class="week">' + rows + '</div></section>' +
      '<section class="card">' +
      '<header class="card-head"><h2>등록된 학원</h2><span class="card-count">' + state.data.classes.length + '개</span></header>' +
      (state.data.classes.length ? '<ul class="list mng-list">' + managed + '</ul>' : '<p class="empty">아직 등록된 학원이 없어요.</p>') +
      '</section>';
  }

  function classChip(c) {
    return '<button class="chip-class" style="--c:' + esc(kidAccent(c.kidId)) + '" data-action="edit-class" data-id="' + c.id + '">' +
      '<span class="chip-name">' + esc(c.name) + '</span>' +
      '<span class="chip-time">' + esc(timeLabel(c)) + '</span>' +
      '</button>';
  }

  /* ---------- 숙제 ---------- */

  function viewHomework() {
    var now = new Date();
    var works = L.sortHomeworks(scopedHomeworks());
    var open = works.filter(function (h) { return !h.done; });
    var done = works.filter(function (h) { return h.done; });
    var todayKey = L.dateKey(now);
    var shown = state.hwFilter === 'open' ? open : (state.hwFilter === 'done' ? done : works);
    var filters = [
      { id: 'open', label: '미완료 ' + open.length },
      { id: 'all', label: '전체 ' + works.length },
      { id: 'done', label: '완료 ' + done.length }
    ];
    var dueTodayCount = open.filter(function (h) { return h.due === todayKey; }).length;

    var body = shown.length
      ? '<ul class="hwl">' + shown.map(function (h) { return hwItem(h, now); }).join('') + '</ul>'
      : '<p class="empty">' + (state.hwFilter === 'done' ? '완료한 숙제가 없어요.' : '마감일이 있는 숙제가 없어요. 시험이나 준비물은 여기에 추가해 두세요.') + '</p>';

    return checklistCard({ compact: false }) +
      '<section class="card">' +
      '<header class="card-head"><h2>숙제</h2>' +
      '<button class="btn tiny" data-action="add-homework">＋ 숙제</button></header>' +
      '<div class="filters">' + filters.map(function (f) {
        return '<button class="fchip' + (state.hwFilter === f.id ? ' on' : '') + '" data-action="set-hw-filter" data-filter="' + f.id + '">' + f.label + '</button>';
      }).join('') + '</div>' +
      (dueTodayCount ? '<div class="banner">⏰ 오늘 마감 숙제가 ' + dueTodayCount + '개 있어요</div>' : '') +
      body + '</section>';
  }

  /* ---------- 설정 ---------- */

  /* 설정 맨 위: 관리자(엄마) 비밀번호 카드 */
  function lockCard() {
    var lock = lockInfo();
    var on = !!lock.hash;
    var stateText = !on ? '아직 없음' : (state.unlocked ? '풀림' : '잠김');
    var autoOpts = [
      { v: 1, t: '1분' }, { v: 5, t: '5분' }, { v: 10, t: '10분' }, { v: 30, t: '30분' }, { v: 0, t: '자동 잠금 없음' }
    ];

    var actions = on
      ? '<div class="btn-row">' +
        (state.unlocked
          ? '<button class="btn ghost" data-action="lock-now">지금 잠그기</button>'
          : '<button class="btn primary" data-action="lock-unlock">비밀번호 입력</button>') +
        '<button class="btn ghost" data-action="lock-set">비밀번호 변경</button>' +
        '</div>' +
        '<div class="btn-row"><button class="btn ghost danger" data-action="lock-off">비밀번호 삭제</button></div>'
      : '<button class="btn primary block" data-action="lock-set">비밀번호 설정</button>';

    return '<section class="card lock-card">' +
      '<header class="card-head"><h2>🔒 관리자(엄마) 비밀번호</h2><span class="pill' + (on && !state.unlocked ? ' pill-live' : '') + '">' + stateText + '</span></header>' +
      '<p class="card-desc">' + (on
        ? '비밀번호를 켜 두면 아이는 체크리스트·오늘의 학원·시간표를 그대로 볼 수 있지만, 일정·할 일·설정은 바꿀 수 없어요. 화면을 새로고침하거나 ' +
          '일정 시간 손을 대지 않으면 다시 잠깁니다.'
        : '아이가 일정을 함부로 바꾸지 않도록 4자리 숫자 비밀번호로 잠글 수 있어요. 체크와 보기는 잠그지 않아도 그대로 쓸 수 있어요.') + '</p>' +
      (on
        ? '<div class="setting"><span class="setting-label">자동 잠금</span>' +
          '<select class="select" data-locksetting="autoLockMin" aria-label="자동 잠금 시간">' +
          autoOpts.map(function (o) {
            return '<option value="' + o.v + '"' + (Number(lock.autoLockMin) === o.v ? ' selected' : '') + '>' + o.t + '</option>';
          }).join('') + '</select></div>'
        : '') +
      '<div class="lock-actions">' + actions + '</div>' +
      (on && lock.updatedAt
        ? '<p class="hint-line">마지막 변경: ' + esc(String(lock.updatedAt).slice(0, 10)) + ' · 비밀번호는 이 기기에만(해시로) 저장돼요.</p>'
        : '') +
      '</section>';
  }

  /* 잠긴 상태에서 설정 화면 대신 보여 주는 안내 */
  function lockedCard() {
    return '<section class="card intro lock-gate">' +
      '<div class="intro-emoji" aria-hidden="true">🔒</div>' +
      '<h2>관리자 잠금 상태예요</h2>' +
      '<p>설정을 바꾸려면 4자리 비밀번호를 입력해 주세요. 아이는 오늘의 학원·시간표·체크리스트를 그대로 볼 수 있어요.</p>' +
      '<div class="intro-actions">' +
      '<button class="btn primary block" data-action="lock-unlock">비밀번호 입력</button>' +
      '<button class="btn ghost block" data-action="import-json">백업 불러오기</button>' +
      '<button class="btn ghost block" data-action="pin-forgot">비밀번호를 잊었어요</button>' +
      '</div></section>';
  }

  function viewSettings() {
    var s = state.data.settings;
    var perm = notificationPermission();
    var permText = perm === 'granted' ? '허용됨' : perm === 'denied' ? '차단됨' : perm === 'unsupported' ? '지원 안 함' : '아직 허용 안 됨';

    return lockCard() +
      '<section class="card">' +
      '<header class="card-head"><h2>알림</h2><span class="pill">' + permText + '</span></header>' +
      (perm === 'granted' ? '' : '<div class="row-note">' +
        (perm === 'denied' ? '브라우저 설정에서 이 사이트의 알림을 허용해 주세요.'
          : '알림을 허용하면 학원 시작과 숙제 마감을 알려드려요.') +
        (perm === 'default' ? ' <button class="btn tiny primary" data-action="request-permission">알림 허용</button>' : '') +
        '</div>') +
      settingToggle('notifyClass', '학원 시작 알림', s.notifyClass) +
      settingSelect('classLeadMin', '몇 분 전에 알릴까요', s.classLeadMin, [
        { v: 10, t: '10분 전' }, { v: 15, t: '15분 전' }, { v: 30, t: '30분 전' }, { v: 60, t: '1시간 전' }
      ]) +
      settingToggle('notifyHomework', '숙제 마감 알림', s.notifyHomework) +
      settingTime('homeworkTime', '숙제 알림 시각', s.homeworkTime) +
      '<div class="row-note">알림은 앱을 열어 둔 동안 동작해요. 앱을 닫아도 받으려면 아래 <b>캘린더(.ics)</b>로 휴대폰 캘린더에 등록해 주세요.</div>' +
      '<button class="btn ghost block" data-action="test-notify">테스트 알림 보내기</button>' +
      '</section>' +

      '<section class="card">' +
      '<header class="card-head"><h2>캘린더로 내보내기</h2><span class="card-count">.ics</span></header>' +
      '<p class="card-desc">학원 일정(매주 반복)과 마감 숙제를 휴대폰 기본 캘린더에 한 번에 추가할 수 있어요. 내려받은 파일을 눌러 “캘린더에 추가”를 선택하세요.' +
      (state.kid !== 'all' ? ' 지금은 <b>' + esc((kidById(state.kid) || {}).name || '') + '</b> 일정만 내보냅니다.' : '') + '</p>' +
      '<div class="btn-row">' +
      '<button class="btn ghost" data-action="export-ics" data-scope="all">학원+숙제</button>' +
      '<button class="btn ghost" data-action="export-ics" data-scope="classes">학원 일정</button>' +
      '<button class="btn ghost" data-action="export-ics" data-scope="homework">숙제 마감</button>' +
      '</div></section>' +

      '<section class="card">' +
      '<header class="card-head"><h2>데이터</h2>' +
      '<span class="card-count">' + state.data.kids.length + '명 · ' + state.data.classes.length + '학원 · ' + state.data.routines.length + '할 일</span></header>' +
      '<p class="card-desc">모든 내용은 이 기기의 브라우저 저장소(localStorage)에만 저장됩니다. 기기를 바꾸기 전에 백업 파일을 저장해 두세요.</p>' +
      (isFileMode()
        ? '<p class="card-desc muted">지금은 파일로 열려 있어 저장이 유지되지 않을 수 있어요. 인터넷 주소(https)로 열거나 홈 화면에 추가해서 사용해 주세요.</p>'
        : '') +
      '<div class="btn-row">' +
      '<button class="btn ghost" data-action="export-json">백업 저장</button>' +
      '<button class="btn ghost" data-action="import-json">백업 불러오기</button>' +
      '</div>' +
      '<div class="btn-row">' +
      '<button class="btn ghost" data-action="load-sample">예시 계획표</button>' +
      '<button class="btn ghost danger" data-action="reset-all">전체 삭제</button>' +
      '</div></section>' +

      '<section class="card">' +
      '<header class="card-head"><h2>홈 화면에 추가</h2></header>' +
      (state.installEvent
        ? '<p class="card-desc">앱처럼 전체 화면으로 열 수 있어요.</p><button class="btn primary block" data-action="install">앱 설치</button>'
        : '<ol class="steps small">' +
        '<li><b>1</b><span>크롬 오른쪽 위 ⋮ 메뉴</span></li>' +
        '<li><b>2</b><span>“홈 화면에 추가” 선택</span></li>' +
        '<li><b>3</b><span>홈 화면 아이콘으로 실행</span></li>' +
        '</ol>' +
        '<p class="card-desc muted">인터넷 주소(https)로 열었을 때 설치 버튼이 나타나요. 파일로 열어도 사용할 수 있습니다.</p>') +
      '</section>' +

      '<p class="footnote">아이별 학원·숙제 관리 v' + APP_VERSION + ' · 데이터는 이 기기에만 저장됩니다.</p>';
  }

  function settingToggle(key, label, on) {
    return '<div class="setting"><span class="setting-label">' + label + '</span>' +
      '<button class="switch' + (on ? ' on' : '') + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '"' +
      ' aria-label="' + label + '" data-action="toggle-setting" data-key="' + key + '"><span></span></button></div>';
  }

  function settingSelect(key, label, value, options) {
    return '<div class="setting"><span class="setting-label">' + label + '</span>' +
      '<select class="select" data-setting="' + key + '" aria-label="' + label + '">' +
      options.map(function (o) {
        return '<option value="' + o.v + '"' + (String(o.v) === String(value) ? ' selected' : '') + '>' + o.t + '</option>';
      }).join('') + '</select></div>';
  }

  function settingTime(key, label, value) {
    return '<div class="setting"><span class="setting-label">' + label + '</span>' +
      '<input class="input input-time" type="time" data-setting="' + key + '" value="' + esc(value) + '" aria-label="' + label + '"></div>';
  }

  /* ================= 시트 ================= */

  function renderSheet() {
    var root = document.getElementById('modalRoot');
    if (!root) return;
    if (!state.sheet) {
      root.innerHTML = '';
      document.body.classList.remove('sheet-open');
      return;
    }
    document.body.classList.add('sheet-open');
    var t = state.sheet.type;
    if (t === 'pin') root.innerHTML = sheetPin();
    else if (t === 'kid') root.innerHTML = sheetKid(state.sheet.id);
    else if (t === 'class') root.innerHTML = sheetClass(state.sheet.id);
    else if (t === 'routine') root.innerHTML = sheetRoutine(state.sheet.id);
    else root.innerHTML = sheetHomework(state.sheet.id);
  }

  function sheetReadOnly() { return !!(state.sheet && state.sheet.readOnly); }

  function sheetShell(type, title, body, id) {
    var ro = sheetReadOnly();
    return '<div class="sheet-wrap" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<div class="backdrop" data-action="close-sheet"></div>' +
      '<form class="sheet" data-type="' + type + '" novalidate>' +
      '<div class="handle" aria-hidden="true"></div>' +
      '<h2 class="sheet-title">' + title + (ro ? ' <span class="pill">보기 전용</span>' : '') + '</h2>' +
      '<fieldset class="sheet-fieldset"' + (ro ? ' disabled' : '') + '>' + body + '</fieldset>' +
      '<p class="form-err" role="alert"></p>' +
      (ro
        ? '<div class="row-note locked-note">🔒 보기 전용이에요. 일정을 고치려면 관리자 비밀번호가 필요해요.</div>' +
          '<div class="sheet-actions">' +
          '<button type="button" class="btn ghost" data-action="close-sheet">닫기</button>' +
          '<button type="button" class="btn primary" data-action="unlock-edit">비밀번호 입력하고 수정</button>' +
          '</div>'
        : '<div class="sheet-actions">' +
          (id ? '<button type="button" class="btn ghost danger" data-action="delete-item">삭제</button>' : '') +
          '<button type="button" class="btn ghost" data-action="close-sheet">취소</button>' +
          '<button type="submit" class="btn primary">저장</button>' +
          '</div>') +
      '</form></div>';
  }

  function chipGroup(name, values, selected, multi) {
    return '<div class="chips" data-multi="' + (multi ? '1' : '0') + '">' + values.map(function (v) {
      var on = multi ? (selected || []).indexOf(v.value) >= 0 : selected === v.value;
      return '<button type="button" class="chip' + (on ? ' on' : '') + '" data-pickgroup="' + name + '"' +
        ' data-value="' + esc(v.value) + '"' + (v.style ? ' style="' + v.style + '"' : '') + '>' + v.label + '</button>';
    }).join('') + '</div>';
  }

  function kidSelect(currentId) {
    return state.data.kids.map(function (k) {
      return '<option value="' + k.id + '"' + (k.id === currentId ? ' selected' : '') + '>' +
        esc(k.emoji + ' ' + k.name) + '</option>';
    }).join('');
  }

  function dayValues() {
    return [1, 2, 3, 4, 5, 6, 7].map(function (i) { return { value: i, label: L.dayLabel(i) }; });
  }

  function sheetKid(id) {
    var k = id ? kidById(id) : null;
    var emojis = EMOJIS.map(function (e) { return { value: e, label: e }; });
    var colors = COLORS.map(function (c) { return { value: c, label: '', style: '--c:' + c }; });
    var body =
      '<label class="field"><span class="field-label">이름</span>' +
      '<input class="input" name="name" value="' + esc(k ? k.name : '') + '" placeholder="예: 첫째" maxlength="12" autocomplete="off" enterkeyhint="done"></label>' +
      '<div class="field"><span class="field-label">아바타</span>' +
      chipGroup('emoji', emojis, k ? k.emoji : EMOJIS[state.data.kids.length % EMOJIS.length], false) + '</div>' +
      '<div class="field"><span class="field-label">색상</span>' +
      chipGroup('color', colors, k ? k.color : COLORS[state.data.kids.length % COLORS.length], false) + '</div>';
    return sheetShell('kid', sheetReadOnly() ? '아이 정보' : (id ? '아이 수정' : '아이 추가'), body, id);
  }

  function sheetClass(id) {
    var c = id ? classById(id) : null;
    var defaultKid = c ? c.kidId : (state.kid !== 'all' ? state.kid : (state.data.kids[0] || {}).id);
    var body =
      '<label class="field"><span class="field-label">아이</span>' +
      '<select class="input" name="kidId">' + kidSelect(defaultKid) + '</select></label>' +
      '<label class="field"><span class="field-label">학원 이름</span>' +
      '<input class="input" name="name" value="' + esc(c ? c.name : '') + '" placeholder="예: 수학학원" maxlength="30" autocomplete="off"></label>' +
      '<div class="field"><span class="field-label">요일 <span class="hint">여러 개 선택할 수 있어요</span></span>' +
      chipGroup('day', dayValues(), c ? c.days : [], true) + '</div>' +
      '<div class="field field-2">' +
      '<label class="sub"><span class="field-label">시작</span><input class="input" type="time" name="start" value="' + esc(c ? c.start : '16:00') + '"></label>' +
      '<label class="sub"><span class="field-label">종료</span><input class="input" type="time" name="end" value="' + esc(c ? c.end : '17:30') + '"></label>' +
      '</div>' +
      '<label class="field"><span class="field-label">장소</span>' +
      '<input class="input" name="place" value="' + esc(c ? c.place : '') + '" placeholder="예: 대치동 3층" maxlength="40"></label>' +
      '<label class="field"><span class="field-label">메모</span>' +
      '<textarea class="input" name="memo" rows="2" placeholder="준비물, 하교 후 바로 이동 등" maxlength="200">' + esc(c ? c.memo : '') + '</textarea></label>' +
      '<p class="hint-line">시간을 비우면 “시간 미정”으로 표시돼요. (예: 도서관 책읽기)</p>';
    return sheetShell('class', sheetReadOnly() ? '학원 일정' : (id ? '학원 수정' : '학원 추가'), body, id);
  }

  function sheetRoutine(id) {
    var r = id ? routineById(id) : null;
    var defaultKid = r ? r.kidId : (state.kid !== 'all' ? state.kid : (state.data.kids[0] || {}).id);
    var body =
      '<label class="field"><span class="field-label">아이</span>' +
      '<select class="input" name="kidId">' + kidSelect(defaultKid) + '</select></label>' +
      '<label class="field"><span class="field-label">할 일</span>' +
      '<input class="input" name="title" value="' + esc(r ? r.title : '') + '" placeholder="예: 숙제 확인" maxlength="40" autocomplete="off"></label>' +
      '<div class="field"><span class="field-label">요일 <span class="hint">여러 개 선택할 수 있어요</span></span>' +
      chipGroup('day', dayValues(), r ? r.days : [], true) + '</div>' +
      '<label class="field"><span class="field-label">시간대 <span class="hint">선택</span></span>' +
      '<input class="input" name="time" value="' + esc(r ? r.time : '') + '" placeholder="예: 19:00~21:00" maxlength="30"></label>' +
      '<label class="field"><span class="field-label">메모</span>' +
      '<textarea class="input" name="memo" rows="2" placeholder="교재 이름, 분량 등" maxlength="200">' + esc(r ? r.memo : '') + '</textarea></label>';
    return sheetShell('routine', sheetReadOnly() ? '할 일' : (id ? '할 일 수정' : '할 일 추가'), body, id);
  }

  function sheetHomework(id) {
    var h = id ? homeworkById(id) : null;
    var defaultKid = h ? h.kidId : (state.kid !== 'all' ? state.kid : (state.data.kids[0] || {}).id);
    var classOptions = '<option value="">학원 없음 (기타)</option>' + state.data.classes.map(function (c) {
      var k = kidById(c.kidId);
      return '<option value="' + c.id + '"' + (h && h.classId === c.id ? ' selected' : '') + '>' +
        esc((k ? k.name + ' · ' : '') + c.name) + '</option>';
    }).join('');
    var body =
      '<label class="field"><span class="field-label">아이</span>' +
      '<select class="input" name="kidId">' + kidSelect(defaultKid) + '</select></label>' +
      '<label class="field"><span class="field-label">숙제 내용</span>' +
      '<input class="input" name="title" value="' + esc(h ? h.title : '') + '" placeholder="예: 수학 문제집 p.30~35" maxlength="60" autocomplete="off"></label>' +
      '<label class="field"><span class="field-label">학원</span>' +
      '<select class="input" name="classId">' + classOptions + '</select></label>' +
      '<label class="field"><span class="field-label">마감일</span>' +
      '<input class="input" type="date" name="due" value="' + esc(h ? h.due : L.dateKey(new Date())) + '"></label>' +
      '<label class="field"><span class="field-label">메모</span>' +
      '<textarea class="input" name="memo" rows="2" placeholder="준비물, 페이지 등" maxlength="200">' + esc(h ? h.memo : '') + '</textarea></label>' +
      (h ? '<div class="field"><span class="field-label">상태</span><div class="chips">' +
        '<button type="button" class="chip' + (h.done ? ' on' : '') + '" data-action="toggle-done-in-sheet">' +
        (h.done ? '✓ 완료됨' : '미완료') + '</button></div></div>' : '');
    return sheetShell('homework', sheetReadOnly() ? '숙제' : (id ? '숙제 수정' : '숙제 추가'), body, id);
  }

  /* ---------- 관리자 비밀번호(PIN) 입력 ---------- */

  function openPinSheet(mode, after) {
    state.sheet = {
      type: 'pin',
      mode: mode === 'set' ? 'set' : 'unlock',
      stage: mode === 'set' ? 'new' : 'unlock',
      buf: '',
      first: '',
      err: '',
      help: false,
      after: typeof after === 'function' ? after : null
    };
    renderAll();
  }

  function pinDots(buf) {
    var out = '';
    for (var i = 0; i < 4; i++) out += '<span class="pin-dot' + (i < buf.length ? ' on' : '') + '"></span>';
    return '<div class="pin-dots" aria-label="' + buf.length + '자리 입력됨">' + out + '</div>';
  }

  function pinPad() {
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'blank', '0', 'del'];
    return '<div class="pin-pad">' + keys.map(function (k) {
      if (k === 'blank') return '<span class="pin-key pin-key-blank" aria-hidden="true"></span>';
      if (k === 'del') return '<button type="button" class="pin-key pin-key-fn" data-action="pin-key" data-key="del" aria-label="지우기">⌫</button>';
      return '<button type="button" class="pin-key" data-action="pin-key" data-key="' + k + '">' + k + '</button>';
    }).join('') + '</div>';
  }

  function sheetPin() {
    var s = state.sheet;
    var setMode = s.mode === 'set';
    var confirming = setMode && s.stage === 'confirm';
    var title = setMode
      ? (confirming ? '비밀번호 한 번 더' : (hasPin() ? '새 관리자 비밀번호' : '관리자 비밀번호 만들기'))
      : '관리자 비밀번호 입력';
    var desc = setMode
      ? (confirming ? '같은 4자리 숫자를 한 번 더 눌러 주세요.'
        : '아이가 함부로 바꾸지 않도록 잠글 4자리 숫자를 정해 주세요. (예: 기억하기 쉬운 생일·기념일)')
      : '설정이나 일정을 고치려면 4자리 비밀번호를 입력해 주세요.';
    var blockLeft = Math.ceil(Math.max(0, state.pinBlockUntil - Date.now()) / 1000);

    return '<div class="sheet-wrap" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
      '<div class="backdrop" data-action="close-sheet"></div>' +
      '<div class="sheet pin-sheet">' +
      '<div class="handle" aria-hidden="true"></div>' +
      '<h2 class="sheet-title">🔒 ' + title + '</h2>' +
      '<p class="card-desc">' + desc + '</p>' +
      pinDots(s.buf) +
      '<p class="pin-err' + (s.err ? ' show' : '') + '" role="alert">' + esc(s.err || '') + '</p>' +
      '<p class="pin-wait' + (blockLeft > 0 ? ' show' : '') + '">' + (blockLeft > 0 ? blockLeft + '초 뒤에 다시 시도할 수 있어요.' : '') + '</p>' +
      pinPad() +
      '<div class="sheet-actions">' +
      '<button type="button" class="btn ghost" data-action="close-sheet">취소</button>' +
      (confirming
        ? '<button type="button" class="btn ghost" data-action="pin-restart">처음부터</button>'
        : (setMode ? '' : '<button type="button" class="btn ghost" data-action="pin-forgot">비밀번호를 잊었어요</button>')) +
      '</div>' +
      (s.help
        ? '<div class="pin-help">' +
          '<p>비밀번호는 이 기기에 해시로만 저장돼서 찾아낼 수 없어요. 잊었다면 <b>이 기기의 앱 데이터를 초기화</b>한 뒤, 미리 저장해 둔 백업 파일을 불러와 주세요. (백업을 불러오면 잠금이 풀린 상태로 시작합니다.)</p>' +
          '<button type="button" class="btn ghost danger block" data-action="reset-from-lock">이 기기 데이터 초기화</button>' +
          '</div>'
        : '') +
      '</div></div>';
  }

  function submitPin() {
    var s = state.sheet;
    if (!s || s.type !== 'pin') return;
    var pin = String(s.buf || '');
    if (pin.length !== 4) return;

    if (s.mode === 'set') {
      if (s.stage === 'new') {
        s.first = pin;
        s.stage = 'confirm';
        s.buf = '';
        s.err = '';
        renderAll();
        return;
      }
      if (pin === s.first) {
        setPin(pin);
        state.sheet = null;
        renderAll();
        toast('관리자 비밀번호를 설정했어요. 체크·보기는 그대로, 일정 수정만 잠깁니다');
        return;
      }
      s.stage = 'new';
      s.first = '';
      s.buf = '';
      s.err = '두 번 입력한 번호가 달라요. 처음부터 다시 눌러 주세요.';
      renderAll();
      return;
    }

    if (state.pinBlockUntil > Date.now()) {
      s.buf = '';
      s.err = '';
      renderAll();
      return;
    }
    if (verifyPin(pin)) {
      var after = s.after;
      state.sheet = null;
      renderAll();
      if (typeof after === 'function') after();
      else toast('관리자 잠금을 풀었어요');
      return;
    }
    s.buf = '';
    s.err = state.pinBlockUntil > Date.now()
      ? '5번 틀렸어요. 30초 뒤에 다시 시도해 주세요.'
      : '비밀번호가 맞지 않아요. (' + state.pinFails + '/5)';
    renderAll();
  }

  /* ---------- 렌더 ---------- */

  function renderLockBtn() {
    var btn = document.getElementById('lockBtn');
    if (!btn) return;
    var on = hasPin();
    var locked = on && !state.unlocked;
    btn.hidden = !on;
    btn.textContent = locked ? '🔒' : '🔓';
    btn.setAttribute('aria-label', locked ? '관리자 잠금 풀기' : '관리자 잠금 걸기');
    btn.setAttribute('aria-pressed', locked ? 'true' : 'false');
    btn.title = locked ? '관리자 잠금 풀기' : '관리자 잠금 걸기';
  }

  function renderAll() {
    var today = document.getElementById('todayLine');
    if (today) today.textContent = headerLine();
    var kidBar = document.getElementById('kidBar');
    if (kidBar) kidBar.innerHTML = renderKidBar();
    var main = document.getElementById('main');
    if (main) main.innerHTML = renderMain();
    var tabBar = document.getElementById('tabBar');
    if (tabBar) tabBar.innerHTML = renderTabBar();
    renderLockBtn();
    renderSheet();
  }

  /* ================= 시트 동작 ================= */

  function openSheet(type, id) {
    if (!state.data.kids.length && type !== 'kid') {
      toast('먼저 아이를 추가해 주세요.');
      type = 'kid';
      id = null;
    }
    state.sheet = { type: type, id: id || null };
    renderAll();
    var input = document.querySelector('.sheet input, .sheet select');
    if (input && input.focus) setTimeout(function () { try { input.focus(); } catch (e) {} }, 80);
  }

  function closeSheet() {
    state.sheet = null;
    renderAll();
  }

  function pickedValues(form, group) {
    var nodes = form.querySelectorAll('[data-pickgroup="' + group + '"].on');
    return Array.prototype.map.call(nodes, function (n) { return n.getAttribute('data-value'); });
  }

  function fieldValue(form, name) {
    var el = form.querySelector('[name="' + name + '"]');
    return el ? el.value : '';
  }

  function showFormError(form, message) {
    var box = form.querySelector('.form-err');
    if (!box) return;
    box.textContent = message || '';
    box.classList.toggle('show', !!message);
  }

  function submitSheet(form) {
    var type = form.getAttribute('data-type');
    var id = state.sheet ? state.sheet.id : null;
    var result;

    /* 잠금이 걸린 뒤 Enter 로 폼이 넘어오는 경우를 막는다 */
    if (lockRequired()) {
      var pending = state.sheet ? { type: state.sheet.type, id: state.sheet.id } : null;
      showFormError(form, '관리자 비밀번호가 필요해요.');
      openPinSheet('unlock', function () {
        if (pending) state.sheet = { type: pending.type, id: pending.id };
        renderAll();
      });
      return;
    }
    if (type === 'kid') {
      result = upsertKid({
        id: id,
        name: fieldValue(form, 'name'),
        color: pickedValues(form, 'color')[0],
        emoji: pickedValues(form, 'emoji')[0]
      });
    } else if (type === 'class') {
      result = upsertClass({
        id: id,
        kidId: fieldValue(form, 'kidId'),
        name: fieldValue(form, 'name'),
        days: pickedValues(form, 'day'),
        start: fieldValue(form, 'start'),
        end: fieldValue(form, 'end'),
        place: fieldValue(form, 'place'),
        memo: fieldValue(form, 'memo')
      });
    } else if (type === 'routine') {
      result = upsertRoutine({
        id: id,
        kidId: fieldValue(form, 'kidId'),
        title: fieldValue(form, 'title'),
        days: pickedValues(form, 'day'),
        time: fieldValue(form, 'time'),
        memo: fieldValue(form, 'memo')
      });
    } else {
      result = upsertHomework({
        id: id,
        kidId: fieldValue(form, 'kidId'),
        classId: fieldValue(form, 'classId'),
        title: fieldValue(form, 'title'),
        due: fieldValue(form, 'due'),
        memo: fieldValue(form, 'memo')
      });
    }

    if (!result.ok) {
      showFormError(form, result.error);
      return;
    }
    state.sheet = null;
    if (type === 'kid' && !id && result.kid) state.kid = result.kid.id;
    renderAll();
    toast(type === 'kid' ? '아이를 저장했어요'
      : type === 'class' ? '학원 일정을 저장했어요'
        : type === 'routine' ? '할 일을 저장했어요' : '숙제를 저장했어요');
  }

  /* ================= 알림 ================= */

  function isFileMode() {
    return !!(window.location && window.location.protocol === 'file:');
  }

  function notificationPermission() {
    if (typeof window.Notification === 'undefined') return 'unsupported';
    return window.Notification.permission;
  }

  function showNotification(title, body, tag) {
    if (notificationPermission() !== 'granted') return false;
    if (state.swReg && state.swReg.showNotification) {
      try {
        state.swReg.showNotification(title, { body: body, tag: tag, icon: 'icon-192.png', badge: 'icon-192.png' });
        return true;
      } catch (e) { /* 기본 방식 시도 */ }
    }
    try {
      new window.Notification(title, { body: body, tag: tag, icon: 'icon-192.png' });
      return true;
    } catch (e) {
      toast(title + ' — ' + body);
      return false;
    }
  }

  function afterPermission(result) {
    renderAll();
    if (result === 'granted') {
      toast('알림을 켰어요');
      showNotification('알림이 켜졌어요', '학원 시작과 숙제 마감을 알려드릴게요.', 'welcome');
    } else if (result === 'denied') {
      toast('알림이 차단됐어요. 브라우저 설정에서 허용해 주세요.');
    }
  }

  function requestPermission() {
    if (typeof window.Notification === 'undefined') {
      toast('이 브라우저는 알림을 지원하지 않아요.');
      return;
    }
    try {
      var p = window.Notification.requestPermission(function (result) { afterPermission(result); });
      if (p && p.then) p.then(afterPermission).catch(function () {});
    } catch (e) {
      toast('알림 권한을 요청하지 못했어요.');
    }
  }

  function testNotification() {
    if (notificationPermission() === 'granted') {
      if (!showNotification('테스트 알림', '이렇게 알려드릴게요. 잘 보이시나요?', 'test')) {
        toast('알림을 표시하지 못했어요.');
      }
    } else if (notificationPermission() === 'denied') {
      toast('알림이 차단되어 있어요. 브라우저 설정에서 허용해 주세요.');
    } else {
      requestPermission();
    }
  }

  function pruneFired(now) {
    var limit = now.getTime() - 7 * 86400000;
    var fired = state.data.fired || {};
    Object.keys(fired).forEach(function (key) {
      if (Number(fired[key]) < limit) delete fired[key];
    });
  }

  function pruneChecks() {
    var limit = L.dateKey(new Date(Date.now() - 30 * 86400000));
    var checks = state.data.checks || {};
    Object.keys(checks).forEach(function (key) {
      var day = key.split('|')[1];
      if (!day || day < limit) delete checks[key];
    });
  }

  function checkNotifications() {
    if (notificationPermission() !== 'granted') return;
    var now = new Date();
    var today = L.dateKey(now);
    var s = state.data.settings;
    var fired = state.data.fired || (state.data.fired = {});
    var changed = false;

    if (s.notifyClass) {
      var lead = Math.max(0, Number(s.classLeadMin) || 0) * 60000;
      state.data.classes.forEach(function (c) {
        if (L.hhmmToMinutes(c.start) == null) return;
        if ((c.days || []).indexOf(L.dayIndex(now)) < 0) return;
        var b = L.classBounds(c, now);
        var key = 'cls:' + c.id + ':' + today;
        var from = new Date(b.start.getTime() - lead);
        if (!fired[key] && now >= from && now < b.start) {
          fired[key] = now.getTime();
          changed = true;
          var kid = kidById(c.kidId);
          var mins = Math.round(lead / 60000);
          showNotification(
            (kid ? kid.name + ' ' : '') + c.name,
            L.clockText(c.start) + ' 시작' + (mins > 0 ? ' · ' + mins + '분 남았어요' : '') + (c.place ? ' · ' + c.place : ''),
            key
          );
        }
      });
    }

    if (s.notifyHomework) {
      var hm = /^(\d{1,2}):(\d{2})$/.exec(String(s.homeworkTime || '20:00'));
      var at = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
        hm ? Number(hm[1]) : 20, hm ? Number(hm[2]) : 0, 0, 0);
      if (now >= at) {
        state.data.homeworks.filter(function (h) { return !h.done && h.due === today; }).forEach(function (h) {
          var key = 'hw:' + h.id + ':' + h.due;
          if (!fired[key]) {
            fired[key] = now.getTime();
            changed = true;
            var kid = kidById(h.kidId);
            showNotification('오늘 마감 숙제', (kid ? kid.name + ' · ' : '') + h.title, key);
          }
        });
      }
    }

    if (changed) {
      pruneFired(now);
      save();
    }
  }

  /* ================= 주기 갱신 ================= */

  function updateLive() {
    var now = new Date();
    var nodes = document.querySelectorAll('[data-live]');
    Array.prototype.forEach.call(nodes, function (el) {
      var parts = (el.getAttribute('data-live') || '').split(':');
      if (parts[0] === 'cls') {
        var c = classById(parts[1]);
        if (c) el.textContent = liveText(c, now);
      }
    });
  }

  function tick() {
    var today = L.dateKey(new Date());
    if (state.dayKey !== today) {
      state.dayKey = today;
      renderAll();
    } else {
      updateLive();
      var line = document.getElementById('todayLine');
      if (line) line.textContent = headerLine();
    }
    autoLockCheck();
    checkNotifications();
  }

  /* ================= 파일 내보내기 ================= */

  function download(text, filename, mime) {
    try {
      var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        try { URL.revokeObjectURL(url); a.remove(); } catch (e) {}
      }, 1500);
      return true;
    } catch (e) {
      toast('파일을 만들지 못했어요.');
      return false;
    }
  }

  function exportJSON() {
    var payload = { app: 'academy-manager', version: 1, exportedAt: new Date().toISOString(), data: state.data };
    if (download(JSON.stringify(payload, null, 2), '아이별-백업-' + L.dateKey(new Date()) + '.json', 'application/json;charset=utf-8')) {
      toast('백업 파일을 저장했어요');
    }
  }

  function importJSONFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(String(reader.result));
        var raw = parsed && parsed.data ? parsed.data : parsed;
        if (!raw || !Array.isArray(raw.kids)) throw new Error('format');
        var next = normalizeData(raw);
        if (!window.confirm('불러온 백업으로 현재 데이터를 바꿀까요?\n(아이 ' + next.kids.length + '명 · 학원 ' + next.classes.length +
          '개 · 할 일 ' + next.routines.length + '개 · 숙제 ' + next.homeworks.length + '개)')) return;
        state.data = next;
        state.kid = 'all';
        /* 불러온 사람을 관리자로 본다 — 백업에 잠금이 들어 있어도 이번 화면에서는 풀린 상태로 둔다 */
        state.unlocked = true;
        save();
        renderAll();
        toast(next.lock && next.lock.hash
          ? '백업을 불러왔어요. 관리자 비밀번호도 함께 복원됐어요'
          : '백업을 불러왔어요');
      } catch (e) {
        toast('백업 파일을 읽을 수 없어요.');
      }
    };
    reader.onerror = function () { toast('파일을 읽지 못했어요.'); };
    reader.readAsText(file);
  }

  function exportICS(scope) {
    var now = new Date();
    var classes = scopedClasses();
    var works = scopedHomeworks().map(function (h) {
      var c = h.classId ? classById(h.classId) : null;
      return Object.assign({}, h, { className: c ? c.name : '' });
    });
    var only = scope || 'all';
    var label = only === 'classes' ? '학원일정' : only === 'homework' ? '숙제마감' : '일정전체';
    var scopeName = state.kid === 'all' ? '전체' : ((kidById(state.kid) || {}).name || '');
    var ics = L.buildICS({
      kids: state.data.kids,
      classes: only === 'homework' ? [] : classes,
      homeworks: only === 'classes' ? [] : works,
      now: now,
      alarmMinutes: state.data.settings.notifyClass ? state.data.settings.classLeadMin : 0,
      calendarName: '아이별 학원 일정 (' + scopeName + ')'
    });
    if (download(ics, '아이별-' + label + '-' + L.dateKey(now) + '.ics', 'text/calendar;charset=utf-8')) {
      toast('.ics 파일을 저장했어요. 파일을 눌러 캘린더에 추가하세요.');
    }
  }

  /* ================= 예시 계획표 (익명 샘플) ================= */

  function buildSampleData() {
    var kids = [
      { id: uid('kid'), name: '첫째', color: '#6366f1', emoji: '🦊' },
      { id: uid('kid'), name: '둘째', color: '#ec4899', emoji: '🐰' }
    ];
    var A = kids[0].id, B = kids[1].id;
    var cls = function (kidId, name, days, start, end, place, memo) {
      return { id: uid('cls'), kidId: kidId, name: name, days: days, start: start || '', end: end || '', place: place || '', memo: memo || '' };
    };
    var rt = function (kidId, title, days, time, memo) {
      return { id: uid('rt'), kidId: kidId, title: title, days: days, time: time || '', memo: memo || '' };
    };

    var classes = [
      /* 첫째 */
      cls(A, '수학학원', [1, 3], '16:00', '17:30'),
      cls(A, '태권도', [2, 4], '18:00', '19:00'),
      cls(A, '도서관', [6], '', '', '', '책 읽기'),
      /* 둘째 */
      cls(B, '피아노', [1, 5], '15:00', '15:50'),
      cls(B, '영어학원', [2, 4], '16:00', '17:00'),
      cls(B, '도서관', [6], '', '', '', '책 읽기')
    ];

    var routines = [
      /* 첫째 */
      rt(A, '숙제 확인', [1, 2, 3, 4, 5], '19:00~20:00'),
      rt(A, '받아쓰기 연습', [1, 3, 5], ''),
      rt(A, '주말 독서', [6], ''),
      /* 둘째 */
      rt(B, '숙제 확인', [1, 2, 3, 4, 5], '19:00~20:00'),
      rt(B, '피아노 연습', [1, 2, 3, 4, 5], ''),
      rt(B, '주말 독서', [6], '')
    ];

    return {
      version: 1,
      kids: kids,
      classes: classes,
      routines: routines,
      homeworks: [],
      checks: {},
      settings: defaultSettings(),
      fired: {},
      createdAt: new Date().toISOString()
    };
  }

  function loadSamplePlan() {
    if (state.data.kids.length) {
      if (!window.confirm('예시 계획표로 바꿀까요?\n지금 입력한 아이·학원·할 일·숙제가 모두 바뀝니다.')) return;
    }
    var settings = state.data.settings;
    state.data = buildSampleData();
    state.data.settings = settings;
    state.kid = 'all';
    state.view = 'today';
    state.sheet = null;
    save();
    renderAll();
    toast('예시 계획표를 불러왔어요');
  }

  function resetAll() {
    if (!window.confirm('모든 데이터를 삭제할까요?\n아이·학원·할 일·숙제 기록이 모두 지워집니다.')) return;
    state.data = blankData();
    state.kid = 'all';
    state.view = 'today';
    state.sheet = null;
    save();
    renderAll();
    toast('모든 데이터를 지웠어요');
  }

  /* 비밀번호를 잊었을 때 — 이 기기 데이터를 초기화(잠금까지 함께 사라짐)하고 백업으로 복원 */
  function resetFromLockScreen() {
    if (!window.confirm('이 기기의 앱 데이터를 모두 지울까요?\n아이·학원·할 일·숙제·관리자 비밀번호가 함께 지워집니다. 되돌릴 수 없어요.')) return;
    var typed = '';
    try { typed = String(window.prompt('정말 초기화하려면 “초기화”를 입력해 주세요.', '') || ''); } catch (e) { typed = ''; }
    if (typed.trim() !== '초기화') {
      toast('입력한 내용이 달라 초기화하지 않았어요');
      return;
    }
    state.data = blankData();
    state.kid = 'all';
    state.view = 'today';
    state.sheet = null;
    state.unlocked = true;
    save();
    renderAll();
    toast('앱 데이터를 초기화했어요. 백업 파일이 있으면 불러와 주세요');
  }

  /* ================= 이벤트 ================= */

  function handleClick(event) {
    var target = event.target;
    if (!target || !target.closest) return;
    markActivity();

    var pick = target.closest('[data-pickgroup]');
    if (pick) {
      var box = pick.closest('.chips');
      var multi = box && box.getAttribute('data-multi') === '1';
      if (multi) {
        pick.classList.toggle('on');
      } else {
        Array.prototype.forEach.call(box.querySelectorAll('[data-pickgroup]'), function (n) { n.classList.remove('on'); });
        pick.classList.add('on');
      }
      return;
    }

    var el = target.closest('[data-action]');
    if (!el) return;
    var action = el.getAttribute('data-action');
    var id = el.getAttribute('data-id');

    switch (action) {
      case 'set-view':
        var nextView = el.getAttribute('data-view');
        if (nextView === 'settings' && lockRequired()) {
          openPinSheet('unlock', function () { state.view = 'settings'; renderAll(); });
          break;
        }
        state.view = nextView;
        renderAll();
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
        break;
      case 'set-kid':
        state.kid = el.getAttribute('data-kid') || 'all';
        renderAll();
        break;
      case 'set-hw-filter':
        state.hwFilter = el.getAttribute('data-filter') || 'open';
        renderAll();
        break;
      case 'add-kid':
        guardEdit(function () { openSheet('kid', null); });
        break;
      case 'add-class':
        guardEdit(function () { openSheet('class', null); });
        break;
      case 'add-routine':
        guardEdit(function () { openSheet('routine', null); });
        break;
      case 'add-homework':
        guardEdit(function () { openSheet('homework', null); });
        break;
      case 'edit-kid':
        openItemSheet('kid', id);
        break;
      case 'edit-class':
        openItemSheet('class', id);
        break;
      case 'edit-routine':
        openItemSheet('routine', id);
        break;
      case 'edit-hw':
        openItemSheet('homework', id);
        break;
      case 'toggle-hw':
        toggleHomework(id);
        renderAll();
        if (homeworkById(id) && homeworkById(id).done) toast('숙제 완료! 👏');
        break;
      case 'toggle-routine':
        toggleRoutine(id);
        renderAll();
        if (routineById(id) && isRoutineDone(routineById(id), L.dateKey(new Date()))) toast('완료! 👏');
        break;
      case 'toggle-done-in-sheet':
        if (state.sheet && state.sheet.id) {
          toggleHomework(state.sheet.id);
          var updated = homeworkById(state.sheet.id);
          var btn = document.querySelector('.sheet [data-action="toggle-done-in-sheet"]');
          if (btn && updated) {
            btn.classList.toggle('on', updated.done);
            btn.textContent = updated.done ? '✓ 완료됨' : '미완료';
          }
          var line = document.getElementById('todayLine');
          if (line) line.textContent = headerLine();
        }
        break;
      case 'close-sheet':
        closeSheet();
        break;
      case 'delete-item':
        guardEdit(deleteCurrentSheetItem);
        break;
      case 'unlock-edit':
        var viewing = state.sheet;
        openPinSheet('unlock', function () {
          if (viewing) { state.sheet = { type: viewing.type, id: viewing.id, readOnly: false }; renderAll(); }
        });
        break;
      case 'pin-key':
        var sheetPinState = state.sheet;
        if (!sheetPinState || sheetPinState.type !== 'pin') break;
        var digit = el.getAttribute('data-key');
        if (digit === 'del') sheetPinState.buf = String(sheetPinState.buf || '').slice(0, -1);
        else if (/^[0-9]$/.test(digit || '') && String(sheetPinState.buf || '').length < 4) {
          sheetPinState.buf = String(sheetPinState.buf || '') + digit;
        }
        sheetPinState.err = '';
        if (String(sheetPinState.buf || '').length === 4) { submitPin(); break; }
        renderAll();
        break;
      case 'pin-restart':
        if (state.sheet && state.sheet.type === 'pin') {
          state.sheet.stage = 'new';
          state.sheet.first = '';
          state.sheet.buf = '';
          state.sheet.err = '';
          renderAll();
        }
        break;
      case 'pin-forgot':
        if (state.sheet && state.sheet.type === 'pin') {
          state.sheet.help = !state.sheet.help;
          renderAll();
        } else {
          openPinSheet('unlock');
          if (state.sheet && state.sheet.type === 'pin') { state.sheet.help = true; renderAll(); }
        }
        break;
      case 'reset-from-lock':
        resetFromLockScreen();
        break;
      case 'lock-set':
        guardEdit(function () { openPinSheet('set'); });
        break;
      case 'lock-change':
        guardEdit(function () { openPinSheet('set'); });
        break;
      case 'lock-unlock':
        if (!hasPin()) { toast('아직 관리자 비밀번호가 없어요. 설정에서 먼저 만들어 주세요.'); break; }
        openPinSheet('unlock', function () { renderAll(); });
        break;
      case 'lock-now':
        lockNow();
        renderAll();
        break;
      case 'toggle-lock':
        if (!hasPin()) { toast('설정에서 관리자 비밀번호를 먼저 만들어 주세요.'); break; }
        if (lockRequired()) openPinSheet('unlock', function () { renderAll(); });
        else { lockNow(); renderAll(); }
        break;
      case 'lock-off':
        if (!hasPin()) break;
        if (!window.confirm('관리자 비밀번호를 삭제할까요?\n삭제하면 아이도 일정을 고칠 수 있게 됩니다.')) break;
        clearPin();
        renderAll();
        toast('관리자 비밀번호를 삭제했어요');
        break;
      case 'toggle-setting':
        var key = el.getAttribute('data-key');
        state.data.settings[key] = !state.data.settings[key];
        save();
        renderAll();
        if (key === 'notifyClass' && state.data.settings[key] && notificationPermission() === 'default') requestPermission();
        break;
      case 'request-permission':
        requestPermission();
        break;
      case 'test-notify':
        testNotification();
        break;
      case 'export-json':
        exportJSON();
        break;
      case 'import-json':
        var input = document.getElementById('importFile');
        if (input) input.click();
        break;
      case 'export-ics':
        exportICS(el.getAttribute('data-scope'));
        break;
      case 'load-sample':
        guardEdit(loadSamplePlan);
        break;
      case 'reset-all':
        guardEdit(resetAll);
        break;
      case 'install':
        if (state.installEvent) {
          state.installEvent.prompt();
          state.installEvent = null;
          renderAll();
        }
        break;
      default:
        break;
    }
  }

  function deleteCurrentSheetItem() {
    if (!state.sheet || !state.sheet.id) return;
    var type = state.sheet.type;
    var id = state.sheet.id;
    if (type === 'kid') {
      var kid = kidById(id);
      var count = state.data.classes.filter(function (c) { return c.kidId === id; }).length;
      if (!window.confirm('“' + (kid ? kid.name : '') + '”를 삭제할까요?' + (count ? '\n학원 ' + count + '개와 할 일·숙제도 함께 삭제됩니다.' : ''))) return;
      deleteKid(id);
    } else if (type === 'class') {
      var cls = classById(id);
      if (!window.confirm('“' + (cls ? cls.name : '') + '” 일정을 삭제할까요?')) return;
      deleteClass(id);
    } else if (type === 'routine') {
      var r = routineById(id);
      if (!window.confirm('“' + (r ? r.title : '') + '” 할 일을 삭제할까요?')) return;
      deleteRoutine(id);
    } else {
      var hw = homeworkById(id);
      if (!window.confirm('“' + (hw ? hw.title : '') + '” 숙제를 삭제할까요?')) return;
      deleteHomework(id);
    }
    state.sheet = null;
    renderAll();
    toast('삭제했어요');
  }

  function handleSubmit(event) {
    var form = event.target;
    if (!form || !form.matches || !form.matches('form.sheet')) return;
    event.preventDefault();
    submitSheet(form);
  }

  function handleChange(event) {
    var t = event.target;
    if (!t || !t.getAttribute) return;
    var lockKey = t.getAttribute('data-locksetting');
    if (lockKey === 'autoLockMin') {
      setLockAutoMin(t.value);
      renderAll();
      toast('자동 잠금 시간을 바꿨어요');
      return;
    }
    var key = t.getAttribute('data-setting');
    if (key) {
      state.data.settings[key] = t.value;
      save();
      if (key === 'classLeadMin') { renderAll(); toast('알림 시점을 바꿨어요'); }
    }
    if (t.id === 'importFile') {
      importJSONFile(t.files && t.files[0]);
      t.value = '';
    }
  }

  function handleKeydown(event) {
    markActivity();
    var s = state.sheet;
    if (s && s.type === 'pin' && event.key) {
      if (/^[0-9]$/.test(event.key) && String(s.buf || '').length < 4) {
        s.buf = String(s.buf || '') + event.key;
        s.err = '';
        if (s.buf.length === 4) submitPin();
        else renderAll();
        return;
      }
      if (event.key === 'Backspace' && String(s.buf || '').length) {
        s.buf = String(s.buf).slice(0, -1);
        renderAll();
        return;
      }
    }
    if (event.key === 'Escape' && state.sheet) closeSheet();
  }

  /* ================= 서비스워커 / 설치 ================= */

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    var proto = window.location.protocol;
    if (proto !== 'https:' && proto !== 'http:') return;
    try {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
        state.swReg = reg;
      }).catch(function () { /* 오프라인 캐시 없이도 동작 */ });
      navigator.serviceWorker.addEventListener('message', function (ev) {
        if (ev.data && ev.data.type === 'open-homework') {
          state.view = 'homework';
          renderAll();
        }
      });
    } catch (e) { /* 무시 */ }
  }

  /* ================= 토스트 ================= */

  var toastTimer = null;
  function toast(message) {
    var root = document.getElementById('toastRoot');
    if (!root) return;
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    root.appendChild(el);
    setTimeout(function () { el.classList.add('show'); }, 10);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, 2400);
  }

  /* ================= 시작 ================= */

  var started = false;

  function init() {
    if (started) return;
    started = true;

    var stored = load();
    var firstRun = !stored;
    state.data = stored || blankData();
    state.dayKey = L.dateKey(new Date());
    state.kid = 'all';
    state.view = 'today';
    state.unlocked = false; /* 새로고침하면 관리자 잠금은 다시 걸린다 */
    state.lastActivity = Date.now();
    var hash = String(window.location.hash || '').replace('#', '');
    if (TABS.some(function (t) { return t.id === hash; })) state.view = hash;
    pruneChecks();
    if (firstRun) save();

    document.addEventListener('click', handleClick);
    document.addEventListener('submit', handleSubmit);
    document.addEventListener('change', handleChange);
    document.addEventListener('keydown', handleKeydown);
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      state.installEvent = e;
      renderAll();
    });
    window.addEventListener('appinstalled', function () {
      state.installEvent = null;
      toast('홈 화면에 추가됐어요');
      renderAll();
    });

    registerSW();
    renderAll();
    if (firstRun) toast('환영해요! 아래에서 아이를 추가해 계획표를 만들어 보세요');
    window.setInterval(tick, 20000);
    setTimeout(checkNotifications, 1200);
  }

  /* 테스트/디버그용 공개 API */
  window.AcademyApp = {
    state: state,
    init: init,
    load: load,
    save: save,
    normalizeData: normalizeData,
    blankData: blankData,
    buildSampleData: buildSampleData,
    upsertKid: upsertKid,
    deleteKid: deleteKid,
    upsertClass: upsertClass,
    deleteClass: deleteClass,
    upsertRoutine: upsertRoutine,
    deleteRoutine: deleteRoutine,
    toggleRoutine: toggleRoutine,
    upsertHomework: upsertHomework,
    deleteHomework: deleteHomework,
    toggleHomework: toggleHomework,
    openSheet: openSheet,
    closeSheet: closeSheet,
    submitSheet: submitSheet,
    openItemSheet: openItemSheet,
    guardEdit: guardEdit,
    lockInfo: lockInfo,
    hasPin: hasPin,
    lockRequired: lockRequired,
    setPin: setPin,
    clearPin: clearPin,
    verifyPin: verifyPin,
    lockNow: lockNow,
    unlockSession: unlockSession,
    autoLockCheck: autoLockCheck,
    setLockAutoMin: setLockAutoMin,
    openPinSheet: openPinSheet,
    submitPin: submitPin,
    sheetPin: sheetPin,
    renderLockBtn: renderLockBtn,
    lockCard: lockCard,
    lockedCard: lockedCard,
    resetFromLockScreen: resetFromLockScreen,
    markActivity: markActivity,
    renderMain: renderMain,
    renderKidBar: renderKidBar,
    renderTabBar: renderTabBar,
    renderSheet: renderSheet,
    checklistCard: checklistCard,
    todayRoutines: todayRoutines,
    routineStats: routineStats,
    isRoutineDone: isRoutineDone,
    openHomeworksDue: openHomeworksDue,
    todayOpenCount: todayOpenCount,
    loadSamplePlan: loadSamplePlan,
    resetAll: resetAll,
    checkNotifications: checkNotifications,
    headerLine: headerLine,
    liveText: liveText,
    whenText: whenText,
    exportICS: exportICS,
    toast: toast,
    handleClick: handleClick,
    handleChange: handleChange,
    handleKeydown: handleKeydown,
    handleSubmit: handleSubmit
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
