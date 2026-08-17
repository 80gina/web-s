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
