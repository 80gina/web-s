"""
수업 설계소 — AI 수업 설계 엔드포인트

주소:  POST /api/design

이 파일은 Vercel Serverless Function으로 동작합니다.
api/ 폴더에 두면 Vercel이 자동으로 위 주소를 만들어 줍니다.

역할:
  1) 브라우저가 보낸 수업 조건을 받는다
  2) 환경 변수에서 API 키를 꺼낸다 (코드에 키를 적지 않는다)
  3) Claude에게 수업 설계를 요청한다
  4) 결과를 JSON으로 돌려준다
"""

import json
import os
from http.server import BaseHTTPRequestHandler

import anthropic


# ---------- 설정 ----------

MODEL = "claude-sonnet-4-5"     # 사용할 AI 모델
MAX_TOKENS = 4000               # 응답 최대 길이
TIMEOUT_SECONDS = 25.0          # 이 시간을 넘기면 포기한다

# 필수 입력 항목 (브라우저에서도 검사하지만, 서버에서도 한 번 더 본다)
REQUIRED_FIELDS = ["headcount", "ageGroup", "duration", "level", "menu"]


# ---------- AI에게 줄 지시문 ----------

SYSTEM_PROMPT = """당신은 소규모 요리교실의 수업을 설계하는 전문가입니다.
강사 한 사람이 혼자 진행하는 수업을 전제로, 현실적으로 지킬 수 있는 계획을 만듭니다.

지켜야 할 원칙:
- 타임테이블의 소요 시간 합계는 반드시 주어진 수업 시간과 정확히 일치해야 합니다.
- 요리 경험이 "처음"이면 설명과 시범에 시간을 더 배분합니다.
- 재료는 주어진 인원수를 기준으로 계산합니다.
- 도구는 몇 명이 한 조를 이루는지까지 고려해 개수를 정합니다.
- 강사 멘트는 실제로 소리 내어 말할 수 있는 문장으로 씁니다.

반드시 아래 형식의 JSON만 출력합니다.
설명, 인사말, 코드블록 표시(```)를 절대 붙이지 마십시오.

{
  "title": "수업 제목",
  "summary": "이 수업의 성격을 한 문장으로",
  "timetable": [
    {
      "time": "00:00",
      "duration": 10,
      "activity": "활동 이름",
      "script": "강사가 실제로 할 말"
    }
  ],
  "materials": {
    "ingredients": [
      { "name": "재료명", "amount": "총 수량", "note": "1인 기준 등 메모" }
    ],
    "tools": [
      { "name": "도구명", "count": 4, "note": "2인 1조 기준 등 메모" }
    ]
  },
  "cautions": ["수업 중 특히 주의할 점"],
  "balance": "시간 배분이 적절한 이유를 한두 문장으로"
}"""


def build_user_prompt(data):
    """사용자가 입력한 조건을 AI가 읽을 문장으로 만듭니다."""

    lines = [
        "아래 조건으로 요리교실 수업을 설계해 주세요.",
        "",
        "- 수강생 인원: {}명".format(data["headcount"]),
        "- 연령대: {}".format(data["ageGroup"]),
        "- 수업 시간: {}분".format(data["duration"]),
        "- 요리 경험: {}".format(data["level"]),
        "- 만들 음식: {}".format(data["menu"]),
    ]

    notes = data.get("notes", "").strip()
    if notes:
        lines.append("- 강사 특이사항 요청: {}".format(notes))

    lines.append("")
    lines.append(
        "타임테이블의 duration 합계가 정확히 {}분이 되도록 맞춰 주세요.".format(
            data["duration"]
        )
    )

    return "\n".join(lines)


def extract_json(text):
    """AI 응답에서 JSON 부분만 뽑아냅니다.

    형식만 출력하라고 지시했지만, 앞뒤에 설명이 붙어 올 가능성이 있습니다.
    그대로 json.loads에 넣으면 실패하므로, 중괄호 구간을 찾아 잘라냅니다.
    """
    text = text.strip()

    # 코드블록 표시가 붙어 온 경우 제거
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]

    start = text.find("{")
    end = text.rfind("}")

    if start == -1 or end == -1:
        raise ValueError("응답에서 JSON을 찾지 못했습니다.")

    return json.loads(text[start:end + 1])


class handler(BaseHTTPRequestHandler):
    """Vercel은 handler라는 이름의 클래스를 찾아 실행합니다."""

    def _send(self, status_code, payload):
        """응답을 JSON 형태로 돌려주는 공통 함수입니다."""
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        """주소창으로 직접 들어온 경우 안내만 합니다."""
        self._send(405, {
            "error": "이 주소는 POST 방식으로만 사용할 수 있습니다."
        })

    def do_POST(self):
        # ---------- 1. 요청 본문 읽기 ----------
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            data = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._send(400, {"error": "요청 형식을 읽을 수 없습니다."})
            return

        # ---------- 2. 필수값 확인 ----------
        # 브라우저에서 이미 검사했지만, 주소를 직접 호출할 수도 있으므로
        # 서버에서도 한 번 더 봅니다.
        for field in REQUIRED_FIELDS:
            value = data.get(field)
            if value is None or str(value).strip() == "":
                self._send(400, {"error": "입력값이 부족합니다. 모든 필수 항목을 채워 주세요."})
                return

        # ---------- 3. API 키 꺼내기 ----------
        # 코드에 키를 적지 않고, 실행 환경에서 꺼내 씁니다.
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            self._send(500, {"error": "서버 설정이 완료되지 않았습니다. 잠시 후 다시 시도해 주세요."})
            return

        # ---------- 4. AI 호출 ----------
        try:
            client = anthropic.Anthropic(api_key=api_key, timeout=TIMEOUT_SECONDS)

            message = client.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=SYSTEM_PROMPT,
                messages=[
                    {"role": "user", "content": build_user_prompt(data)}
                ],
            )

            text = message.content[0].text

        except Exception as error:
            # 실제 오류 내용은 서버 기록(Vercel 로그)에만 남깁니다.
            # 사용자에게는 다음에 무엇을 하면 되는지만 알려 줍니다.
            print("AI 호출 실패:", repr(error))
            self._send(502, {"error": "설계에 실패했어요. 잠시 후 다시 시도해 주세요."})
            return

        # ---------- 5. 응답을 데이터로 바꾸기 ----------
        try:
            result = extract_json(text)
        except (ValueError, json.JSONDecodeError) as error:
            print("JSON 파싱 실패:", repr(error))
            print("원본 응답:", text[:500])
            self._send(502, {"error": "결과를 정리하지 못했어요. 다시 시도해 주세요."})
            return

        # ---------- 6. 돌려주기 ----------
        self._send(200, result)
