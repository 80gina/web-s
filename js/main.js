/* ============================================
   수업 설계소 — 화면 동작 전체

   1) 네비게이션 (햄버거 메뉴, 현재 섹션 표시)
   2) 수업 설계 폼 검사 → AI 호출 → 결과 표시
   3) 문의 폼 검사
   ============================================ */


/* ============================================
   1. 화면에서 다룰 요소들을 미리 찾아 둡니다
   ============================================ */

const menuToggle = document.getElementById("menuToggle");
const navMenu    = document.getElementById("navMenu");
const navLinks   = document.querySelectorAll("#navMenu a");
const sections   = document.querySelectorAll("main section");

const designForm = document.getElementById("designForm");
const designBtn  = document.getElementById("designBtn");
const formError  = document.getElementById("formError");
const resultBox  = document.getElementById("result");
const notes      = document.getElementById("notes");
const notesCount = document.getElementById("notesCount");
const savedList  = document.getElementById("savedList");


/* ============================================
   2. 햄버거 메뉴 열고 닫기
   ============================================ */

menuToggle.addEventListener("click", function () {
  navMenu.classList.toggle("open");

  const isOpen = navMenu.classList.contains("open");
  menuToggle.textContent = isOpen ? "✕" : "☰";
  menuToggle.setAttribute("aria-label", isOpen ? "메뉴 닫기" : "메뉴 열기");
});

/* 메뉴를 고르면 닫습니다 (모바일에서 내용이 가려지지 않도록) */
navLinks.forEach(function (link) {
  link.addEventListener("click", function () {
    navMenu.classList.remove("open");
    menuToggle.textContent = "☰";
  });
});

/* 메뉴 바깥을 누르면 닫습니다 */
document.addEventListener("click", function (event) {
  const insideMenu  = navMenu.contains(event.target);
  const onToggleBtn = menuToggle.contains(event.target);

  if (!insideMenu && !onToggleBtn) {
    navMenu.classList.remove("open");
    menuToggle.textContent = "☰";
  }
});


/* ============================================
   3. 지금 보고 있는 섹션을 메뉴에 표시
   ============================================ */

const observer = new IntersectionObserver(
  function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;

      const currentId = entry.target.id;
      navLinks.forEach(function (link) {
        const target = link.getAttribute("href").replace("#", "");
        link.classList.toggle("active", target === currentId);
      });
    });
  },
  { rootMargin: "-45% 0px -45% 0px" }
);

sections.forEach(function (section) {
  observer.observe(section);
});


/* ============================================
   4. 입력값 검사 — 실패 처리 ① 빈 입력

   서버로 보내기 전에 화면에서 먼저 걸러냅니다.
   - 즉시 알려줄 수 있고
   - 빈 요청에 AI 호출 비용을 쓰지 않습니다
   ============================================ */

const requiredFields = [
  { id: "headcount", message: "수강생 인원을 입력해 주세요." },
  { id: "ageGroup",  message: "연령대를 선택해 주세요." },
  { id: "duration",  message: "수업 시간을 선택해 주세요." },
  { id: "level",     message: "요리 경험 수준을 선택해 주세요." },
  { id: "menu",      message: "만들 음식을 입력해 주세요." }
];

function showError(message, targetElement) {
  formError.textContent = message;
  formError.classList.add("show");

  if (targetElement) {
    targetElement.classList.add("invalid");
    targetElement.focus();
  }
}

function clearError() {
  formError.classList.remove("show");
  formError.textContent = "";

  document.querySelectorAll("#designForm .invalid").forEach(function (el) {
    el.classList.remove("invalid");
  });
}

function validateDesignForm() {
  clearError();

  for (const field of requiredFields) {
    const el = document.getElementById(field.id);

    // trim() = 앞뒤 공백 제거. 공백만 넣은 경우도 "비었다"로 봅니다.
    if (el.value.trim() === "") {
      showError(field.message, el);
      return null;
    }
  }

  const headcountEl = document.getElementById("headcount");
  const headcount = Number(headcountEl.value);

  if (headcount < 1 || headcount > 30) {
    showError("수강생 인원은 1명에서 30명 사이로 입력해 주세요.", headcountEl);
    return null;
  }

  return {
    headcount: headcount,
    ageGroup:  document.getElementById("ageGroup").value,
    duration:  Number(document.getElementById("duration").value),
    level:     document.getElementById("level").value,
    menu:      document.getElementById("menu").value.trim(),
    notes:     notes.value.trim()
  };
}


/* ============================================
   5. 화면에 글자를 안전하게 넣기 위한 함수

   AI 응답이나 사용자 입력에 < > 같은 기호가 섞여 있으면
   화면 구조가 깨질 수 있습니다. 기호를 글자로 바꿔 줍니다.
   ============================================ */

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


/* ============================================
   6. AI 호출 — 실패 처리 ②③ 포함

   ② API 오류(4xx/5xx) → 안내 + 다시 시도 버튼
   ③ 지연/타임아웃      → 20초 안내, 30초 중단
   ============================================ */

const DELAY_NOTICE_MS = 20000;   // 20초: 기다려 달라고 안내
const TIMEOUT_MS      = 30000;   // 30초: 포기

let lastRequestData = null;      // 다시 시도 버튼이 쓸 값

async function requestDesign(data) {
  lastRequestData = data;

  // 버튼을 잠가서 연속 클릭을 막습니다 (중복 호출 = 중복 요금)
  designBtn.disabled = true;
  designBtn.textContent = "설계하는 중…";

  resultBox.innerHTML =
    '<p class="loading">AI가 수업을 설계하고 있습니다. 10~20초 정도 걸립니다.</p>';

  // AbortController = 요청을 중간에 취소할 수 있게 해주는 장치
  const controller = new AbortController();

  // 20초가 지나면 "기다려 주세요" 안내를 덧붙입니다
  const delayNotice = setTimeout(function () {
    const loading = resultBox.querySelector(".loading");
    if (loading) {
      loading.textContent = "시간이 조금 걸리고 있어요. 조금만 더 기다려 주세요.";
    }
  }, DELAY_NOTICE_MS);

  // 30초가 지나면 요청 자체를 취소합니다
  const hardTimeout = setTimeout(function () {
    controller.abort();
  }, TIMEOUT_MS);

  try {
    const response = await fetch("/api/design", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: controller.signal
    });

    // response.ok = 응답 상태가 200번대인가
    if (!response.ok) {
      let message = "설계에 실패했어요. 잠시 후 다시 시도해 주세요.";

      // 서버가 보낸 안내 문구가 있으면 그것을 씁니다
      try {
        const errorBody = await response.json();
        if (errorBody.error) message = errorBody.error;
      } catch (ignore) {
        // 응답이 JSON이 아닌 경우 기본 문구를 그대로 씁니다
      }

      console.error("서버 응답 오류:", response.status);
      showResultError(message);
      return;
    }

    const result = await response.json();
    renderResult(result);

  } catch (error) {
    // 취소된 경우와 그 밖의 경우를 나눠 안내합니다
    if (error.name === "AbortError") {
      console.error("요청 시간 초과");
      showResultError("응답이 너무 늦어 중단했습니다. 잠시 후 다시 시도해 주세요.");
    } else {
      console.error("요청 실패:", error);
      showResultError("연결에 문제가 있었어요. 인터넷 상태를 확인하고 다시 시도해 주세요.");
    }

  } finally {
    // 성공하든 실패하든 반드시 실행되는 자리입니다.
    // 여기서 정리하지 않으면 버튼이 잠긴 채로 남습니다.
    clearTimeout(delayNotice);
    clearTimeout(hardTimeout);
    designBtn.disabled = false;
    designBtn.textContent = "수업 설계하기";
  }
}


/* ============================================
   7. 결과를 화면에 그리기

   AI는 문장이 아니라 데이터(JSON)를 보내 줍니다.
   그 데이터를 어떤 모양으로 보여줄지는 이 함수가 정합니다.
   ============================================ */

function renderResult(data) {
  // 받은 데이터가 예상한 모양인지 먼저 확인합니다
  if (!data || !Array.isArray(data.timetable) || data.timetable.length === 0) {
    console.error("예상과 다른 응답:", data);
    showResultError("결과를 정리하지 못했어요. 다시 시도해 주세요.");
    return;
  }

  let html = "";

  html += '<h3 class="result-title">' + escapeHtml(data.title) + "</h3>";

  if (data.summary) {
    html += '<p class="result-summary">' + escapeHtml(data.summary) + "</p>";
  }

  /* ---- 진행표 ---- */
  html += "<h4>진행표</h4>";
  html += '<div class="table-wrap"><table class="timetable">';
  html += "<thead><tr><th>시각</th><th>소요</th><th>활동</th><th>강사 멘트</th></tr></thead><tbody>";

  data.timetable.forEach(function (row) {
    html += "<tr>";
    html += "<td>" + escapeHtml(row.time) + "</td>";
    html += "<td>" + escapeHtml(row.duration) + "분</td>";
    html += "<td>" + escapeHtml(row.activity) + "</td>";
    html += '<td class="script">' + escapeHtml(row.script) + "</td>";
    html += "</tr>";
  });

  html += "</tbody></table></div>";

  /* ---- 준비물 ---- */
  const materials = data.materials || {};

  if (Array.isArray(materials.ingredients) && materials.ingredients.length > 0) {
    html += "<h4>재료</h4><ul class='material-list'>";
    materials.ingredients.forEach(function (item) {
      html += "<li><strong>" + escapeHtml(item.name) + "</strong> " +
              escapeHtml(item.amount);
      if (item.note) html += ' <span class="note">' + escapeHtml(item.note) + "</span>";
      html += "</li>";
    });
    html += "</ul>";
  }

  if (Array.isArray(materials.tools) && materials.tools.length > 0) {
    html += "<h4>도구</h4><ul class='material-list'>";
    materials.tools.forEach(function (item) {
      html += "<li><strong>" + escapeHtml(item.name) + "</strong> " +
              escapeHtml(item.count) + "개";
      if (item.note) html += ' <span class="note">' + escapeHtml(item.note) + "</span>";
      html += "</li>";
    });
    html += "</ul>";
  }

  /* ---- 주의사항 ---- */
  if (Array.isArray(data.cautions) && data.cautions.length > 0) {
    html += "<h4>주의할 점</h4><ul class='caution-list'>";
    data.cautions.forEach(function (text) {
      html += "<li>" + escapeHtml(text) + "</li>";
    });
    html += "</ul>";
  }

  /* ---- 시간 배분 코멘트 ---- */
  if (data.balance) {
    html += '<p class="balance">' + escapeHtml(data.balance) + "</p>";
  }

  /* ---- 저장 버튼 ---- */
  html += '<div class="result-actions">';
  html += '<button type="button" id="saveBtn" class="btn-outline">보관함에 저장</button>';
  html += "</div>";

  resultBox.innerHTML = html;

  // 방금 그린 결과를 저장할 수 있도록 연결합니다.
  // innerHTML로 새로 만든 버튼이라 매번 다시 연결해야 합니다.
  document.getElementById("saveBtn").addEventListener("click", function () {
    saveDesign(data);
  });
}


/* ============================================
   8. 오류 안내 + 다시 시도 버튼
   ============================================ */

function showResultError(message) {
  resultBox.innerHTML =
    '<div class="result-error">' +
      "<p>" + escapeHtml(message) + "</p>" +
      '<button type="button" id="retryBtn" class="btn-retry">다시 시도</button>' +
    "</div>";

  document.getElementById("retryBtn").addEventListener("click", function () {
    if (lastRequestData) requestDesign(lastRequestData);
  });
}


/* ============================================
   9. 제출 버튼을 눌렀을 때
   ============================================ */

designForm.addEventListener("submit", function (event) {
  // 브라우저 기본 동작(페이지 새로고침)을 막습니다.
  // 이걸 안 하면 화면이 다시 열리면서 입력값이 사라집니다.
  event.preventDefault();

  const data = validateDesignForm();
  if (data === null) return;    // 빈 입력이면 여기서 멈춤

  requestDesign(data);
});

/* 특이사항 글자 수 표시 */
notes.addEventListener("input", function () {
  notesCount.textContent = notes.value.length;
});


/* ============================================
   10. 문의 폼 — 빈 입력 검사
   ============================================ */

const contactForm  = document.getElementById("contactForm");
const contactError = document.getElementById("contactError");
const contactDone  = document.getElementById("contactDone");

contactForm.addEventListener("submit", function (event) {
  event.preventDefault();

  contactError.classList.remove("show");
  contactDone.classList.remove("show");
  document.querySelectorAll("#contactForm .invalid").forEach(function (el) {
    el.classList.remove("invalid");
  });

  const checks = [
    { id: "contactName",    message: "이름을 입력해 주세요." },
    { id: "contactEmail",   message: "이메일을 입력해 주세요." },
    { id: "contactMessage", message: "문의 내용을 입력해 주세요." }
  ];

  for (const check of checks) {
    const el = document.getElementById(check.id);
    if (el.value.trim() === "") {
      contactError.textContent = check.message;
      contactError.classList.add("show");
      el.classList.add("invalid");
      el.focus();
      return;
    }
  }

  const emailEl = document.getElementById("contactEmail");
  if (!emailEl.value.includes("@") || !emailEl.value.includes(".")) {
    contactError.textContent = "이메일 형식을 확인해 주세요. 예: name@example.com";
    contactError.classList.add("show");
    emailEl.classList.add("invalid");
    emailEl.focus();
    return;
  }

  contactDone.textContent = "보내주셔서 감사합니다. 확인 후 답변드리겠습니다.";
  contactDone.classList.add("show");
  contactForm.reset();
});


/* ============================================
   11. 내 보관함 — 브라우저에 결과 저장하기

   서버에 저장하지 않고 브라우저 저장소를 씁니다.
   - 로그인 없이 바로 쓸 수 있고
   - 개인정보를 서버에 보관하는 책임이 생기지 않습니다
   대신 다른 기기에서는 보이지 않습니다. (운영 가이드에 명시)
   ============================================ */

const STORAGE_KEY = "수업설계소.보관함";
const MAX_SAVED = 20;          // 너무 쌓이면 저장 공간이 가득 찹니다

/* 저장된 목록을 읽어옵니다.
   저장소가 비어 있거나 내용이 깨졌을 때도 빈 배열을 돌려줍니다. */
function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (error) {
    console.error("보관함을 읽지 못했습니다:", error);
    return [];
  }
}

/* 목록을 저장소에 씁니다. */
function writeSaved(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch (error) {
    // 저장 공간이 가득 찬 경우 등
    console.error("보관함에 쓰지 못했습니다:", error);
    return false;
  }
}

/* 날짜를 "8월 20일 오전 3:58" 형태로 만듭니다. */
function formatDate(isoText) {
  const date = new Date(isoText);
  if (isNaN(date)) return "";

  return date.toLocaleString("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

/* 결과를 보관함에 저장합니다. */
function saveDesign(result) {
  const list = loadSaved();

  const item = {
    id: String(Date.now()),        // 저장한 시각을 고유 번호로 씁니다
    savedAt: new Date().toISOString(),
    input: lastRequestData,        // 어떤 조건으로 만들었는지도 함께 남깁니다
    result: result
  };

  list.unshift(item);              // 최신 것이 위로 오게

  if (list.length > MAX_SAVED) {
    list.length = MAX_SAVED;       // 오래된 것부터 잘라냅니다
  }

  if (!writeSaved(list)) {
    alert("저장 공간이 부족해 보관하지 못했습니다. 보관함에서 오래된 항목을 지워 주세요.");
    return;
  }

  renderSavedList();

  const button = document.getElementById("saveBtn");
  if (button) {
    button.textContent = "보관함에 저장됨";
    button.disabled = true;
  }
}

/* 보관함 목록을 화면에 그립니다. */
function renderSavedList() {
  const list = loadSaved();

  if (list.length === 0) {
    savedList.innerHTML = "<p>저장된 설계가 없습니다. 수업을 설계한 뒤 저장해 보세요.</p>";
    return;
  }

  let html = '<ul class="saved-items">';

  list.forEach(function (item) {
    const input = item.input || {};

    html += '<li class="saved-item">';
    html += '<div class="saved-info">';
    html += '<p class="saved-title">' + escapeHtml(item.result.title) + "</p>";
    html += '<p class="saved-meta">' +
            escapeHtml(input.headcount) + "명 · " +
            escapeHtml(input.duration) + "분 · " +
            escapeHtml(input.ageGroup) + " · " +
            escapeHtml(input.level) +
            "</p>";
    html += '<p class="saved-date">' + escapeHtml(formatDate(item.savedAt)) + "</p>";
    html += "</div>";

    html += '<div class="saved-buttons">';
    html += '<button type="button" class="btn-small" data-open="' + escapeHtml(item.id) + '">보기</button>';
    html += '<button type="button" class="btn-small btn-danger" data-remove="' + escapeHtml(item.id) + '">삭제</button>';
    html += "</div>";
    html += "</li>";
  });

  html += "</ul>";
  savedList.innerHTML = html;
}

/* 보관함의 버튼 클릭을 한 곳에서 처리합니다.

   목록은 저장할 때마다 다시 그려집니다.
   버튼마다 따로 연결하면 다시 그릴 때마다 전부 다시 연결해야 하므로,
   부모(savedList)에 한 번만 연결하고 어떤 버튼이 눌렸는지 확인하는 방식을 씁니다. */
savedList.addEventListener("click", function (event) {
  const openId = event.target.getAttribute("data-open");
  const removeId = event.target.getAttribute("data-remove");

  if (openId) {
    const item = loadSaved().find(function (row) { return row.id === openId; });
    if (!item) return;

    lastRequestData = item.input;
    renderResult(item.result);

    // 결과가 그려진 수업 설계 섹션으로 이동합니다
    document.getElementById("design").scrollIntoView({ behavior: "smooth" });
    return;
  }

  if (removeId) {
    const list = loadSaved().filter(function (row) { return row.id !== removeId; });
    writeSaved(list);
    renderSavedList();
  }
});

/* 페이지가 열릴 때 보관함을 한 번 그립니다. */
renderSavedList();
