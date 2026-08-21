"""
수업 설계소 — AI 수업 설계 엔드포인트

주소:  POST /api/design

이 파일은 Vercel Serverless Function으로 동작합니다.
api/ 폴더에 두면 Vercel이 자동으로 위 주소를 만들어 줍니다.

역할:
  1) 브라우저가 보낸 수업 조건을 받는다
  2) 환경 변수에서 API 키를 꺼낸다 (코드에 키를 적지 않는다)
  3) 지금 쓸 수 있는 모델 이름을 알아낸다
  4) Gemini에게 수업 설계를 요청한다
  5) 결과를 JSON으로 돌려준다
"""

import hashlib
import json
import os
import time
from http.server import BaseHTTPRequestHandler

import requests


# ---------- 설정 ----------

BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

MAX_TOKENS = 4000               # 응답 최대 길이
TIMEOUT_SECONDS = 25            # 이 시간을 넘기면 포기한다

# 필수 입력 항목 (브라우저에서도 검사하지만, 서버에서도 한 번 더 본다)
REQUIRED_FIELDS = ["headcount", "ageGroup", "duration", "level", "menu"]

# ---------- 호출 제한 설정 ----------
# AI 호출은 건당 요금이 발생하고 하루 쿼터도 정해져 있습니다.
# 배포 주소는 공개되어 있으므로, 누군가 반복 호출하면 쿼터가 순식간에 소진됩니다.
RATE_LIMIT_WINDOW = 60     # 이 시간(초) 안에
RATE_LIMIT_MAX = 10        # 최대 이 횟수까지만 허용

CACHE_MAX = 20             # 결과를 최대 몇 개까지 기억할지


# ---------- 함수가 살아 있는 동안 유지되는 값들 ----------
# 서버리스 함수는 요청이 끝나도 잠시 대기 상태로 남아 있다가
# 다음 요청이 오면 그대로 재사용됩니다. 그 사이에는 아래 값들이 유지됩니다.
#
# 다만 오래 요청이 없으면 함수가 종료되고 값도 사라집니다.
# 즉 이 방식은 "확실한 보관"이 아니라 "있으면 이득"인 성격입니다.
# 확실한 제한이 필요하면 외부 저장소가 있어야 하지만,
# 이 서비스 규모에서는 과한 구성이라고 판단했습니다.

_cached_model = None       # 한 번 알아낸 모델 이름
_result_cache = {}         # 입력 → 결과
_cache_keys = []           # 오래된 것부터 지우기 위한 순서 기록
_call_times = []           # 최근 호출 시각들


def make_cache_key(data):
    """같은 조건인지 판단할 열쇠를 만듭니다.

    입력값을 하나의 문자열로 이어 붙인 뒤 짧은 지문으로 바꿉니다.
    앞뒤 공백과 대소문자 차이는 같은 것으로 봅니다.
    """
    parts = [
        str(data.get("headcount", "")).strip(),
        str(data.get("ageGroup", "")).strip(),
        str(data.get("duration", "")).strip(),
        str(data.get("level", "")).strip(),
        str(data.get("menu", "")).strip().lower(),
        str(data.get("notes", "")).strip().lower(),
    ]
    joined = "|".join(parts)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


def is_rate_limited():
    """최근 호출이 너무 잦은지 확인합니다."""
    now = time.time()

    # 시간이 지난 기록은 목록에서 지웁니다
    while _call_times and now - _call_times[0] > RATE_LIMIT_WINDOW:
        _call_times.pop(0)

    if len(_call_times) >= RATE_LIMIT_MAX:
        return True

    _call_times.append(now)
    return False


def remember_result(key, result):
    """결과를 기억해 둡니다. 너무 많이 쌓이면 오래된 것부터 지웁니다."""
    _result_cache[key] = result
    _cache_keys.append(key)

    while len(_cache_keys) > CACHE_MAX:
        oldest = _cache_keys.pop(0)
        _result_cache.pop(oldest, None)


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
설명, 인사말, 코드블록 표시를 절대 붙이지 마십시오.

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

    notes = str(data.get("notes", "")).strip()
    if notes:
        lines.append("- 강사 특이사항 요청: {}".format(notes))

    lines.append("")
    lines.append(
        "타임테이블의 duration 합계가 정확히 {}분이 되도록 맞춰 주세요.".format(
            data["duration"]
        )
    )

    return "\n".join(lines)


def pick_model(api_key):
    """지금 이 키로 쓸 수 있는 모델 이름을 알아냅니다.

    모델 이름은 계정마다 다르고 시간이 지나면 바뀝니다.
    코드에 이름을 박아두면 그 이름이 사라지는 순간 서비스가 멈추므로,
    구글에게 "쓸 수 있는 목록"을 물어본 뒤 그 안에서 고릅니다.
    """
    global _cached_model

    if _cached_model:
        return _cached_model

    response = requests.get(
        BASE_URL + "/models",
        headers={"x-goog-api-key": api_key},
        timeout=10
    )

    if response.status_code != 200:
        print("모델 목록 조회 실패:", response.status_code, response.text[:400])
        return None

    # 글을 생성할 수 있는 모델만 남깁니다.
    # (이미지 전용, 임베딩 전용 모델은 여기서 걸러집니다)
    usable = []
    for item in response.json().get("models", []):
        methods = item.get("supportedGenerationMethods", [])
        if "generateContent" not in methods:
            continue
        usable.append(item["name"].split("/")[-1])

    print("사용 가능한 모델:", usable)

    if not usable:
        return None

    # 고르는 기준: 빠르고 저렴한 flash 계열을 먼저, 없으면 아무거나.
    # 미리보기(preview)나 실험(exp) 버전은 불안정할 수 있어 뒤로 미룹니다.
    def score(name):
        point = 0
        if "flash" in name:
            point -= 10
        if "lite" in name:
            point -= 2
        if "preview" in name or "exp" in name:
            point += 20
        if "thinking" in name or "image" in name or "tts" in name:
            point += 30
        return point

    usable.sort(key=score)
    _cached_model = usable[0]

    print("고른 모델:", _cached_model)
    return _cached_model


def extract_json(text):
    """AI 응답에서 JSON 부분만 뽑아냅니다.

    JSON으로 답하라고 지시했지만, 앞뒤에 설명이 붙어 올 가능성이 있습니다.
    그대로 json.loads에 넣으면 실패하므로, 중괄호 구간을 찾아 잘라냅니다.
    """
    text = text.strip()

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

        # ---------- 3. 같은 요청을 이미 처리했는지 확인 ----------
        # 같은 조건이면 AI를 다시 부르지 않고 기억해 둔 결과를 돌려줍니다.
        # 요금이 들지 않고, 응답도 즉시 나갑니다.
        cache_key = make_cache_key(data)

        if cache_key in _result_cache:
            print("기억해 둔 결과 사용:", cache_key[:8])
            self._send(200, _result_cache[cache_key])
            return

        # ---------- 4. 호출이 너무 잦은지 확인 ----------
        if is_rate_limited():
            print("호출 제한에 걸렸습니다.")
            self._send(429, {
                "error": "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요."
            })
            return

        # ---------- 5. API 키 꺼내기 ----------
        # 코드에 키를 적지 않고, 실행 환경에서 꺼내 씁니다.
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            self._send(500, {"error": "서버 설정이 완료되지 않았습니다. 잠시 후 다시 시도해 주세요."})
            return

        # ---------- 6. 쓸 수 있는 모델 알아내기 ----------
        try:
            model = pick_model(api_key)
        except Exception as error:
            print("모델 조회 중 오류:", repr(error))
            model = None

        if not model:
            self._send(502, {"error": "AI 연결에 실패했어요. 잠시 후 다시 시도해 주세요."})
            return

        # ---------- 7. AI 호출 ----------
        payload = {
            "system_instruction": {
                "parts": [{"text": SYSTEM_PROMPT}]
            },
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": build_user_prompt(data)}]
                }
            ],
            "generationConfig": {
                # 답을 JSON 형식으로만 내놓게 하는 설정입니다.
                "responseMimeType": "application/json",
                "maxOutputTokens": MAX_TOKENS,
                "temperature": 0.7
            }
        }

        try:
            response = requests.post(
                "{base}/models/{model}:generateContent".format(
                    base=BASE_URL, model=model
                ),
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": api_key
                },
                json=payload,
                timeout=TIMEOUT_SECONDS
            )

            if response.status_code != 200:
                # 실제 오류 내용은 서버 기록(Vercel 로그)에만 남깁니다.
                print("AI 응답 오류:", model, response.status_code, response.text[:500])
                self._send(502, {"error": "설계에 실패했어요. 잠시 후 다시 시도해 주세요."})
                return

            body = response.json()
            text = body["candidates"][0]["content"]["parts"][0]["text"]

        except requests.exceptions.Timeout:
            print("AI 호출 시간 초과")
            self._send(504, {"error": "응답이 너무 늦었어요. 잠시 후 다시 시도해 주세요."})
            return

        except Exception as error:
            # 사용자에게는 다음에 무엇을 하면 되는지만 알려 줍니다.
            print("AI 호출 실패:", repr(error))
            self._send(502, {"error": "설계에 실패했어요. 잠시 후 다시 시도해 주세요."})
            return

        # ---------- 8. 응답을 데이터로 바꾸기 ----------
        try:
            result = extract_json(text)
        except (ValueError, json.JSONDecodeError) as error:
            print("JSON 파싱 실패:", repr(error))
            print("원본 응답:", text[:500])
            self._send(502, {"error": "결과를 정리하지 못했어요. 다시 시도해 주세요."})
            return

        # ---------- 9. 기억해 두고 돌려주기 ----------
        remember_result(cache_key, result)
        self._send(200, result)
