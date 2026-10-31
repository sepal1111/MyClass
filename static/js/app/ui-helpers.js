// MyClass 教師端：學生與組別頭像、台灣日期時間、主題
// 由 static/js/app.js 拆出（2026-10-31，原第 633–800 行），程式內容未變更。
// 所有 static/js/app.js 與 static/js/app/*.js 共用同一個全域範圍（一般 <script>，不是模組），載入順序見 static/index.html。



// --- UI Theme & Avatar Helpers ---
window.StudentPhotoCache = window.StudentPhotoCache || {
  missing: new Set(),
  loaded: new Set()
};

function getStudentAvatarImgHtml(student, sizeStyle = 'width: 100%; height: 100%; object-fit: cover;') {
  if (!student) {
    return `<img src="/static/avatars/boy.png" alt="avatar" style="${sizeStyle}">`;
  }
  let realStudent = student;
  if (AppState && AppState.students && (student.id || student.student_id)) {
    const sid = student.id || student.student_id;
    const found = AppState.students.find(s => s.id === sid);
    if (found) realStudent = found;
  }

  const gender = realStudent.gender || 'M';
  const isFemale = gender === 'female' || gender === 'F' || gender === '女';
  const fallbackGenderSrc = isFemale ? '/static/avatars/girl.png' : '/static/avatars/boy.png';

  // 1. 若後端已告知無照片，直接顯示預設男女頭像，完全避免發送 404 與 onerror 閃爍
  if (realStudent.has_photo === false || student.has_photo === false) {
    return `<img src="${fallbackGenderSrc}" alt="avatar" style="${sizeStyle}">`;
  }

  const code = realStudent.student_code || student.student_code;
  if (!code) {
    return `<img src="${fallbackGenderSrc}" alt="avatar" style="${sizeStyle}">`;
  }

  const codeStr = String(code).trim();
  // 2. 若快取中已知此學號在 bin/photo 中無照片，直接返回預設頭像
  if (window.StudentPhotoCache && window.StudentPhotoCache.missing.has(codeStr)) {
    return `<img src="${fallbackGenderSrc}" alt="avatar" style="${sizeStyle}">`;
  }

  const primarySrc = `/photo/${encodeURIComponent(codeStr)}.jpg`;
  const onerrorChain = `if(window.StudentPhotoCache)window.StudentPhotoCache.missing.add('${codeStr}');this.onerror=null;this.src='${fallbackGenderSrc}';`;
  const onloadChain = `if(window.StudentPhotoCache)window.StudentPhotoCache.loaded.add('${codeStr}');`;

  return `<img src="${primarySrc}" alt="avatar" style="${sizeStyle}" onload="${onloadChain}" onerror="${onerrorChain}">`;
}

const ANIMAL_ICONS_LIST = [
  'penguin', 'rabbit', 'hedgehog', 'polar_bear', 'formosan_black_bear',
  'elephant', 'guinea_pig', 'dog', 'squirrel', 'sika_deer',
  'hippo', 'raccoon', 'sea_otter', 'dolphin', 'turtle',
  'koala', 'panda', 'fox', 'lion', 'cheetah',
  'tiger', 'snake', 'owl', 'giraffe', 'sparrow'
];

const ANIMAL_KEYWORD_MAP = [
  { keys: ['企鵝', 'penguin'], icon: 'penguin' },
  { keys: ['兔', 'rabbit'], icon: 'rabbit' },
  { keys: ['刺蝟', 'hedgehog'], icon: 'hedgehog' },
  { keys: ['北極熊', 'polar_bear', 'polar bear', 'white bear'], icon: 'polar_bear' },
  { keys: ['黑熊', '台灣黑熊', 'bear'], icon: 'formosan_black_bear' },
  { keys: ['象', '大象', 'elephant'], icon: 'elephant' },
  { keys: ['天竺鼠', 'guinea'], icon: 'guinea_pig' },
  { keys: ['狗', '犬', 'dog', 'puppy'], icon: 'dog' },
  { keys: ['松鼠', 'squirrel'], icon: 'squirrel' },
  { keys: ['鹿', '梅花鹿', 'deer'], icon: 'sika_deer' },
  { keys: ['河馬', 'hippo'], icon: 'hippo' },
  { keys: ['浣熊', 'raccoon'], icon: 'raccoon' },
  { keys: ['海獺', '水獺', 'otter'], icon: 'sea_otter' },
  { keys: ['海豚', 'dolphin'], icon: 'dolphin' },
  { keys: ['龜', '烏龜', 'turtle', 'tortoise'], icon: 'turtle' },
  { keys: ['無尾熊', 'koala'], icon: 'koala' },
  { keys: ['熊貓', '貓熊', 'panda'], icon: 'panda' },
  { keys: ['狐', '狐狸', 'fox'], icon: 'fox' },
  { keys: ['獅', '獅子', 'lion'], icon: 'lion' },
  { keys: ['獵豹', '花豹', '豹', 'cheetah', 'leopard'], icon: 'cheetah' },
  { keys: ['虎', '老虎', 'tiger'], icon: 'tiger' },
  { keys: ['蛇', 'snake'], icon: 'snake' },
  { keys: ['貓頭鷹', 'owl'], icon: 'owl' },
  { keys: ['長頸鹿', 'giraffe'], icon: 'giraffe' },
  { keys: ['麻雀', '鳥', 'sparrow', 'bird'], icon: 'sparrow' }
];

function getGroupAvatarSrc(group, fallbackIndex) {
  // 0. If group object has explicit custom icon_url
  if (group && typeof group === 'object' && (group.icon_url || group.group_icon_url)) {
    return group.icon_url || group.group_icon_url;
  }

  let name = '';
  if (typeof group === 'string') {
    name = group;
    // Look up in AppState.groups if available
    if (typeof AppState !== 'undefined' && AppState.groups) {
      const found = AppState.groups.find(g => g.group_name === name);
      if (found && (found.icon_url || found.group_icon_url)) {
        return found.icon_url || found.group_icon_url;
      }
    }
  } else if (group && typeof group === 'object') {
    name = group.group_name || group.name || '';
  }

  const nameLower = name.toLowerCase();

  // 1. Keyword match with animal names
  for (const item of ANIMAL_KEYWORD_MAP) {
    if (item.keys.some(k => nameLower.includes(k.toLowerCase()))) {
      return `/static/pic/animals/${item.icon}.png`;
    }
  }

  // 2. Fallback index or order_index or id mapped to 25 animal icons
  let idx = 0;
  if (typeof fallbackIndex === 'number' && fallbackIndex >= 0) {
    idx = fallbackIndex;
  } else if (group && typeof group === 'object') {
    if (typeof group.order_index === 'number' && group.order_index > 0) {
      idx = group.order_index - 1;
    } else if (typeof group.id === 'number' && group.id > 0) {
      idx = group.id - 1;
    }
  } else {
    const digitMatch = name.match(/\d+/);
    if (digitMatch) {
      const num = parseInt(digitMatch[0], 10);
      if (!isNaN(num) && num > 0) idx = num - 1;
    }
  }

  const animalName = ANIMAL_ICONS_LIST[idx % ANIMAL_ICONS_LIST.length];
  return `/static/pic/animals/${animalName}.png`;
}

function getGroupAvatarImgHtml(group, sizeStyle = 'width: 100%; height: 100%; object-fit: contain;', fallbackIndex) {
  const src = getGroupAvatarSrc(group, fallbackIndex);
  const name = typeof group === 'string' ? group : (group?.group_name || group?.name || '小組');
  return `<img src="${src}" alt="${name}" style="${sizeStyle}">`;
}
window.getGroupAvatarSrc = getGroupAvatarSrc;
window.getGroupAvatarImgHtml = getGroupAvatarImgHtml;

// --- Taiwan (Asia/Taipei, UTC+8) Date/Time Helpers ---
function getTaiwanTodayDateStr() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(new Date());
}

function getTaiwanNowDateTimeStr() {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  return formatter.format(new Date());
}

function initTheme() {
  document.documentElement.setAttribute('data-theme', 'light');
}
