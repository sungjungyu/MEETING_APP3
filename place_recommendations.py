import asyncio
import json
import logging
import random
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException, status
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import BaseModel, Field, ValidationError

from config import settings
from schemas import KakaoMapConfigOut, PlaceRecommendationOut, PlaceRecommendationRequest


router = APIRouter(prefix="/api/place-recommendations", tags=["place-recommendations"])
logger = logging.getLogger(__name__)


class _CuratedPlace(BaseModel):
    kakao_id: str = Field(description="카카오맵 장소 ID")
    name: str = Field(description="장소명")
    address: str = Field(description="주소")
    lat: float = Field(description="위도")
    lng: float = Field(description="경도")
    reason: str = Field(description="이 모임에 추천하는 이유 1-2문장")
    features: list[str] = Field(default_factory=list, description="특징 키워드 2-3개")


class _CuratedPlaceList(BaseModel):
    places: list[_CuratedPlace]


GEMINI_FALLBACK_MODELS = [
    "gemini-flash-lite-latest",
    "gemini-2.5-flash-lite",
    "gemini-flash-latest",
]


PLACE_RECOMMENDATION_SYSTEM_PROMPT = """당신은 서울 오프라인 모임 장소를 추천하는 로컬 큐레이터입니다.

절대 규칙:
1. 실제 서울에 존재한다고 널리 알려진 유명 장소/매장/복합문화공간만 추천합니다.
2. 상호명, 지점명, 도로명 주소를 확실히 아는 경우에만 추천합니다.
3. 모르면 추측하지 말고 해당 후보를 제외합니다. 가짜 장소, 임의 주소, 건물명만 있는 주소는 금지합니다.
4. 주소는 반드시 "서울특별시 ..."로 시작하는 도로명 주소여야 합니다.
5. 좌표는 만들지 않습니다. 좌표는 별도 지도 API 검증 단계에서 생성됩니다.
6. 프랜차이즈는 반드시 특정 지점명을 포함합니다.
7. 모임 성격, 카테고리, 설명, 키워드와 장소 분위기/접근성/활동 적합성을 함께 고려합니다.
8. 출력은 요청한 JSON 스키마만 따르고, 추가 설명을 쓰지 않습니다.
"""


def _build_user_prompt(payload: PlaceRecommendationRequest) -> str:
    keywords = ", ".join(k.strip() for k in payload.keywords if k.strip()) or "없음"
    return f"""아래 모임에 어울리는 서울의 실제 핫플레이스 후보를 최대 {payload.limit}개 추천하세요.

모임 정보:
- 제목: {payload.title}
- 카테고리: {payload.category}
- 설명: {payload.description}
- 키워드: {keywords}

후보마다 실제 상호명, 정확한 도로명 주소, 추천 이유를 작성하세요.
확실하지 않은 장소는 제외하세요.

반드시 아래 JSON 객체 형식으로만 응답하세요.
{{
  "recommendations": [
    {{
      "place_name": "장소명",
      "address": "서울특별시 ...",
      "description": "추천 이유"
    }}
  ]
}}"""


def _build_curation_prompt(payload: PlaceRecommendationRequest, kakao_places_data: list[dict]) -> str:
    keywords = ", ".join(k.strip() for k in payload.keywords if k.strip()) or "없음"
    meeting_location = payload.user_location or "미설정"
    kakao_json = json.dumps(kakao_places_data, ensure_ascii=False, indent=2)
    return f"""당신은 모임 장소 추천 전문가입니다.

아래는 카카오맵 API로 검색된 실제 장소 목록입니다.
이 모임은 {payload.category} 목적으로 만나는 모임이며, 주요 활동 지역은 {meeting_location}입니다.
이 모임의 성격(예: 스터디모임이면 공부하기 좋은 조용한 카페, 친목모임이면 맛집 등)에 꼭 맞고,
해당 지역 내에 위치한 최적의 장소들을 5개에서 10개 사이로 선별하여 추천 이유를 작성해주세요.

모임 정보:
- 제목: {payload.title}
- 카테고리: {payload.category}
- 설명: {payload.description}
- 활동 지역: {meeting_location}
- 키워드: {keywords}

카카오맵 검색 결과:
{kakao_json}

다음 형식으로 JSON만 반환하세요 (다른 텍스트 없이):
{{
  "places": [
    {{
      "kakao_id": "카카오맵 장소 ID",
      "name": "장소명",
      "address": "주소",
      "lat": 위도,
      "lng": 경도,
      "reason": "이 모임에 추천하는 이유 (1-2문장)",
      "features": ["특징1", "특징2", "특징3"]
    }}
  ]
}}

조건:
- 반드시 카카오맵 검색 결과에 있는 장소만 선별할 것
- 모임 카테고리에 가장 적합한 순서로 정렬
- reason은 모임 종류와 장소 특성을 연결해서 구체적으로 작성
- lat, lng는 카카오맵 데이터에서 그대로 가져올 것 (지도 표시에 사용)
- features는 장소의 특징을 키워드 2-3개로 (예: "조용함", "넓은 공간", "와이파이 있음")
- 반드시 JSON만 반환, 마크다운 코드블록 없이"""


def _parse_gemini_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return json.loads(cleaned)


def _normalize_curated_response(data: object) -> _CuratedPlaceList:
    if isinstance(data, list):
        data = {"places": data}
    if not isinstance(data, dict):
        raise ValueError("Unexpected Gemini response shape")

    raw_items = data.get("places") or data.get("recommendations") or data.get("장소") or []
    if not isinstance(raw_items, list):
        raise ValueError("Unexpected Gemini places shape")

    items = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        try:
            lat = float(item.get("lat") or item.get("latitude") or 0)
            lng = float(item.get("lng") or item.get("longitude") or 0)
        except (TypeError, ValueError):
            continue
        if not (lat and lng):
            continue
        features_raw = item.get("features") or item.get("특징") or []
        if not isinstance(features_raw, list):
            features_raw = []
        items.append(
            {
                "kakao_id": str(item.get("kakao_id") or item.get("id") or ""),
                "name": item.get("name") or item.get("place_name") or item.get("장소명") or "",
                "address": item.get("address") or item.get("주소") or "",
                "lat": lat,
                "lng": lng,
                "reason": item.get("reason") or item.get("description") or item.get("이유") or "",
                "features": [str(f) for f in features_raw if f][:5],
            }
        )
    return _CuratedPlaceList.model_validate({"places": items})


def _candidate_gemini_models() -> list[str]:
    models: list[str] = []
    for model in [settings.gemini_model, *GEMINI_FALLBACK_MODELS]:
        if model and model not in models:
            models.append(model)
    return models


def _request_gemini_curated_places(
    payload: PlaceRecommendationRequest,
    kakao_places_data: list[dict],
) -> list[_CuratedPlace]:
    if not settings.gemini_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="GEMINI_API_KEY가 설정되어 있지 않습니다.",
        )

    last_client_error: genai_errors.ClientError | None = None
    last_server_error: genai_errors.ServerError | None = None
    last_json_error: json.JSONDecodeError | None = None

    for model in _candidate_gemini_models():
        client = genai.Client(api_key=settings.gemini_api_key)
        prompt = f"{PLACE_RECOMMENDATION_SYSTEM_PROMPT}\n\n{_build_curation_prompt(payload, kakao_places_data)}"
        try:
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.8,
                    response_mime_type="application/json",
                ),
            )
            raw = response.text or ""
            parsed = _normalize_curated_response(_parse_gemini_json(raw))
            # 후보 여유분 확보
            return parsed.places[: payload.limit * 3]
        except json.JSONDecodeError as exc:
            last_json_error = exc
            logger.exception("Gemini returned invalid JSON from model %s", model)
            continue
        except (ValidationError, ValueError) as exc:
            logger.exception("Gemini returned unexpected place schema from model %s", model)
            continue
        except genai_errors.ServerError as exc:
            last_server_error = exc
            logger.exception("Gemini server error from model %s", model)
            continue
        except genai_errors.ClientError as exc:
            last_client_error = exc
            status_code = getattr(exc, "status_code", None)
            message = str(exc)
            logger.exception("Gemini client error from model %s", model)
            if status_code in {404, 429} or "RESOURCE_EXHAUSTED" in message:
                continue
            break
        except Exception as exc:
            logger.exception("Unexpected Gemini place recommendation error")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Gemini 장소 추천 요청 중 알 수 없는 오류가 발생했습니다. 서버 로그를 확인해 주세요.",
            ) from exc

    if last_json_error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Gemini가 올바른 JSON을 반환하지 않았습니다.",
        ) from last_json_error

    if last_client_error:
        exc = last_client_error
        status_code = getattr(exc, "status_code", None)
        message = str(exc)
        if status_code == 429 or "RESOURCE_EXHAUSTED" in message:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="사용 가능한 Gemini 모델들의 API 할당량이 초과되었습니다. Google AI Studio에서 결제/할당량을 확인하거나 다른 API 키를 사용해 주세요.",
            ) from exc
        if status_code == 404:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="설정된 Gemini 모델을 사용할 수 없습니다. GEMINI_MODEL 값을 확인해 주세요.",
            ) from exc
        if status_code == 400:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Gemini 요청 형식이 올바르지 않습니다.",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Gemini API 호출에 실패했습니다. API 키, 모델명, 프로젝트 상태를 확인해 주세요.",
        ) from exc

    if last_server_error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Gemini 모델이 일시적으로 혼잡합니다. 잠시 후 다시 시도해 주세요.",
        ) from last_server_error

    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail="Gemini 장소 추천 결과를 만들지 못했습니다.",
    )


async def curate_places_with_ai(
    payload: PlaceRecommendationRequest,
    kakao_places_data: list[dict],
) -> list[_CuratedPlace]:
    return await asyncio.to_thread(_request_gemini_curated_places, payload, kakao_places_data)


def _request_kakao_json(path: str, params: dict[str, str | int]) -> dict:
    if not settings.kakao_rest_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="KAKAO_REST_API_KEY가 설정되어 있지 않습니다.",
        )

    url = f"https://dapi.kakao.com{path}?" + urlencode(params)
    request = Request(url, headers={"Authorization": f"KakaoAK {settings.kakao_rest_api_key}"})
    try:
        with urlopen(request, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="ignore").strip()
        detail = f"카카오 로컬 API 요청에 실패했습니다. HTTP {exc.code}"
        if error_body:
            detail = f"{detail}: {error_body[:300]}"
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=detail,
        ) from exc
    except URLError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="카카오 로컬 API에 연결할 수 없습니다.",
        ) from exc


# 카테고리별 카카오 검색 키워드
CATEGORY_QUERY_HINTS: dict[str, list[str]] = {
    "스터디": ["스터디카페", "스터디룸", "카페"],
    "운동": ["헬스장", "체육관", "필라테스", "클라이밍"],
    "독서": ["북카페", "도서관", "서점"],
    "음악": ["연습실", "합주실", "노래방"],
    "요리": ["쿠킹클래스", "요리학원", "원데이클래스"],
    "여행": ["관광지", "전망대", "공원"],
    "게임": ["보드게임카페", "PC방", "방탈출"],
    "영화": ["영화관", "독립영화관"],
    "전시": ["전시", "갤러리", "미술관"],
    "AI": ["스터디카페", "공유오피스", "코워킹"],
    "창업": ["공유오피스", "코워킹", "스터디카페"],
    "봉사": ["복지관", "커뮤니티센터"],
    "기타": ["모임공간", "카페", "스터디카페"],
}


def _extract_general_region(location: str) -> str:
    """주소에서 시/구까지만 추출"""
    if not location:
        return ""
    
    parts = location.strip().split()
    if len(parts) >= 2:
        return f"{parts[0]} {parts[1]}"
    return location.strip()


def _build_search_queries(payload: PlaceRecommendationRequest) -> list[str]:
    """카테고리와 지역으로 카카오 검색 쿼리를 만든다"""
    raw_location = (payload.user_location or "").strip()
    region = _extract_general_region(raw_location)  # 시/구까지만 추출
    category = (payload.category or "").strip()
    hints = CATEGORY_QUERY_HINTS.get(category, [category or "모임공간"])

    queries: list[str] = []
    # 기본: 지역 + 카테고리
    for hint in hints:
        if region:
            queries.append(f"{region} {hint}")
        else:
            queries.append(hint)
    # 보조: 키워드
    for kw in payload.keywords[:2]:
        kw = kw.strip()
        if not kw:
            continue
        if region:
            queries.append(f"{region} {kw}")
        else:
            queries.append(kw)
    # 중복 제거 (순서 유지)
    seen: set[str] = set()
    unique: list[str] = []
    for q in queries:
        if q and q not in seen:
            seen.add(q)
            unique.append(q)
    return unique[:6]


def _collect_kakao_places(payload: PlaceRecommendationRequest) -> list[dict]:
    """카카오 키워드 검색으로 후보 장소를 모은다"""
    seen_ids: set[str] = set()
    collected: list[dict] = []

    for query in _build_search_queries(payload):
        try:
            data = _request_kakao_json(
                "/v2/local/search/keyword.json",
                {"query": query, "size": 15},
            )
        except HTTPException:
            logger.exception("Kakao keyword search failed for query: %s", query)
            continue
        for doc in data.get("documents", []):
            place_id = str(doc.get("id") or "")
            if not place_id or place_id in seen_ids:
                continue
            seen_ids.add(place_id)
            collected.append(
                {
                    "kakao_id": place_id,
                    "name": doc.get("place_name") or "",
                    "address": doc.get("road_address_name") or doc.get("address_name") or "",
                    "category": doc.get("category_name") or "",
                    "phone": doc.get("phone") or "",
                    "url": doc.get("place_url") or "",
                    "lat": float(doc.get("y") or 0) or None,
                    "lng": float(doc.get("x") or 0) or None,
                }
            )
    # 좌표 없는 장소 제거하고 순서 섞기
    valid_places = [p for p in collected if p["lat"] and p["lng"]]
    random.shuffle(valid_places)
    return valid_places[:50]


async def collect_kakao_places(payload: PlaceRecommendationRequest) -> list[dict]:
    return await asyncio.to_thread(_collect_kakao_places, payload)


@router.post("", response_model=list[PlaceRecommendationOut])
async def recommend_places(payload: PlaceRecommendationRequest) -> list[PlaceRecommendationOut]:
    kakao_places = await collect_kakao_places(payload)
    if not kakao_places:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="카카오맵에서 적합한 장소를 찾지 못했습니다. 지역이나 카테고리를 다시 확인해 주세요.",
        )

    # Gemini 토큰 절약용으로 좌표 소수점 자리 줄이기
    compact_for_ai = [
        {
            "kakao_id": p["kakao_id"],
            "name": p["name"],
            "address": p["address"],
            "category": p["category"],
            "lat": round(p["lat"], 6),
            "lng": round(p["lng"], 6),
        }
        for p in kakao_places
    ]

    curated = await curate_places_with_ai(payload, compact_for_ai)

    # 결과 랜덤 섞기
    random.shuffle(curated)

    # 카카오 원본 좌표/주소로 보정
    kakao_by_id: dict[str, dict] = {p["kakao_id"]: p for p in kakao_places}

    results: list[PlaceRecommendationOut] = []
    seen_ids: set[str] = set()
    for item in curated[: payload.limit * 2]:
        source = kakao_by_id.get(item.kakao_id)
        if not source:
            # Gemini가 새로 만든 ID는 좌표 확인
            if not (item.lat and item.lng):
                continue
            lat, lng, address, name = item.lat, item.lng, item.address, item.name
            kakao_id = item.kakao_id or None
        else:
            lat = source["lat"]
            lng = source["lng"]
            address = source["address"] or item.address
            name = source["name"] or item.name
            kakao_id = source["kakao_id"]
        if kakao_id and kakao_id in seen_ids:
            continue
        if kakao_id:
            seen_ids.add(kakao_id)
        results.append(
            PlaceRecommendationOut(
                kakao_id=kakao_id,
                place_name=name,
                address=address,
                latitude=lat,
                longitude=lng,
                description=item.reason,
                features=item.features,
            )
        )

    if not results:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="추천 가능한 장소를 찾지 못했습니다. 키워드를 더 구체적으로 입력해 주세요.",
        )
    
    # 최종 결과 섞고 limit 적용
    random.shuffle(results)
    return results[:payload.limit]


@router.get("/map-config", response_model=KakaoMapConfigOut)
async def kakao_map_config() -> KakaoMapConfigOut:
    return KakaoMapConfigOut(javascript_key=settings.kakao_javascript_key)


# 채팅방용 장소 추천

class ChatRoomPlaceRecommendationRequest(BaseModel):
    meeting_id: int
    meeting_title: str = Field(min_length=2, max_length=120)
    meeting_category: str = Field(min_length=2, max_length=50)
    meeting_description: str = Field(min_length=5)
    meeting_location: str = Field(min_length=2, max_length=120)
    keywords: list[str] = Field(default_factory=list, max_length=12)
    limit: int = Field(default=7, ge=5, le=10)


@router.post("/chatroom-recommend", response_model=list[PlaceRecommendationOut])
async def recommend_places_for_chatroom(
    payload: ChatRoomPlaceRecommendationRequest,
) -> list[PlaceRecommendationOut]:
    """채팅방용 장소 추천"""
    
    # 검색용 형식으로 변환
    search_payload = PlaceRecommendationRequest(
        title=payload.meeting_title,
        category=payload.meeting_category,
        description=payload.meeting_description,
        keywords=payload.keywords,
        user_location=payload.meeting_location,
        user_interests=[],  # 사용자 관심사 제외
        limit=payload.limit,
    )
    
    # 카카오 장소 검색
    kakao_places = await collect_kakao_places(search_payload)
    
    if not kakao_places:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="카카오맵에서 적합한 장소를 찾지 못했습니다.",
        )
    
    # Gemini 큐레이션
    compact_for_ai = [
        {
            "kakao_id": p["kakao_id"],
            "name": p["name"],
            "address": p["address"],
            "category": p["category"],
            "lat": round(p["lat"], 6),
            "lng": round(p["lng"], 6),
        }
        for p in kakao_places
    ]
    
    curated = await curate_places_with_ai(search_payload, compact_for_ai)
    
    # 결과 랜덤 섞기
    random.shuffle(curated)
    
    # 결과 조합
    kakao_by_id: dict[str, dict] = {p["kakao_id"]: p for p in kakao_places}
    
    results: list[PlaceRecommendationOut] = []
    seen_ids: set[str] = set()
    
    for item in curated[: payload.limit * 2]:
        source = kakao_by_id.get(item.kakao_id)
        if not source:
            if not (item.lat and item.lng):
                continue
            lat, lng, address, name = item.lat, item.lng, item.address, item.name
            kakao_id = item.kakao_id or None
        else:
            lat = source["lat"]
            lng = source["lng"]
            address = source["address"] or item.address
            name = source["name"] or item.name
            kakao_id = source["kakao_id"]
        
        if kakao_id and kakao_id in seen_ids:
            continue
        if kakao_id:
            seen_ids.add(kakao_id)
        
        results.append(
            PlaceRecommendationOut(
                kakao_id=kakao_id,
                place_name=name,
                address=address,
                latitude=lat,
                longitude=lng,
                description=item.reason,
                features=item.features,
            )
        )
    
    if not results:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="추천 가능한 장소를 찾지 못했습니다.",
        )
    
    # 최종 결과 섞고 limit 적용
    random.shuffle(results)
    return results[:payload.limit]
