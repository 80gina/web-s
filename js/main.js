/* ============================================
   수업 설계소 — 네비게이션 동작

   화면의 "움직임"을 담당합니다.
   - 모바일 햄버거 메뉴 열고 닫기
   - 지금 보고 있는 섹션을 메뉴에 표시
   ============================================ */

/* ---------- 1. 화면에서 다룰 요소들을 미리 찾아 둡니다 ---------- */
/* document.getElementById("navMenu")
   = "문서에서 id가 navMenu인 것을 찾아와"
   찾아온 것을 상자(변수)에 담아두면 아래에서 계속 쓸 수 있습니다. */

const menuToggle = document.getElementById("menuToggle");  // 햄버거 버튼
const navMenu    = document.getElementById("navMenu");     // 메뉴 목록
const navLinks   = document.querySelectorAll("#navMenu a"); // 메뉴 안의 링크 전부
const sections   = document.querySelectorAll("main section"); // 본문의 섹션 전부


/* ---------- 2. 햄버거 버튼을 누르면 메뉴를 열고 닫습니다 ---------- */
/* addEventListener("click", ...)
   = "이것이 클릭되면, 뒤에 적은 일을 해줘" */

menuToggle.addEventListener("click", function () {
  // classList.toggle("open")
  // = open이라는 이름표가 없으면 붙이고, 있으면 뗀다
  // CSS에 #navMenu.open { display: flex; } 가 있어서
  // 이름표가 붙는 순간 메뉴가 화면에 나타납니다.
  navMenu.classList.toggle("open");

  const isOpen = navMenu.classList.contains("open");

  // 버튼 모양도 바꿉니다 (열림: X / 닫힘: 햄버거)
  menuToggle.textContent = isOpen ? "✕" : "☰";

  // 화면을 못 보는 사용자를 위한 안내 (스크린리더가 읽습니다)
  menuToggle.setAttribute("aria-label", isOpen ? "메뉴 닫기" : "메뉴 열기");
});


/* ---------- 3. 메뉴를 고르면 메뉴를 닫습니다 ---------- */
/* 모바일에서 메뉴를 눌러 이동했는데 메뉴가 계속 펼쳐져 있으면
   내용이 가려집니다. 그래서 고른 뒤에는 닫아 줍니다. */

navLinks.forEach(function (link) {
  link.addEventListener("click", function () {
    navMenu.classList.remove("open");
    menuToggle.textContent = "☰";
    menuToggle.setAttribute("aria-label", "메뉴 열기");
  });
});


/* ---------- 4. 메뉴 바깥을 누르면 닫습니다 ---------- */
/* 메뉴를 열어 놓고 다른 곳을 눌렀을 때 닫히지 않으면
   사용자는 "닫는 방법"을 따로 찾아야 합니다. */

document.addEventListener("click", function (event) {
  const clickedInsideMenu   = navMenu.contains(event.target);
  const clickedToggleButton = menuToggle.contains(event.target);

  if (!clickedInsideMenu && !clickedToggleButton) {
    navMenu.classList.remove("open");
    menuToggle.textContent = "☰";
  }
});


/* ---------- 5. 지금 보고 있는 섹션을 메뉴에 표시합니다 ---------- */
/* IntersectionObserver
   = "이 요소가 화면에 들어왔는지 지켜봐 줘"라고 브라우저에 부탁하는 기능.
   스크롤할 때마다 위치를 계산하는 방식보다 훨씬 가볍습니다. */

const observer = new IntersectionObserver(
  function (entries) {
    entries.forEach(function (entry) {
      // isIntersecting = 이 섹션이 지금 화면에 보이고 있는가
      if (!entry.isIntersecting) return;

      const currentId = entry.target.id;

      navLinks.forEach(function (link) {
        // href가 "#design" 형태이므로 앞의 # 을 떼고 비교합니다
        const linkTarget = link.getAttribute("href").replace("#", "");
        link.classList.toggle("active", linkTarget === currentId);
      });
    });
  },
  {
    // 화면 위아래 가장자리를 제외하고, 가운데쯤 왔을 때 반응하도록 합니다
    rootMargin: "-45% 0px -45% 0px"
  }
);

sections.forEach(function (section) {
  observer.observe(section);
});


/* ============================================
   6. 수업 설계 폼 — 빈 입력 검사

   기획서 6절 "실패 처리 ① 빈 입력"에 해당합니다.
   서버로 보내기 전에 화면에서 먼저 걸러냅니다.
   ============================================ */

const designForm = document.getElementById("designForm");
const formError  = document.getElementById("formError");
const notes      = document.getElementById("notes");
const notesCount = document.getElementById("notesCount");

/* 검사할 항목과, 비었을 때 보여줄 문구를 한 곳에 모아 둡니다.
   나중에 항목이 늘어나도 이 목록만 고치면 됩니다. */
const requiredFields = [
  { id: "headcount", message: "수강생 인원을 입력해 주세요." },
  { id: "ageGroup",  message: "연령대를 선택해 주세요." },
  { id: "duration",  message: "수업 시간을 선택해 주세요." },
  { id: "level",     message: "요리 경험 수준을 선택해 주세요." },
  { id: "menu",      message: "만들 음식을 입력해 주세요." }
];

/* 오류 안내를 화면에 띄웁니다 */
function showError(message, targetElement) {
  formError.textContent = message;
  formError.classList.add("show");

  if (targetElement) {
    targetElement.classList.add("invalid");
    targetElement.focus();   // 문제가 된 칸으로 커서를 옮겨 줍니다
  }
}

/* 오류 표시를 모두 지웁니다 */
function clearError() {
  formError.classList.remove("show");
  formError.textContent = "";

  document.querySelectorAll(".invalid").forEach(function (el) {
    el.classList.remove("invalid");
  });
}

/* 입력값을 검사합니다.
   문제가 없으면 값이 담긴 객체를, 있으면 null을 돌려줍니다. */
function validateDesignForm() {
  clearError();

  for (const field of requiredFields) {
    const el = document.getElementById(field.id);

    // trim() = 앞뒤 공백을 없앤다.
    // 공백만 입력한 경우도 "비어 있다"로 봐야 하기 때문입니다.
    if (el.value.trim() === "") {
      showError(field.message, el);
      return null;
    }
  }

  // 인원은 숫자라서 범위도 함께 봅니다
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

/* 제출 버튼을 눌렀을 때 */
designForm.addEventListener("submit", function (event) {
  // preventDefault()
  // = 브라우저의 기본 동작(페이지 새로고침)을 막습니다.
  // 이걸 안 하면 화면이 통째로 다시 열려서 입력값이 사라집니다.
  event.preventDefault();

  const data = validateDesignForm();
  if (data === null) return;   // 검사에서 걸리면 여기서 멈춥니다

  // 검사를 통과한 값은 개발자 도구 콘솔에서 확인할 수 있습니다.
  // AI 호출로 연결하는 작업은 구간 D에서 이어집니다.
  console.log("입력값 검사 통과:", data);

  document.getElementById("result").innerHTML =
    "<p>입력값이 확인되었습니다. AI 연동은 다음 단계에서 연결합니다.</p>" +
    "<p>" + data.menu + " · " + data.headcount + "명 · " +
    data.duration + "분 · " + data.ageGroup + " · " + data.level + "</p>";
});

/* 특이사항 글자 수를 세어 보여 줍니다 */
notes.addEventListener("input", function () {
  notesCount.textContent = notes.value.length;
});


/* ============================================
   7. 문의 폼 — 빈 입력 검사
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

  // 이메일 형식을 간단히 확인합니다 (@ 와 . 가 있는지)
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
