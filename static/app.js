// 시간 포맷팅 유틸리티
function formatTime(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  // 한국 시간으로 변환
  const koreaTime = new Date(date.getTime() + (9 * 60 * 60 * 1000));
  const hours = String(koreaTime.getUTCHours()).padStart(2, '0');
  const minutes = String(koreaTime.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

const tokenKey = "meeting_app_token";
const views = document.querySelectorAll(".view");
const viewTriggers = document.querySelectorAll("[data-view]");
const navButtons = document.querySelectorAll(".nav-button[data-view]");
const meetingList = document.querySelector("#meetingList");
const meetingCount = document.querySelector("#meetingCount");
const recommendSection = document.querySelector("#recommendSection");
const recommendList = document.querySelector("#recommendList");
const meetingPageList = document.querySelector("#meetingPageList");
const myMeetingList = document.querySelector("#myMeetingList");
const meetingScheduleSection = document.querySelector("#meetingScheduleSection");
const meetingScheduleList = document.querySelector("#meetingScheduleList");
const calendarList = document.querySelector("#calendarList");
const chatMessages = document.querySelector("#chatMessages");
const chatState = document.querySelector("#chatState");
const chatRoomTitle = document.querySelector("#chatRoomTitle");
const chatRoomListView = document.querySelector("#chatRoomListView");
const screenTitle = document.querySelector("#screenTitle");
const screenSubTitle = document.querySelector("#screenSubTitle");
const meetingDetail = document.querySelector("#meetingDetail");
const meetingSearch = document.querySelector("#meetingSearch");
const applicationList = document.querySelector("#applicationList");
const meetingForm = document.querySelector("#meetingForm");
const recommendPlaceButton = document.querySelector("#recommendPlaceButton");
const placeRecommendationList = document.querySelector("#placeRecommendationList");
const placeMapPanel = document.querySelector("#placeMapPanel");
const userRegionKey = "meeting_app_user_region";
const calendarGrid = document.querySelector("#calendarGrid");
const calendarMonthLabel = document.querySelector("#calendarMonthLabel");
const calendarPrev = document.querySelector("#calendarPrev");
const calendarNext = document.querySelector("#calendarNext");

if (screenSubTitle) {
  screenSubTitle.textContent = "";
}
if (document.querySelector(".home-card")) {
  document.querySelector(".home-card").remove();
}

const header = document.querySelector(".app-header");
const headerCenter = header?.querySelector("div");
if (header) {
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.justifyContent = "space-between";
  header.style.position = "relative";
}
if (headerCenter) {
  headerCenter.style.position = "absolute";
  headerCenter.style.left = "50%";
  headerCenter.style.transform = "translateX(-50%)";
  headerCenter.style.display = "flex";
  headerCenter.style.flexDirection = "column";
  headerCenter.style.alignItems = "center";
  headerCenter.style.justifyContent = "center";
}
if (document.querySelector(".profile-dot")) {
  document.querySelector(".profile-dot").remove();
}

let cachedMeetings = [];
let cachedRecommendations = [];
let cachedMyMeetings = [];
let chatSocket = null;
let notifySocket = null;
let activeRoomId = 1;
let currentUser = null;
let viewHistory = [];
let notifications = [];
let kakaoMapConfigPromise = null;
let kakaoMapSdkPromise = null;
let placeMap = null;
let placeMapMarkers = [];
let placeMapInfoWindows = [];
let placeMapPlaces = [];
let embeddedMapMode = false;

function setView(viewName) {
  const currentActive = document.querySelector(".view.active");
  if (currentActive && currentActive.id !== viewName) {
    viewHistory.push(currentActive.id);
  }
  views.forEach((view) => view.classList.toggle("active", view.id === viewName));
  navButtons.forEach((button) => button.classList.toggle("active", button.dataset.view === viewName));
  const currentView = document.querySelector(`#${viewName}`);
  const currentTitle = document.querySelector("#screenTitle");
  const currentSubTitle = document.querySelector("#screenSubTitle");
  if (currentView && currentTitle && currentSubTitle) {
    currentTitle.textContent = currentView.dataset.title || "이음";
    currentSubTitle.textContent = viewName === "home" ? "" : (currentView.dataset.subtitle ?? "");
  }
  const backButton = document.querySelector("#backButton");
  if (backButton) backButton.style.visibility = viewHistory.length > 0 ? "visible" : "hidden";

  if (viewName === "notifications") renderNotifications();
  if (viewName === "meetings") loadMeetingPage();
  if (viewName === "recommend") loadRecommendationView();
  if (viewName === "mymeetings") loadMyMeetingView();
  if (viewName === "calendar") loadCalendar();
  if (viewName === "chat") loadChatView();
  if (viewName === "profile") loadApplications();
  if (viewName === "myposts") loadMyPosts();
  if (viewName === "myapplications") loadMyApplications();
  if (viewName === "editprofile") loadEditProfile();
}

document.querySelector("#backButton").addEventListener("click", () => {
  if (viewHistory.length === 0) return;
  const prev = viewHistory.pop();
  views.forEach((view) => view.classList.toggle("active", view.id === prev));
  navButtons.forEach((button) => button.classList.toggle("active", button.dataset.view === prev));
  const prevView = document.querySelector(`#${prev}`);
  const currentTitle = document.querySelector("#screenTitle");
  const currentSubTitle = document.querySelector("#screenSubTitle");
  if (prevView && currentTitle && currentSubTitle) {
    currentTitle.textContent = prevView.dataset.title || "이음";
    currentSubTitle.textContent = prev === "home" ? "" : (prevView.dataset.subtitle ?? "");
  }
  const backButton = document.querySelector("#backButton");
  if (backButton) backButton.style.visibility = viewHistory.length > 0 ? "visible" : "hidden";
});

function authHeaders() {
  const token = localStorage.getItem(tokenKey);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function authToken() {
  return localStorage.getItem(tokenKey);
}

function normalizeRegion(value) {
  return (value || "").trim().replace(/\s+/g, " ");
}

function getUserRegion() {
  return normalizeRegion(localStorage.getItem(userRegionKey));
}

function setUserRegion(value) {
  const region = normalizeRegion(value);
  if (!region) {
    localStorage.removeItem(userRegionKey);
    return "";
  }
  localStorage.setItem(userRegionKey, region);
  return region;
}

function meetingMatchesRegion(meeting) {
  const userRegion = getUserRegion();
  if (!userRegion) {
    return true; // 지역 미설정시 모든 모임 표시
  }
  
  const meetingLocation = (meeting.location || "").toLowerCase();
  const userRegionLower = userRegion.toLowerCase();
  
  // 사용자 지역이 모임 위치에 포함되는지 확인
  // 예: "대전 서구" → "대전"과 "서구" 모두 포함되는지 체크
  const userParts = userRegionLower.split(" ");
  
  // 모든 사용자 지역 키워드가 모임 위치에 포함되어야 함
  return userParts.every(part => meetingLocation.includes(part));
}

// 짧은 지역명을 전체 명칭으로 변환
function getFullProvinceName(shortName) {
  const provinceMap = {
    "서울": "서울특별시",
    "부산": "부산광역시",
    "대구": "대구광역시",
    "인천": "인천광역시",
    "광주": "광주광역시",
    "대전": "대전광역시",
    "울산": "울산광역시",
    "세종": "세종특별자치시",
    "경기": "경기도",
    "강원": "강원특별자치도",
    "충북": "충청북도",
    "충남": "충청남도",
    "전북": "전북특별자치도",
    "전남": "전라남도",
    "경북": "경상북도",
    "경남": "경상남도",
    "제주": "제주특별자치도",
  };
  return provinceMap[shortName] || shortName;
}

function filterMeetingsByRegion(meetings) {
  return (meetings || []).filter(meetingMatchesRegion);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    // 검증 오류 처리 (FastAPI는 배열로 반환)
    if (Array.isArray(data?.detail)) {
      const messages = data.detail.map(err => {
        if (typeof err === 'string') return err;
        if (err.msg) return err.msg;
        if (err.message) return err.message;
        return JSON.stringify(err);
      });
      throw new Error(messages.join(', '));
    }
    throw new Error(data?.detail || data?.message || `HTTP ${response.status}`);
  }
  return data;
}

function splitInterests(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function embeddedMapUrl(place) {
  const lon = Number(place.longitude);
  const lat = Number(place.latitude);
  const bbox = [lon - 0.006, lat - 0.004, lon + 0.006, lat + 0.004].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${lat},${lon}`)}`;
}

async function loadKakaoMapConfig() {
  if (!kakaoMapConfigPromise) {
    kakaoMapConfigPromise = api("/api/place-recommendations/map-config").catch(() => ({ javascript_key: null }));
  }
  return kakaoMapConfigPromise;
}

async function loadKakaoMapSdk() {
  const config = await loadKakaoMapConfig();
  if (!config.javascript_key) return false;
  if (window.kakao?.maps) return true;
  if (!kakaoMapSdkPromise) {
    kakaoMapSdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(config.javascript_key)}&autoload=false`;
      script.async = true;
      script.onload = () => window.kakao.maps.load(() => resolve(true));
      script.onerror = () => reject(new Error("카카오맵 SDK를 불러오지 못했습니다."));
      document.head.appendChild(script);
    });
  }
  return kakaoMapSdkPromise;
}

function clearPlaceMap() {
  placeMapMarkers.forEach((marker) => marker.setMap(null));
  placeMapInfoWindows.forEach((infoWindow) => infoWindow.close());
  placeMapMarkers = [];
  placeMapInfoWindows = [];
}

function renderEmbeddedPlaceMap(places, activeIndex = 0) {
  if (!places.length) return "";
  const activePlace = places[activeIndex] || places[0];
  const tabs = places
    .map(
      (place, index) => `
        <button type="button" class="place-map-tab ${index === activeIndex ? "active" : ""}" data-embedded-map-index="${index}">
          <span class="place-map-tab-num">${index + 1}</span>
          ${place.place_name}
        </button>
      `,
    )
    .join("");

  return `
    <div class="embedded-map-shell">
      <div class="embedded-map-tabs">${tabs}</div>
      <div class="embedded-map-frame-wrap">
        <iframe
          title="${activePlace.place_name} 지도"
          src="${embeddedMapUrl(activePlace)}"
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"
        ></iframe>
      </div>
      <div class="embedded-map-caption">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 1 7 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 0 1 7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
        <div>
          <strong>${activePlace.place_name}</strong>
          <span>${activePlace.address}</span>
        </div>
      </div>
    </div>
  `;
}

function bindEmbeddedMapButtons() {
  placeMapPanel?.querySelectorAll("[data-embedded-map-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.embeddedMapIndex);
      focusEmbeddedPlace(index);
    });
  });
}

function focusEmbeddedPlace(index = 0) {
  if (!placeMapPanel || !embeddedMapMode || !placeMapPlaces.length) return;
  placeMapPanel.innerHTML = renderEmbeddedPlaceMap(placeMapPlaces, index);
  bindEmbeddedMapButtons();
}

function focusPlaceOnMap(place, index = 0) {
  if (!placeMap || !window.kakao?.maps) return;
  const position = new window.kakao.maps.LatLng(place.latitude, place.longitude);
  placeMap.panTo(position);
  placeMap.setLevel(4);
  placeMapInfoWindows.forEach((infoWindow) => infoWindow.close());
  placeMapInfoWindows[index]?.open(placeMap, placeMapMarkers[index]);
}

async function renderPlaceMap(places) {
  if (!placeMapPanel) return;
  placeMapPanel.innerHTML = "";
  placeMap = null;
  placeMapPlaces = places;
  embeddedMapMode = false;
  clearPlaceMap();

  if (!places.length) return;

  try {
    // 로딩 표시
    placeMapPanel.innerHTML = '<div class="map-empty" style="padding:40px;text-align:center;color:var(--sub);"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite;display:block;margin:0 auto 10px;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>카카오맵을 불러오는 중...</div>';
    
    // 카카오맵 SDK 로딩 (타임아웃 5초)
    const hasSdk = await Promise.race([
      loadKakaoMapSdk(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("카카오맵 SDK 로딩 시간 초과")), 5000))
    ]);
    if (!hasSdk) {
      placeMapPanel.innerHTML = '<div class="map-empty" style="padding:40px;text-align:center;color:var(--sub);">카카오맵 API 키가 설정되지 않았습니다.<br>.env 파일에 KAKAO_JAVASCRIPT_KEY를 설정해주세요.</div>';
      return;
    }

    placeMapPanel.innerHTML = `
      <div class="place-map-wrap">
        <div id="placeMap" class="place-map" aria-label="추천 장소 지도"></div>
        <div class="place-map-overlay-tabs" id="placeMapTabs"></div>
      </div>
    `;
    
    // DOM이 반영될 시간을 주기 위해 requestAnimationFrame 사용
    await new Promise(resolve => requestAnimationFrame(resolve));
    const bounds = new window.kakao.maps.LatLngBounds();
    placeMap = new window.kakao.maps.Map(document.querySelector("#placeMap"), {
      center: new window.kakao.maps.LatLng(places[0].latitude, places[0].longitude),
      level: 4,
    });

    const tabsEl = document.querySelector("#placeMapTabs");
    if (tabsEl) {
      tabsEl.innerHTML = places.map((place, index) => `
        <button type="button" class="place-map-overlay-tab ${index === 0 ? "active" : ""}" data-map-tab-index="${index}">
          <span class="place-map-tab-num">${index + 1}</span>
          ${place.place_name}
        </button>
      `).join("");
      tabsEl.querySelectorAll("[data-map-tab-index]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const idx = Number(btn.dataset.mapTabIndex);
          tabsEl.querySelectorAll("[data-map-tab-index]").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          const card = placeRecommendationList?.querySelector(`[data-place-index="${idx}"]`);
          placeRecommendationList?.querySelectorAll(".place-recommend-card").forEach((c) => c.classList.remove("selected"));
          if (card) {
            card.classList.add("selected");
            card.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
          focusPlaceOnMap(places[idx], idx);
        });
      });
    }

    places.forEach((place, index) => {
      const position = new window.kakao.maps.LatLng(place.latitude, place.longitude);
      const markerImage = new window.kakao.maps.MarkerImage(
        `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44"><path d="M18 0C8.06 0 0 8.06 0 18c0 12.42 18 26 18 26S36 30.42 36 18C36 8.06 27.94 0 18 0z" fill="#6366f1"/><circle cx="18" cy="18" r="9" fill="white"/><text x="18" y="23" text-anchor="middle" font-size="13" font-weight="900" fill="#6366f1" font-family="-apple-system,sans-serif">${index + 1}</text></svg>`)}`,
        new window.kakao.maps.Size(36, 44),
        { offset: new window.kakao.maps.Point(18, 44) }
      );
      const marker = new window.kakao.maps.Marker({ position, image: markerImage });
      const infoWindow = new window.kakao.maps.InfoWindow({
        content: `<div class="map-infowindow"><strong>${place.place_name}</strong><span>${place.address}</span></div>`,
        removable: false,
      });
      marker.setMap(placeMap);
      window.kakao.maps.event.addListener(marker, "click", () => {
        const tabsEl = document.querySelector("#placeMapTabs");
        tabsEl?.querySelectorAll("[data-map-tab-index]").forEach((b) => b.classList.remove("active"));
        tabsEl?.querySelector(`[data-map-tab-index="${index}"]`)?.classList.add("active");
        const card = placeRecommendationList?.querySelector(`[data-place-index="${index}"]`);
        placeRecommendationList?.querySelectorAll(".place-recommend-card").forEach((c) => c.classList.remove("selected"));
        if (card) {
          card.classList.add("selected");
          card.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
        focusPlaceOnMap(place, index);
      });
      placeMapMarkers.push(marker);
      placeMapInfoWindows.push(infoWindow);
      bounds.extend(position);
    });

    if (places.length > 1) {
      placeMap.setBounds(bounds, 60, 60, 60, 60);
    }
    
    // 지도 초기화 후 크기 재조정 (여러 단계로 안정성 확보)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (placeMap && window.kakao?.maps) {
            placeMap.relayout();
            const center = placeMap.getCenter();
            placeMap.setCenter(center);
            window.kakao.maps.event.trigger(placeMap, "resize");
            focusPlaceOnMap(places[0], 0);
          }
        }, 200);
      });
    });
  } catch (err) {
    placeMapPanel.innerHTML = `<div class="map-empty" style="padding:40px;text-align:center;color:var(--sub);">카카오맵을 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

function renderPlaceRecommendations(places) {
  if (!placeRecommendationList) return;
  placeRecommendationList.innerHTML = places.length
    ? places
        .map(
          (place, index) => `
            <article class="place-recommend-card" data-place-index="${index}" role="button" tabindex="0">
              <div class="place-card-badge">${index + 1}</div>
              <div class="place-card-body">
                <strong class="place-card-name">${place.place_name}</strong>
                <span class="place-card-address">
                  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 1 7 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 0 1 7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
                  ${place.address}
                </span>
                <p class="place-card-desc">${place.description}</p>
                ${(place.features && place.features.length) ? `<div class="place-card-features">${place.features.map((f) => `<span class="place-feature-chip">${f}</span>`).join("")}</div>` : ""}
              </div>
              <div class="place-card-arrow">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            </article>
          `,
        )
        .join("")
    : "";

  placeRecommendationList.querySelectorAll("[data-place-index]").forEach((button) => {
    const selectPlace = () => {
      const place = places[Number(button.dataset.placeIndex)];
      const index = Number(button.dataset.placeIndex);
      if (!place || !meetingForm) return;
      const locationInput = meetingForm.elements.location;
      locationInput.value = `${place.place_name} (${place.address})`;
      locationInput.dataset.latitude = String(place.latitude);
      locationInput.dataset.longitude = String(place.longitude);
      placeRecommendationList.querySelectorAll(".place-recommend-card").forEach((card) => {
        card.classList.toggle("selected", card === button);
      });
      const tabsEl = document.querySelector("#placeMapTabs");
      tabsEl?.querySelectorAll("[data-map-tab-index]").forEach((b) => b.classList.remove("active"));
      tabsEl?.querySelector(`[data-map-tab-index="${index}"]`)?.classList.add("active");
      focusPlaceOnMap(place, index);

      // 지도 탭으로 자동 전환
      const resultTabs = document.querySelectorAll(".place-result-tab[data-result-tab]");
      resultTabs.forEach((t) => t.classList.remove("active"));
      document.querySelector(".place-result-tab[data-result-tab='map']")?.classList.add("active");
      const listPane = document.querySelector("#resultPaneList");
      const mapPane = document.querySelector("#resultPaneMap");
      if (listPane) listPane.hidden = true;
      if (mapPane) mapPane.hidden = false;
      if (placeMap) {
        window.setTimeout(() => window.kakao?.maps?.event?.trigger(placeMap, "resize"), 50);
      }
    };
    button.addEventListener("click", (event) => {
      selectPlace();
    });
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectPlace();
    });
  });
}

function showPlaceResultSection() {
  const section = document.querySelector(".place-result-section");
  if (section) section.hidden = false;
}

function hidePlaceResultSection() {
  const section = document.querySelector(".place-result-section");
  if (section) section.hidden = true;
}

async function loadPlaceRecommendations() {
  if (!meetingForm || !placeRecommendationList || !recommendPlaceButton) return;
  const formData = new FormData(meetingForm);
  const status = document.querySelector("#meetingStatus");
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const category = String(formData.get("category") || "").trim();
  const keywords = splitInterests(formData.get("keywords") || "");

  if (title.length < 2 || description.length < 5 || !category) {
    status.textContent = "모임명, 소개, 카테고리를 먼저 입력해 주세요.";
    return;
  }

  recommendPlaceButton.disabled = true;
  recommendPlaceButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> 추천 중`;
  status.textContent = "";
  placeRecommendationList.innerHTML = '<div class="empty-panel">장소를 찾는 중입니다.</div>';
  if (placeMapPanel) placeMapPanel.innerHTML = '<div class="map-empty">지도 정보를 준비하는 중입니다.</div>';

  try {
    const places = await api("/api/place-recommendations", {
      method: "POST",
      body: JSON.stringify({
        title,
        category,
        description,
        keywords,
        user_location: getUserRegion() || null,
        user_interests: currentUser?.interests?.map(i => i.name) || [],
        limit: 10,
      }),
    });
    renderPlaceRecommendations(places);
    await renderPlaceMap(places);
    if (places.length) showPlaceResultSection();
    if (!places.length) {
      placeRecommendationList.innerHTML = '<div class="empty-panel">추천할 장소가 없습니다.</div>';
    }
  } catch (error) {
    placeRecommendationList.innerHTML = "";
    if (placeMapPanel) placeMapPanel.innerHTML = "";
    hidePlaceResultSection();
    status.textContent = error.message;
  } finally {
    recommendPlaceButton.disabled = false;
    recommendPlaceButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 1 7 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 0 1 7-7z"/><circle cx="12" cy="9" r="2.5"/></svg> 장소 추천`;
  }
}

function formatDate(value) {
  return new Date(value).toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function meetingCard(meeting, index = 0, compact = false) {
  const joined = Math.max(meeting.approved_members || 0, 0);
  const max = Math.max(meeting.max_members || 1, 1);
  const percent = Math.min(Math.round((joined / max) * 100), 100);
  const initial = meeting.title.trim().slice(0, 1).toUpperCase();
  const gradients = [
    "linear-gradient(135deg, #2451d6, #22b496)",
    "linear-gradient(135deg, #111318, #ff6b4a)",
    "linear-gradient(135deg, #7c3aed, #06b6d4)",
    "linear-gradient(135deg, #0f766e, #f59e0b)",
  ];
  return `
    <article class="meeting-item ${compact ? "wide" : ""}" data-meeting-id="${meeting.id}" aria-label="${meeting.title}">
      <div class="meeting-cover" style="background: ${gradients[index % gradients.length]}">
        <span class="meeting-chip">${meeting.category}</span>
        <div class="meeting-avatar">${initial}</div>
      </div>
      <div>
        <h3>${meeting.title}</h3>
        <p class="meeting-description">${meeting.description}</p>
        <div class="meeting-meta">
          <span>${meeting.location}</span>
          <span>${formatDate(meeting.start_at)}</span>
          <span>${joined}/${max}명 참여 중</span>
        </div>
      </div>
      <div class="meeting-progress" aria-label="모집률 ${percent}%">
        <span style="width: ${percent}%"></span>
      </div>
    </article>
  `;
}

function emptyCard(title, description) {
  return `
    <article class="meeting-item">
      <div class="meeting-cover">
        <span class="meeting-chip">MOIUM</span>
        <div class="meeting-avatar">+</div>
      </div>
      <div>
        <h3>${title}</h3>
        <p class="meeting-description">${description}</p>
        <div class="meeting-meta"><span>모임 만들기 버튼으로 바로 시작할 수 있어요.</span></div>
      </div>
    </article>
  `;
}

function findMeeting(id) {
  return (
    cachedMeetings.find((item) => String(item.id) === String(id)) ||
    cachedRecommendations.find((item) => String(item.id) === String(id)) ||
    cachedMyMeetings.find((item) => String(item.id) === String(id))
  );
}

function recommendRow(meeting) {
  const joined = Math.max(meeting.approved_members || 0, 0);
  const max = Math.max(meeting.max_members || 1, 1);
  return `
    <button type="button" class="recommend-row" data-meeting-id="${meeting.id}">
      <span class="recommend-tag">${meeting.category}</span>
      <span class="recommend-body">
        <strong>${meeting.title}</strong>
        <small>${meeting.location} · ${formatDate(meeting.start_at)} · ${joined}/${max}명</small>
      </span>
      <span class="recommend-arrow" aria-hidden="true">›</span>
    </button>
  `;
}

function renderRecommendations(meetings) {
  if (!recommendSection || !recommendList) return;
  cachedRecommendations = filterMeetingsByRegion(meetings || []);
  if (!cachedRecommendations.length) {
    recommendList.innerHTML = '<div class="empty-panel">설정한 지역에 맞는 추천 모임이 없습니다.</div>';
    return;
  }
  recommendList.innerHTML = cachedRecommendations.map(recommendRow).join("");
  recommendList.querySelectorAll("[data-meeting-id]").forEach((row) => {
    row.addEventListener("click", () => {
      const meeting = findMeeting(row.dataset.meetingId);
      if (meeting) renderMeetingDetail(meeting);
    });
  });
}

async function loadRecommendationView() {
  if (!authToken()) {
    recommendList.innerHTML = '<div class="empty-panel">로그인 후 추천을 받을 수 있어요.</div>';
    return;
  }
  if (!cachedRecommendations.length) {
    cachedRecommendations = (await loadRecommendations()) || [];
  }
  renderRecommendations(cachedRecommendations);
}

function bindMeetingCards() {
  document.querySelectorAll("#meetingList [data-meeting-id], #meetingPageList [data-meeting-id], #myMeetingList [data-meeting-id]").forEach((card) => {
    card.addEventListener("click", () => {
      const meeting = findMeeting(card.dataset.meetingId);
      if (meeting) renderMeetingDetail(meeting);
    });
  });
}

function renderMeetings(meetings) {
  const filteredMeetings = filterMeetingsByRegion(meetings);
  meetingCount.textContent = filteredMeetings.length;
  meetingList.innerHTML = filteredMeetings.length
    ? filteredMeetings.map((meeting, index) => meetingCard(meeting, index)).join("")
    : emptyCard("아직 등록된 모임이 없습니다.", "첫 모임을 만들어 피드에 보여주세요.");
  bindMeetingCards();
}

function renderMeetingPage(meetings) {
  meetingPageList.innerHTML = meetings.length
    ? meetings.map((meeting, index) => meetingCard(meeting, index, true)).join("")
    : emptyCard("탐색할 모임이 없습니다.", "새 모임을 만들면 이곳에 카드로 표시됩니다.");
  bindMeetingCards();
}

function meetingScheduleCard(schedule) {
  return `
    <article class="schedule-item" data-schedule-id="${schedule.id}">
      <div>
        <h3>${schedule.activity}</h3>
        <p>${schedule.settings || "세부 안내가 없습니다."}</p>
      </div>
      <div class="schedule-meta">
        <span>장소 ${schedule.location}</span>
        <span>${formatDate(schedule.scheduled_at)}</span>
        <span>정원 ${schedule.capacity}명</span>
      </div>
      <div class="schedule-actions">
        <button class="schedule-join-button" data-schedule-id="${schedule.id}">일정 참여</button>
      </div>
      <div id="scheduleParticipants-${schedule.id}" class="schedule-participants" style="display:none;"></div>
    </article>
  `;
}

function renderMeetingSchedules(schedules) {
  if (!meetingScheduleList) return;
  meetingScheduleList.innerHTML = schedules.length
    ? schedules.map((schedule) => meetingScheduleCard(schedule)).join("")
    : '<div class="empty-panel">아직 등록된 일정이 없습니다.</div>';
  bindScheduleButtons();
  schedules.forEach(async (schedule) => {
    const participants = await loadScheduleParticipants(schedule.id);
    renderScheduleParticipants(schedule.id, participants);
  });
}

async function loadMeetingSchedules(meetingId) {
  if (!meetingScheduleList) return [];
  try {
    return await api(`/api/meetings/${meetingId}/schedules`);
  } catch {
    return [];
  }
}

async function loadScheduleParticipants(scheduleId) {
  try {
    return await api(`/api/schedules/${scheduleId}/participants`);
  } catch {
    return [];
  }
}

function renderScheduleParticipants(scheduleId, participants) {
  const container = document.querySelector(`#scheduleParticipants-${scheduleId}`);
  const actionButton = document.querySelector(`.schedule-join-button[data-schedule-id="${scheduleId}"]`);
  if (actionButton) {
    const joined = currentUser ? participants.some((p) => p.user.id === currentUser.id) : false;
    actionButton.textContent = joined ? "참여 완료" : "일정 참여";
    actionButton.disabled = joined;
  }
  if (!container) return;
  if (!participants.length) {
    container.style.display = "none";
    container.innerHTML = "";
    return;
  }
  container.style.display = "block";
  container.innerHTML = `
    <div class="schedule-participant-list">
      <strong>참여인원:</strong>
      ${participants.map((p) => `<span>${p.user.name}</span>`).join(", ")}
    </div>
  `;
}

function bindScheduleButtons() {
  document.querySelectorAll(".schedule-join-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const scheduleId = Number(button.dataset.scheduleId);
      if (!authToken()) {
        setView("login");
        return;
      }
      button.disabled = true;
      button.textContent = "신청중...";
      try {
        await api(`/api/schedules/${scheduleId}/join`, { method: "POST" });
        const participants = await loadScheduleParticipants(scheduleId);
        renderScheduleParticipants(scheduleId, participants);
        button.textContent = "참여 완료";
      } catch (err) {
        button.textContent = "일정 참여";
        button.disabled = false;
        alert(err.message || "일정 참여 중 오류가 발생했습니다.");
      }
    });
  });
}

function renderChatRooms(meetings) {
  if (!authToken()) {
    chatRoomListView.innerHTML = '<div class="empty-panel">로그인하면 참여한 모임의 채팅방을 이용할 수 있습니다.</div>';
    return;
  }
  
  if (meetings.length === 0) {
    chatRoomListView.innerHTML = '<div class="empty-panel">참여한 모임이 없습니다.</div>';
    return;
  }

  chatRoomListView.innerHTML = meetings
    .map(
      (meeting) => `
        <button class="chat-room" data-room="${meeting.id}">
          <span class="thumb"></span>
          <div>
            <strong>${meeting.title}</strong>
            <small>${meeting.category} · ${formatDate(meeting.start_at)}</small>
          </div>
        </button>
      `,
    )
    .join("");
  
  document.querySelectorAll(".chat-room").forEach((button) => {
    button.addEventListener("click", () => {
      const roomId = Number(button.dataset.room);
      const roomTitle = button.querySelector("strong").textContent;
      enterChatRoom(roomId, roomTitle);
    });
  });
}

function enterChatRoom(roomId, roomTitle) {
  activeRoomId = roomId;
  chatRoomTitle.textContent = roomTitle;
  setView("chatRoom");
  connectChat(roomId);
}

async function loadMyMeetings() {
  if (!authToken()) return [];
  try {
    return await api("/api/my-meetings");
  } catch {
    return [];
  }
}

async function loadMyMeetingView() {
  if (!myMeetingList) return;
  if (!authToken()) {
    myMeetingList.innerHTML = '<div class="empty-panel">로그인 후 내 모임 목록을 확인할 수 있습니다.</div>';
    cachedMyMeetings = [];
    return;
  }
  const meetings = await loadMyMeetings();
  cachedMyMeetings = meetings;
  renderMyMeetings(meetings);
}

function renderMyMeetings(meetings) {
  if (!myMeetingList) return;
  myMeetingList.innerHTML = meetings.length
    ? meetings.map((meeting, index) => meetingCard(meeting, index, true)).join("")
    : '<div class="empty-panel">참여 중인 모임이나 내가 만든 모임이 없습니다.</div>';
  bindMeetingCards();
}

function renderCalendarGrid() {
  if (!calendarGrid || !calendarMonthLabel) return;

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();

  const monthLabel = `${currentYear}. ${String(currentMonth + 1).padStart(2, "0")}`;
  calendarMonthLabel.textContent = monthLabel;

  const firstDay = new Date(currentYear, currentMonth, 1);
  const lastDay = new Date(currentYear, currentMonth + 1, 0);
  const startOffset = firstDay.getDay();

  const cells = [];
  for (let i = 0; i < startOffset; i += 1) {
    cells.push('<button type="button" aria-hidden="true"></button>');
  }

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const isToday = day === today.getDate();
    cells.push(`<button type="button" class="${isToday ? "active-day" : ""}">${day}</button>`);
  }

  calendarGrid.innerHTML = ['<span>일</span>','<span>월</span>','<span>화</span>','<span>수</span>','<span>목</span>','<span>금</span>','<span>토</span>', ...cells].join('');
}

function renderMeetingDetail(meeting) {
  const initial = meeting.title.trim().slice(0, 1).toUpperCase();
  const ownerId = meeting.owner?.id;
  const isOwner = Boolean(currentUser && ownerId != null && ownerId === currentUser.id);
  const isFull = meeting.approved_members >= meeting.max_members;
  meetingDetail.innerHTML = `
    <div class="detail-hero">${initial}</div>
    <div>
      <span class="meeting-chip">${meeting.category}</span>
      ${isFull ? '<span class="meeting-chip" style="background:rgba(244,63,94,0.85);">마감</span>' : ''}
      <h2>${meeting.title}</h2>
    </div>
    <p>${meeting.description}</p>
    <div class="meeting-meta">
      <span>장소 ${meeting.location}</span>
      <span>일정 ${formatDate(meeting.start_at)}</span>
      <span>참여 ${meeting.approved_members}/${meeting.max_members}명</span>
    </div>
    ${isOwner ? `
      <div class="detail-actions">
        <button class="detail-action-button" type="button" id="editMeetingButton" data-id="${meeting.id}">✏️ 모임 수정</button>
        <button class="detail-action-button" type="button" id="manageMembersButton" data-id="${meeting.id}">👥 참여인원 관리</button>
        <button class="detail-action-button detail-action-button-danger" type="button" id="deleteMeetingButton" data-id="${meeting.id}">🗑️ 모임 삭제</button>
      </div>
    ` : `
      ${!isFull ? '<button class="primary-button" type="button" id="applyMeetingButton">참여 신청</button>' : '<button class="primary-button" type="button" disabled style="background:#94a3b8;">모집 마감</button>'}
    `}
    <p class="status-text" id="applyStatus"></p>
    <div id="membersList"></div>
    <div id="publicMembersList"></div>
  `;
  
  if (isOwner) {
    document.querySelector("#editMeetingButton")?.addEventListener("click", () => {
      const mid = Number(document.querySelector("#editMeetingButton").dataset.id);
      loadEditMeeting(mid, meeting);
    });
    document.querySelector("#manageMembersButton")?.addEventListener("click", async () => {
      const meetingId = Number(document.querySelector("#manageMembersButton").dataset.id);
      await loadMembers(meetingId);
    });
    document.querySelector("#deleteMeetingButton")?.addEventListener("click", async () => {
      const meetingId = Number(document.querySelector("#deleteMeetingButton").dataset.id);
      if (!confirm("정말 이 모임을 삭제하시겠습니까?")) return;
      try {
        await api(`/api/meetings/${meetingId}`, { method: "DELETE" });
        viewHistory = [];
        await loadMeetings();
        setView("meetings");
      } catch (error) {
        alert(error.message);
      }
    });
  }

  const scheduleForm = document.querySelector("#meetingScheduleForm");
  if (meetingScheduleSection) {
    meetingScheduleSection.style.display = "block";
  }
  if (scheduleForm) {
    scheduleForm.style.display = isOwner ? "grid" : "none";
    document.querySelector("#meetingScheduleStatus").textContent = "";
  }

  api(`/api/meetings/${meeting.id}/members/all`).then((members) => {
    const el = document.querySelector("#publicMembersList");
    if (el && members.length) {
      el.innerHTML = `<div style="padding:10px 0;"><strong style="font-size:13px;">참여인원 ${members.length}명</strong><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">${members
        .map(
          (m) => `<span style="background:var(--primary-light);color:var(--primary);padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;">${m.user.name}</span>`,
        )
        .join("")}</div></div>`;
    }
  }).catch(() => {});

  document.querySelector("#applyMeetingButton")?.addEventListener("click", async () => {
    const status = document.querySelector("#applyStatus");
    if (!authToken()) {
      status.textContent = "로그인 후 참여 신청할 수 있습니다.";
      setView("login");
      return;
    }
    try {
      await api(`/api/meetings/${meeting.id}/apply`, {
        method: "POST",
        body: JSON.stringify({ message: "참여하고 싶어요." }),
      });
      status.textContent = "참여 신청이 완료되었습니다. 모임장 승인을 기다려주세요.";
    } catch (error) {
      status.textContent = error.message;
    }
  });

  loadMeetingSchedules(meeting.id).then(renderMeetingSchedules);

  const scheduleFormEl = document.querySelector("#meetingScheduleForm");
  if (scheduleFormEl) {
    scheduleFormEl.onsubmit = async (e) => {
      e.preventDefault();
      if (!authToken()) { setView("login"); return; }
      const fd = new FormData(scheduleFormEl);
      const scheduleStatus = document.querySelector("#meetingScheduleStatus");
      try {
        await api(`/api/meetings/${meeting.id}/schedules`, {
          method: "POST",
          body: JSON.stringify({
            location: fd.get("location"),
            scheduled_at: new Date(fd.get("scheduled_at")).toISOString(),
            activity: fd.get("activity"),
            capacity: Number(fd.get("capacity")),
            settings: fd.get("settings"),
          }),
        });
        scheduleFormEl.reset();
        scheduleStatus.textContent = "일정이 추가되었습니다.";
        await loadMeetingSchedules(meeting.id).then(renderMeetingSchedules);
      } catch (err) {
        scheduleStatus.textContent = err.message;
      }
    };
  }

  setView("detail");
}

async function loadMembers(meetingId) {
  try {
    const members = await api(`/api/meetings/${meetingId}/members`);
    const membersList = document.querySelector("#membersList");
    membersList.innerHTML = `
      <h3>참여 인원 목록</h3>
      ${members.map(member => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #eee;">
          <span>${member.user.name} (${member.user.email})</span>
          ${member.user.id !== currentUser.id ? `
            <button onclick="removeMember(${meetingId}, ${member.user.id})" style="background: #dc2626; color: white; padding: 5px 10px; border: none; border-radius: 4px; cursor: pointer;">강퇴</button>
          ` : '<span style="color: #22b496;">모임장</span>'}
        </div>
      `).join("")}
    `;
  } catch (error) {
    alert(error.message);
  }
}

window.removeMember = async function(meetingId, userId) {
  if (!confirm("정말 이 참여자를 강퇴하시겠습니까?")) return;
  try {
    await api(`/api/meetings/${meetingId}/members/${userId}`, { method: "DELETE" });
    alert("참여자가 강퇴되었습니다.");
    await loadMembers(meetingId);
    await loadMeetings();
  } catch (error) {
    alert(error.message);
  }
}

async function loadRecommendations() {
  if (!authToken()) {
    return null;
  }
  try {
    return await api("/api/meetings/recommendations");
  } catch {
    return null;
  }
}

async function loadMeetings() {
  try {
    cachedMeetings = await api("/api/meetings");
    cachedRecommendations = (await loadRecommendations()) || [];
    renderMeetings(cachedMeetings);
    renderMeetingPage(cachedMeetings);
    const myMeetings = await loadMyMeetings();
    renderChatRooms(myMeetings);
  } catch (error) {
    meetingList.innerHTML = `<div class="meeting-item"><h3>불러오기 실패</h3><p>${error.message}</p></div>`;
  }
}

async function loadChatView() {
  const myMeetings = await loadMyMeetings();
  renderChatRooms(myMeetings);
}

async function loadMeetingPage() {
  if (!cachedMeetings.length) {
    await loadMeetings();
    return;
  }
  const keyword = meetingSearch?.value.trim().toLowerCase() || "";
  const searchLocation = document.querySelector("#locationSearch")?.value.trim().toLowerCase() || "";
  const activeRegion = searchLocation || getUserRegion().toLowerCase();
  const filtered = cachedMeetings.filter((meeting) => {
    const matchKeyword = !keyword || [meeting.title, meeting.category, meeting.description, meeting.location].join(" ").toLowerCase().includes(keyword);
    const matchLocation = !activeRegion || meeting.location.toLowerCase().includes(activeRegion);
    return matchKeyword && matchLocation;
  });
  renderMeetingPage(filtered);
}

function connectNotifySocket() {
  if (!authToken()) return;
  if (notifySocket) notifySocket.close();
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  notifySocket = new WebSocket(`${protocol}://${window.location.host}/ws/notify?token=${encodeURIComponent(authToken())}`);
  notifySocket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    notifications.unshift(payload);
    document.querySelector("#notifyBadge").style.display = "block";
    showToast(payload.message);
  });
  notifySocket.addEventListener("close", () => {
    setTimeout(() => { if (authToken()) connectNotifySocket(); }, 3000);
  });
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.textContent = message;
  toast.style.cssText = `position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:12px 20px;border-radius:12px;font-size:13px;font-weight:700;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.3);max-width:320px;text-align:center;`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function renderNotifications() {
  const list = document.querySelector("#notificationList");
  document.querySelector("#notifyBadge").style.display = "none";
  list.innerHTML = notifications.length
    ? notifications.map(n => `
        <article class="application-item">
          <span class="thumb" style="background:linear-gradient(135deg,var(--primary),#8b5cf6);"></span>
          <div>
            <small>${n.type === 'approved' ? '승인' : n.type === 'rejected' ? '거절' : '신청'}</small>
            <p>${n.message}</p>
          </div>
        </article>`).join("")
    : '<div class="empty-panel">알림이 없습니다.</div>';
}

document.querySelector("#notifyButton").addEventListener("click", () => setView("notifications"));

function loadEditMeeting(meetingId, meeting) {
  meetingDetail.innerHTML = `
    <form id="editMeetingForm" class="form-screen">
      <label>모임명<input name="title" value="${meeting.title}" required /></label>
      <label>소개<textarea name="description" required>${meeting.description}</textarea></label>
      <label>장소<input name="location" value="${meeting.location}" required /></label>
      <label>최대 인원<input name="max_members" type="number" min="2" value="${meeting.max_members}" required /></label>
      <button class="primary-button" type="submit">저장</button>
      <p id="editMeetingStatus" class="status-text"></p>
    </form>
  `;
  document.querySelector("#editMeetingForm").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await api(`/api/meetings/${meetingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: fd.get("title"),
          description: fd.get("description"),
          location: fd.get("location"),
          max_members: Number(fd.get("max_members")),
        }),
      });
      await loadMeetings();
      viewHistory.pop();
      setView("meetings");
    } catch (err) {
      document.querySelector("#editMeetingStatus").textContent = err.message;
    }
  };
}

async function loadMyApplications() {
  const list = document.querySelector("#myApplicationList");
  if (!authToken()) {
    list.innerHTML = '<div class="empty-panel">로그인 후 확인할 수 있습니다.</div>';
    return;
  }
  try {
    const apps = await api("/api/applications/my");
    list.innerHTML = apps.length
      ? apps.map(a => `
        <article class="application-item">
          <span class="thumb"></span>
          <div>
            <small>${a.meeting_title}</small>
            <h3>${a.meeting_title}</h3>
            <p>${a.message || '신청 메시지 없음'}</p>
            <span style="display:inline-block;margin-top:6px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;background:${
              a.status === 'approved' ? '#d1fae5' : a.status === 'rejected' ? '#fee2e2' : '#e0e7ff'
            };color:${
              a.status === 'approved' ? '#059669' : a.status === 'rejected' ? '#f43f5e' : '#6366f1'
            };">${applicationStatusLabel(a.status)}</span>
          </div>
        </article>`).join("")
      : '<div class="empty-panel">신청한 모임이 없습니다.</div>';
  } catch (e) {
    list.innerHTML = `<div class="empty-panel">${e.message}</div>`;
  }
}

// 도/시 데이터
const KOREA_REGIONS = {
  "서울": ["강남구", "강동구", "강북구", "강서구", "관악구", "광진구", "구로구", "금천구", "노원구", "도봉구", "동대문구", "동작구", "마포구", "서대문구", "서초구", "성동구", "성북구", "송파구", "양천구", "영등포구", "용산구", "은평구", "종로구", "중구", "중랑구"],
  "부산": ["강서구", "금정구", "기장군", "남구", "동구", "동래구", "부산진구", "북구", "사상구", "사하구", "서구", "수영구", "연제구", "영도구", "중구", "해운대구"],
  "대구": ["군위군", "남구", "달서구", "달성군", "동구", "북구", "서구", "수성구", "중구"],
  "인천": ["강화군", "계양구", "남동구", "동구", "미추홀구", "부개구", "서구", "연수구", "옹진군", "중구"],
  "광주": ["광산구", "남구", "동구", "북구", "서구"],
  "대전": ["대덕구", "동구", "서구", "유성구", "중구"],
  "울산": ["남구", "동구", "북구", "울주군", "중구"],
  "세종": ["세종시"],
  "경기": ["수원시", "성남시", "고양시", "용인시", "부천시", "안산시", "안양시", "남양주시", "화성시", "평택시", "의정부시", "시흥시", "파주시", "김포시", "광주시", "광명시", "군포시", "하남시", "오산시", "양주시", "이천시", "구리시", "안성시", "포천시", "의왕시", "양평군", "여주시", "동두천시", "과천시", "가평군", "연천군"],
  "강원": ["춘천시", "원주시", "강릉시", "동해시", "태백시", "속초시", "삼척시", "홍천군", "횡성군", "영월군", "평창군", "정선군", "철원군", "화천군", "양구군", "인제군", "고성군", "양양군"],
  "충북": ["청주시", "충주시", "제천시", "보은군", "옥천군", "영동군", "증평군", "진천군", "괴산군", "음성군", "단양군"],
  "충남": ["천안시", "공주시", "보령시", "아산시", "서산시", "논산시", "계룡시", "당진시", "금산군", "부여군", "서천군", "청양군", "홍성군", "예산군", "태안군"],
  "전북": ["전주시", "군산시", "익산시", "정읍시", "남원시", "김제시", "완주군", "진안군", "무주군", "장수군", "임실군", "순창군", "고창군", "부안군"],
  "전남": ["목포시", "여수시", "순천시", "나주시", "광양시", "담양군", "곡성군", "구례군", "고흥군", "보성군", "화순군", "장흥군", "강진군", "해남군", "영암군", "무안군", "함평군", "영광군", "장성군", "완도군", "진도군", "신안군"],
  "경북": ["포항시", "경주시", "김천시", "안동시", "구미시", "영주시", "영천시", "상주시", "문경시", "경산시", "의성군", "청송군", "영양군", "영덕군", "청도군", "고령군", "성주군", "칠곡군", "예천군", "봉화군", "울진군", "울릉군"],
  "경남": ["창원시", "진주시", "통영시", "사천시", "김해시", "밀양시", "거제시", "양산시", "의령군", "함안군", "창녕군", "고성군", "남해군", "하동군", "산청군", "함양군", "거창군", "합천군"],
  "제주": ["제주시", "서귀포시"]
};

// 도/시 캐스케이드 선택 초기화
function initRegionSelect() {
  const provinceSelect = document.querySelector("#provinceSelect");
  const citySelect = document.querySelector("#citySelect");
  const regionInput = document.querySelector("#regionInput");

  if (!provinceSelect || !citySelect) return;

  provinceSelect.addEventListener("change", () => {
    const province = provinceSelect.value;
    citySelect.innerHTML = '<option value="">시/군/구 선택</option>';
    regionInput.value = province;

    if (province && KOREA_REGIONS[province]) {
      citySelect.disabled = false;
      KOREA_REGIONS[province].forEach(city => {
        const option = document.createElement("option");
        option.value = city;
        option.textContent = city;
        citySelect.appendChild(option);
      });
    } else {
      citySelect.disabled = true;
    }
  });

  citySelect.addEventListener("change", () => {
    const province = provinceSelect.value;
    const city = citySelect.value;
    if (province && city) {
      regionInput.value = `${province} ${city}`;
    } else if (province) {
      regionInput.value = province;
    }
  });
}

// 저장된 지역값으로 도/시 선택 복원
function setRegionSelectValue(savedRegion) {
  const provinceSelect = document.querySelector("#provinceSelect");
  const citySelect = document.querySelector("#citySelect");
  const regionInput = document.querySelector("#regionInput");

  if (!provinceSelect || !savedRegion) return;

  // 저장된 값에서 도와 시 추출 (예: "서울 강남구" 또는 "경기 수원시")
  const parts = savedRegion.split(" ");
  const province = parts[0];
  const city = parts.slice(1).join(" ");

  // 도 선택
  provinceSelect.value = province;
  regionInput.value = savedRegion;

  if (province && KOREA_REGIONS[province]) {
    // 시/군/구 옵션 생성
    citySelect.innerHTML = '<option value="">시/군/구 선택</option>';
    citySelect.disabled = false;
    KOREA_REGIONS[province].forEach(cityName => {
      const option = document.createElement("option");
      option.value = cityName;
      option.textContent = cityName;
      citySelect.appendChild(option);
    });
    // 시 선택 (있으면)
    if (city) {
      citySelect.value = city;
    }
  }
}

async function loadEditProfile() {
  if (!currentUser) return;
  const form = document.querySelector("#editProfileForm");
  form.name.value = currentUser.name || '';
  form.bio.value = currentUser.bio || '';
  // 관심 분야 3개 드롭다운 설정
  const interest1Select = document.querySelector("#interest1Select");
  const interest2Select = document.querySelector("#interest2Select");
  const interest3Select = document.querySelector("#interest3Select");
  if (currentUser.interests && currentUser.interests.length > 0) {
    const userInterests = currentUser.interests.map(i => i.name);
    if (interest1Select) interest1Select.value = userInterests[0] || "";
    if (interest2Select) interest2Select.value = userInterests[1] || "";
    if (interest3Select) interest3Select.value = userInterests[2] || "";
  }
  // 도/시 캐스케이드 선택 초기화 및 값 설정
  initRegionSelect();
  setRegionSelectValue(getUserRegion());
}

document.querySelector("#editProfileForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const statusEl = document.querySelector("#editProfileStatus");
  try {
    const region = setUserRegion(fd.get("region") || "");
    // 3개 드롭다운에서 선택된 값들 가져오기 (중복 제거, 빈값 제거)
    const selectedInterests = [fd.get("interest1"), fd.get("interest2"), fd.get("interest3")]
      .filter((v, i, arr) => v && arr.indexOf(v) === i) // 빈값 제거 + 중복 제거
      .map(name => ({ name }));
    currentUser = await api("/api/users/me", {
      method: "PATCH",
      body: JSON.stringify({
        name: fd.get("name"),
        bio: fd.get("bio"),
        interests: selectedInterests,
      }),
    });
    updateProfile();
    const locationSearch = document.querySelector("#locationSearch");
    if (locationSearch) {
      locationSearch.value = region;
    }
    await loadMeetings();
    if (document.querySelector("#meetings")?.classList.contains("active")) {
      await loadMeetingPage();
    }
    statusEl.textContent = "저장되었습니다.";
  } catch (err) {
    statusEl.textContent = err.message;
  }
});

document.querySelector("#logoutButton")?.addEventListener("click", () => {
  localStorage.removeItem(tokenKey);
  currentUser = null;
  updateProfile();
  loadMeetings();
  setView("home");
});

async function loadMyPosts() {
  const myPostList = document.querySelector("#myPostList");
  const myPostsCount = document.querySelector("#myPostsCount");
  const deleteBtn = document.querySelector("#deleteSelectedPosts");
  if (!authToken()) {
    myPostList.innerHTML = '<div class="empty-panel">로그인 후 확인할 수 있습니다.</div>';
    return;
  }
  try {
    const posts = await api("/api/my-posts");
    myPostsCount.textContent = `${posts.length}개의 글`;
    if (posts.length === 0) {
      myPostList.innerHTML = '<div class="empty-panel">작성한 게시글이 없습니다.</div>';
      deleteBtn.style.display = "none";
      return;
    }
    deleteBtn.style.display = "block";
    myPostList.innerHTML = posts.map(post => `
      <article class="post-item" style="position: relative;">
        <label style="position: absolute; top: 12px; right: 12px; cursor: pointer;">
          <input type="checkbox" class="post-checkbox" data-post-id="${post.id}" style="width: 18px; height: 18px; accent-color: var(--primary);">
        </label>
        <span class="thumb"></span>
        <div>
          <small>${post.meeting_title || '일반 게시판'} · ${formatDate(post.created_at)}</small>
          <h3>${post.title}</h3>
          <p>${post.content}</p>
        </div>
      </article>
    `).join("");

    deleteBtn.onclick = async () => {
      const checked = [...document.querySelectorAll(".post-checkbox:checked")];
      if (checked.length === 0) { alert("삭제할 게시글을 선택해주세요."); return; }
      if (!confirm(`${checked.length}개의 게시글을 삭제하시겠습니까?`)) return;
      await Promise.all(checked.map(cb => api(`/api/posts/${cb.dataset.postId}`, { method: "DELETE" })));
      await loadMyPosts();
    };
  } catch (error) {
    myPostList.innerHTML = `<div class="empty-panel">${error.message}</div>`;
  }
}

function applicationStatusLabel(status) {
  if (status === "approved") return "승인됨";
  if (status === "rejected") return "거절됨";
  return "대기중";
}

async function decideApplication(applicationId, status) {
  await api(`/api/applications/${applicationId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  await loadApplications();
  await loadMeetings();
}

async function loadApplications() {
  if (!applicationList) return;
  if (!authToken()) {
    applicationList.innerHTML = '<div class="empty-panel">로그인하면 내가 만든 모임의 신청 알림이 표시됩니다.</div>';
    return;
  }

  try {
    const applications = await api("/api/applications/inbox");
    applicationList.innerHTML = applications.length
      ? applications
          .map(
            (application) => `
              <article class="application-item">
                <span class="thumb"></span>
                <div>
                  <small>${application.meeting_title} · ${applicationStatusLabel(application.status)}</small>
                  <h3>${application.user.name}님의 참여 신청</h3>
                  <p>${application.message || "참여 신청 메시지가 없습니다."}</p>
                  ${
                    application.status === "pending"
                      ? `<div class="application-actions">
                          <button data-application-id="${application.id}" data-decision="approved">승인</button>
                          <button data-application-id="${application.id}" data-decision="rejected">거절</button>
                        </div>`
                      : ""
                  }
                </div>
              </article>
            `,
          )
          .join("")
      : '<div class="empty-panel">아직 들어온 참여 신청이 없습니다.</div>';

    applicationList.querySelectorAll("[data-application-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        await decideApplication(button.dataset.applicationId, button.dataset.decision);
      });
    });
  } catch (error) {
    applicationList.innerHTML = `<div class="empty-panel">${error.message}</div>`;
  }
}

async function loadCalendar() {
  if (!authToken()) {
    calendarList.innerHTML = '<div class="empty-panel">로그인하면 내가 속한 모임의 일정을 확인할 수 있습니다.</div>';
    return;
  }
  try {
    const meetings = await api("/api/calendar");
    calendarList.innerHTML = meetings.length
      ? meetings
          .map(
            (meeting) => `
              <article class="calendar-item">
                <time>${formatDate(meeting.start_at)}</time>
                <div>
                  <h3>${meeting.title}</h3>
                  <p>${meeting.category} · ${meeting.location}</p>
                </div>
                <strong>${meeting.approved_members}/${meeting.max_members}</strong>
              </article>
            `,
          )
          .join("")
      : '<div class="empty-panel">내가 속한 모임의 일정이 없습니다.</div>';
  } catch (error) {
    calendarList.innerHTML = `<div class="empty-panel">${error.message}</div>`;
  }
}

function addChatMessage(sender, content, mine = false, time = null) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${mine ? "mine" : ""}`;
  const timeStr = time ? formatTime(time) : formatTime(new Date());
  bubble.innerHTML = `<strong>${sender}</strong><p>${content}</p><span class="chat-time">${timeStr}</span>`;
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function loadChatHistory(roomId) {
  try {
    const messages = await api(`/api/meetings/${roomId}/messages`);
    chatMessages.innerHTML = "";
    messages.forEach((message) => {
      addChatMessage(
        message.sender?.name || "참여자",
        message.content,
        currentUser?.id === message.sender?.id,
        message.sent_at || message.created_at
      );
    });
  } catch {
    chatMessages.innerHTML = "";
  }
}

async function connectChat(roomId) {
  if (chatSocket) chatSocket.close();
  activeRoomId = roomId;
  chatMessages.innerHTML = "";
  if (!authToken()) {
    chatState.textContent = "로그인 필요";
    addChatMessage("이음", "로그인하면 팀원들과 실시간 채팅할 수 있습니다.");
    return;
  }

  chatState.textContent = "연결 중";
  await loadChatHistory(roomId);

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  chatSocket = new WebSocket(
    `${protocol}://${window.location.host}/ws/meetings/${roomId}/chat?token=${encodeURIComponent(authToken())}`,
  );
  chatSocket.addEventListener("open", () => {
    chatState.textContent = "연결됨";
  });
  chatSocket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    addChatMessage(payload.sender || "참여자", payload.content || "", payload.sender === currentUser?.name, payload.sent_at);
  });
  chatSocket.addEventListener("close", () => {
    chatState.textContent = "연결 종료";
  });
}

viewTriggers.forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

document.querySelector("#refreshApplications")?.addEventListener("click", loadApplications);
meetingSearch?.addEventListener("input", loadMeetingPage);
document.querySelector("#locationSearch")?.addEventListener("input", loadMeetingPage);

calendarPrev?.addEventListener("click", () => {
  // 현재는 날짜 기준 고정 캘린더이므로 변화 없음
});
calendarNext?.addEventListener("click", () => {
  // 현재는 날짜 기준 고정 캘린더이므로 변화 없음
});

navButtons.forEach((button) => {
  if (button.dataset.view === "home") {
    button.addEventListener("click", () => {
      loadMeetings();
    });
  }
});

document.querySelector("#signupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const status = document.querySelector("#authStatus");
  try {
    // 3개 드롭다운에서 선택된 값들 가져오기 (중복 제거, 빈값 제거)
    const selectedInterests = [form.get("interest1"), form.get("interest2"), form.get("interest3")]
      .filter((v, i, arr) => v && arr.indexOf(v) === i) // 빈값 제거 + 중복 제거
      .map(name => ({ name }));
    await api("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        email: form.get("email"),
        password: form.get("password"),
        bio: form.get("bio"),
        interests: selectedInterests,
      }),
    });
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: form.get("email"),
        password: form.get("password"),
      }),
    });
    localStorage.setItem(tokenKey, data.access_token);
    currentUser = await api("/api/users/me");
    updateProfile();
    status.textContent = "회원가입과 로그인이 완료되었습니다.";
    formElement.reset();
    await loadMeetings();
    await loadApplications();
    setView("home");
  } catch (error) {
    status.textContent = error.message;
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.querySelector("#loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const status = document.querySelector("#authStatus");
      try {
        const data = await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email: form.get("email"),
            password: form.get("password"),
          }),
        });
        localStorage.setItem(tokenKey, data.access_token);
        currentUser = await api("/api/users/me");
        status.textContent = "로그인되었습니다. 홈 화면으로 이동합니다...";
        // 홈 화면으로 새로고침
        window.location.href = "/";
      } catch (error) {
        status.textContent = error.message;
      }
    });
  }
});

recommendPlaceButton?.addEventListener("click", loadPlaceRecommendations);

document.querySelectorAll(".place-result-tab[data-result-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".place-result-tab[data-result-tab]").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const target = tab.dataset.resultTab;
    const listPane = document.querySelector("#resultPaneList");
    const mapPane = document.querySelector("#resultPaneMap");
    if (target === "list") {
      if (listPane) listPane.hidden = false;
      if (mapPane) mapPane.hidden = true;
    } else {
      if (listPane) listPane.hidden = true;
      if (mapPane) mapPane.hidden = false;
      // 지도 탭 클릭 후 CSS가 완전히 반영된 후 relayout 실행
      if (placeMap && window.kakao?.maps) {
        // 브라우저가 컨테이너를 먼저 렌더링하도록 두 번의 requestAnimationFrame 사용
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(function() {
              if (placeMap && window.kakao?.maps) {
                // 컨테이너 크기 재조정
                placeMap.relayout();
                // 현재 선택된 장소 좌표로 중심 재설정
                const activeTab = document.querySelector("#placeMapTabs .active");
                const activeIndex = activeTab ? parseInt(activeTab.dataset.mapTabIndex || 0) : 0;
                const place = placeMapPlaces[activeIndex];
                if (place) {
                  const coords = new window.kakao.maps.LatLng(place.latitude, place.longitude);
                  placeMap.setCenter(coords);
                }
                // resize 이벤트 트리거로 추가 안정화
                window.kakao.maps.event.trigger(placeMap, 'resize');
              }
            }, 300);
          });
        });
      }
    }
  });
});

// 모임 폼 지역 선택 초기화
function initMeetingRegionSelect() {
  const provinceSelect = document.querySelector("#meetingProvinceSelect");
  const citySelect = document.querySelector("#meetingCitySelect");
  const regionInput = document.querySelector("#meetingRegionInput");
  
  if (!provinceSelect || !citySelect) return;
  
  // 사용자 저장된 지역으로 기본값 설정
  const savedRegion = getUserRegion();
  if (savedRegion) {
    const parts = savedRegion.split(" ");
    if (parts.length >= 2) {
      provinceSelect.value = parts[0];
      // 시/군/구 옵션 생성
      citySelect.innerHTML = '<option value="">시/군/구 선택</option>';
      citySelect.disabled = false;
      if (KOREA_REGIONS[parts[0]]) {
        KOREA_REGIONS[parts[0]].forEach(city => {
          const option = document.createElement("option");
          option.value = city;
          option.textContent = city;
          citySelect.appendChild(option);
        });
        citySelect.value = parts.slice(1).join(" ");
      }
      regionInput.value = savedRegion;
    }
  }
  
  provinceSelect.addEventListener("change", () => {
    const province = provinceSelect.value;
    citySelect.innerHTML = '<option value="">시/군/구 선택</option>';
    regionInput.value = province;
    
    if (province && KOREA_REGIONS[province]) {
      citySelect.disabled = false;
      KOREA_REGIONS[province].forEach(city => {
        const option = document.createElement("option");
        option.value = city;
        option.textContent = city;
        citySelect.appendChild(option);
      });
    } else {
      citySelect.disabled = true;
    }
  });
  
  citySelect.addEventListener("change", () => {
    const province = provinceSelect.value;
    const city = citySelect.value;
    if (province && city) {
      regionInput.value = `${province} ${city}`;
    } else if (province) {
      regionInput.value = province;
    }
  });
}

// 모임 생성 뷰 열 때 지역 선택 초기화
document.querySelectorAll('[data-view="create"]').forEach(btn => {
  btn.addEventListener("click", () => {
    initMeetingRegionSelect();
  });
});

document.querySelector("#meetingForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const status = document.querySelector("#meetingStatus");
  if (!authToken()) {
    status.textContent = "로그인 후 모임을 만들 수 있습니다.";
    setView("login");
    return;
  }
  const category = formData.get("category");
  if (!category) {
    status.textContent = "카테고리를 선택해주세요.";
    return;
  }
  
  // 지역 확인
  const region = formData.get("region");
  if (!region) {
    status.textContent = "지역을 선택해주세요.";
    return;
  }
  
  try {
    await api("/api/meetings", {
      method: "POST",
      body: JSON.stringify({
        title: formData.get("title"),
        description: formData.get("description"),
        category: category,
        location: `${region} ${formData.get("location")}`,
        max_members: Number(formData.get("max_members")),
        start_at: new Date().toISOString(), // 현재 시간으로 설정
      }),
    });
    status.textContent = "모임이 등록되었습니다.";
    form.reset();
    await loadMeetings();
    setView("meetings");
  } catch (error) {
    status.textContent = error.message;
  }
});

document.querySelector("#chatForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const content = form.get("content");
  if (!authToken()) {
    addChatMessage("이음", "로그인 후 채팅할 수 있습니다.");
    return;
  }
  if (!content || !chatSocket || chatSocket.readyState !== WebSocket.OPEN) return;
  chatSocket.send(JSON.stringify({ content }));
  event.currentTarget.reset();
});

function updateProfile() {
  document.querySelector("#profileName").textContent = currentUser?.name || "게스트";
  document.querySelector("#profileEmail").textContent = currentUser?.email || "로그인 후 추천을 받을 수 있어요.";
  const region = getUserRegion();
  document.querySelector("#profileRegion").textContent = region ? `내 지역: ${region}` : "지역 설정을 추가해 주세요.";
}

async function restoreSession() {
  if (!authToken()) {
    updateProfile();
    await loadMeetings();
    return;
  }
  try {
    currentUser = await api("/api/users/me");
  } catch {
    localStorage.removeItem(tokenKey);
    currentUser = null;
  }
  updateProfile();
  await loadMeetings();
  await loadApplications();
  connectNotifySocket();
}

restoreSession();
renderCalendarGrid();

document.querySelector("#backButton").style.visibility = "hidden";

// 채팅방 장소 추천

let chatRecommendMap = null;
let chatRecommendMarkers = [];
let chatRecommendInfoWindows = [];
let chatRecommendPlaces = [];
let currentMeetingInfo = null;

// DOM 요소
const aiRecommendModal = document.querySelector("#aiRecommendModal");
const aiRecommendButton = document.querySelector("#aiRecommendButton");
const closeAiRecommendModal = document.querySelector("#closeAiRecommendModal");
const chatRecommendMapPanel = document.querySelector("#chatRecommendMapPanel");
const chatRecommendList = document.querySelector("#chatRecommendList");
const chatPlusButton = document.querySelector("#chatPlusButton");
const chatPlusMenu = document.querySelector("#chatPlusMenu");
const plusMenuRecommend = document.querySelector("#plusMenuRecommend");

// 장소 추천 버튼 클릭
aiRecommendButton?.addEventListener("click", () => {
  openAiRecommendModal();
});

// + 버튼 클릭
chatPlusButton?.addEventListener("click", () => {
  chatPlusMenu.style.display = chatPlusMenu.style.display === "none" ? "block" : "none";
});

// + 메뉴 - 장소 추천 클릭
plusMenuRecommend?.addEventListener("click", () => {
  chatPlusMenu.style.display = "none";
  openAiRecommendModal();
});

// 모달 닫기
closeAiRecommendModal?.addEventListener("click", () => {
  closeAiRecommendModalFn();
});

// 모달 백드롭 클릭
aiRecommendModal?.querySelector(".ai-recommend-modal-backdrop")?.addEventListener("click", () => {
  closeAiRecommendModalFn();
});


// 모달 열기
async function openAiRecommendModal() {
  if (!activeRoomId) {
    alert("채팅방에 먼저 입장해주세요.");
    return;
  }
  
  aiRecommendModal.style.display = "flex";
  document.body.style.overflow = "hidden";
  
  // 모임 정보 로드
  await loadMeetingInfo();
  
  // 추천 로드
  await loadAiRecommendations();
}

// 모달 닫기
function closeAiRecommendModalFn() {
  aiRecommendModal.style.display = "none";
  document.body.style.overflow = "";
  clearChatRecommendMap();
}

// 모임 정보 로드
async function loadMeetingInfo() {
  try {
    currentMeetingInfo = await api(`/api/meetings/${activeRoomId}/info`);
  } catch (error) {
    console.error("모임 정보 로드 실패:", error);
    currentMeetingInfo = null;
  }
}

// 장소 추천 로드
async function loadAiRecommendations() {
  if (!currentMeetingInfo) {
    chatRecommendList.innerHTML = '<div class="recommend-placeholder">모임 정보를 불러올 수 없습니다.</div>';
    return;
  }
  
  // 로딩 표시
  chatRecommendList.innerHTML = `
    <div class="recommend-placeholder">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin" style="animation:spin 1s linear infinite;display:block;margin:0 auto 10px;">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>
      AI가 장소를 추천하는 중...
    </div>
  `;
  
  // 지도 초기화
  initChatRecommendMap();
  
  try {
    const places = await api(`/api/place-recommendations/chatroom-recommend`, {
      method: "POST",
      body: JSON.stringify({
        meeting_id: activeRoomId,
        meeting_title: currentMeetingInfo.title,
        meeting_category: currentMeetingInfo.category,
        meeting_description: currentMeetingInfo.description,
        meeting_location: currentMeetingInfo.location,
        keywords: currentMeetingInfo.keywords || [],
        limit: Math.floor(Math.random() * 6) + 5, // 5~10개 랜덤
      }),
    });

    chatRecommendPlaces = places;
    renderChatRecommendList(places);
    renderChatRecommendMarkers(places);
    
  } catch (error) {
    chatRecommendList.innerHTML = `<div class="recommend-placeholder">추천 장소를 불러올 수 없습니다.<br>${error.message}</div>`;
  }
}

// 지도 초기화
async function initChatRecommendMap() {
  clearChatRecommendMap();
  
  chatRecommendMapPanel.innerHTML = `
    <div class="map-loading">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
      </svg>
      <span>지도를 불러오는 중...</span>
    </div>
  `;
  
  try {
    const hasSdk = await Promise.race([
      loadKakaoMapSdk(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("카카오맵 SDK 로딩 시간 초과")), 5000))
    ]);
    
    if (!hasSdk) {
      chatRecommendMapPanel.innerHTML = '<div class="map-loading">카카오맵 API 키가 설정되지 않았습니다.</div>';
      return;
    }
    
    // 모임 장소 좌표 검색
    const coords = await searchAddressCoords(currentMeetingInfo?.location || "서울");
    
    chatRecommendMapPanel.innerHTML = '<div id="chatRecommendMap" style="width:100%;height:100%;"></div>';
    
    await new Promise(resolve => requestAnimationFrame(resolve));
    
    const mapContainer = document.querySelector("#chatRecommendMap");
    chatRecommendMap = new window.kakao.maps.Map(mapContainer, {
      center: new window.kakao.maps.LatLng(coords.lat, coords.lng),
      level: 5,
    });
    
    // relayout 타이밍
    setTimeout(() => {
      if (chatRecommendMap && window.kakao?.maps) {
        chatRecommendMap.relayout();
        chatRecommendMap.setCenter(new window.kakao.maps.LatLng(coords.lat, coords.lng));
      }
    }, 200);
    
  } catch (err) {
    chatRecommendMapPanel.innerHTML = `<div class="map-loading">지도를 불러오지 못했습니다.<br>${err.message}</div>`;
  }
}

// 주소로 좌표 검색 - 모임 지역 기반
async function searchAddressCoords(address) {
  // 모임 지역 정보에서 기본 좌표 결정
  const locationStr = currentMeetingInfo?.location || "";
  const isDaejeon = locationStr.includes("대전");
  const defaultCoords = isDaejeon 
    ? { lat: 36.3504, lng: 127.3845 } // 대전 중심
    : { lat: 37.5665, lng: 126.9780 }; // 서울시청
  
  try {
    const config = await loadKakaoMapConfig();
    if (!config.javascript_key) return defaultCoords;
    
    // 주소 검색 (키워드보다 정확한 주소 검색 사용)
    const response = await fetch(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}&size=1`,
      {
        headers: { Authorization: `KakaoAK ${config.javascript_key.replace(/_js$/, '')}` }
      }
    );
    
    if (!response.ok) throw new Error("검색 실패");
    
    const data = await response.json();
    if (data.documents && data.documents.length > 0) {
      return {
        lat: parseFloat(data.documents[0].y),
        lng: parseFloat(data.documents[0].x)
      };
    }
    
    // 주소 검색 실패 시 키워드 검색 시도
    const keywordResponse = await fetch(
      `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(address)}&size=1`,
      {
        headers: { Authorization: `KakaoAK ${config.javascript_key.replace(/_js$/, '')}` }
      }
    );
    
    if (keywordResponse.ok) {
      const keywordData = await keywordResponse.json();
      if (keywordData.documents && keywordData.documents.length > 0) {
        return {
          lat: parseFloat(keywordData.documents[0].y),
          lng: parseFloat(keywordData.documents[0].x)
        };
      }
    }
    
    return defaultCoords;
  } catch (error) {
    return defaultCoords;
  }
}

// 추천 장소 마커 표시
function renderChatRecommendMarkers(places) {
  if (!chatRecommendMap || !window.kakao?.maps) return;
  
  // 기존 마커 제거 (중심 제외)
  chatRecommendMarkers.slice(1).forEach(m => m.setMap(null));
  chatRecommendInfoWindows.slice(1).forEach(i => i.close());
  chatRecommendMarkers = [chatRecommendMarkers[0]];
  chatRecommendInfoWindows = [chatRecommendInfoWindows[0]];
  
  const bounds = new window.kakao.maps.LatLngBounds();
  if (chatRecommendMarkers[0]) {
    bounds.extend(chatRecommendMarkers[0].getPosition());
  }
  
  places.forEach((place, index) => {
    const position = new window.kakao.maps.LatLng(place.latitude, place.longitude);
    
    const markerImage = new window.kakao.maps.MarkerImage(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40"><path d="M16 0C7.16 0 0 7.16 0 16c0 11 16 24 16 24s16-13 16-24C32 7.16 24.84 0 16 0z" fill="#6366f1"/><circle cx="16" cy="16" r="8" fill="white"/><text x="16" y="21" text-anchor="middle" font-size="12" font-weight="800" fill="#6366f1">${index + 1}</text></svg>`)}`,
      new window.kakao.maps.Size(32, 40),
      { offset: new window.kakao.maps.Point(16, 40) }
    );
    
    const marker = new window.kakao.maps.Marker({
      position,
      image: markerImage,
      map: chatRecommendMap
    });
    
    const infoWindow = new window.kakao.maps.InfoWindow({
      content: `<div class="map-infowindow"><strong>${place.place_name}</strong></div>`,
    });
    
    window.kakao.maps.event.addListener(marker, "click", () => {
      selectPlaceCard(index);
    });
    
    chatRecommendMarkers.push(marker);
    chatRecommendInfoWindows.push(infoWindow);
    bounds.extend(position);
  });
  
  if (places.length > 0) {
    chatRecommendMap.setBounds(bounds, 40, 40, 40, 40);
    setTimeout(() => {
      if (chatRecommendMap) {
        chatRecommendMap.relayout();
        chatRecommendMap.setBounds(bounds, 40, 40, 40, 40);
      }
    }, 300);
  }
}

// 추천 리스트 렌더링
function renderChatRecommendList(places) {
  if (!places || places.length === 0) {
    chatRecommendList.innerHTML = '<div class="recommend-placeholder">추천할 장소가 없습니다.</div>';
    return;
  }
  
  chatRecommendList.innerHTML = places.map((place, index) => `
    <article class="chat-place-card ${index === 0 ? 'selected' : ''}" data-place-index="${index}">
      <div class="place-num">${index + 1}</div>
      <div class="place-info">
        <strong class="place-name">${place.place_name}</strong>
        <span class="place-address">
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a7 7 0 0 1 7 7c0 5.25-7 13-7 13S5 14.25 5 9a7 7 0 0 1 7-7z"/>
            <circle cx="12" cy="9" r="2.5"/>
          </svg>
          ${place.address}
        </span>
        <p class="place-desc">${place.description}</p>
        ${place.features?.length ? `
          <div class="place-features">
            ${place.features.map(f => `<span class="place-feature">${f}</span>`).join('')}
          </div>
        ` : ''}
        <div class="card-actions">
          <button type="button" class="card-action-btn share" onclick="sharePlaceToChat(${index})">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
              <polyline points="16 6 12 2 8 6"/>
              <line x1="12" y1="2" x2="12" y2="15"/>
            </svg>
            채팅방에 공유
          </button>
          <button type="button" class="card-action-btn confirm" onclick="confirmPlace(${index})">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            이 장소로 지정
          </button>
        </div>
      </div>
    </article>
  `).join("");
  
  // 카드 클릭 이벤트
  chatRecommendList.querySelectorAll("[data-place-index]").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".card-action-btn")) return;
      const index = Number(card.dataset.placeIndex);
      selectPlaceCard(index);
    });
  });
}

// 장소 카드 선택
function selectPlaceCard(index) {
  chatRecommendList.querySelectorAll(".chat-place-card").forEach(c => c.classList.remove("selected"));
  const card = chatRecommendList.querySelector(`[data-place-index="${index}"]`);
  if (card) card.classList.add("selected");
  
  const place = chatRecommendPlaces[index];
  if (place && chatRecommendMap) {
    const position = new window.kakao.maps.LatLng(place.latitude, place.longitude);
    chatRecommendMap.panTo(position);
    chatRecommendMap.setLevel(4);
    
    if (chatRecommendInfoWindows[index + 1]) {
      chatRecommendInfoWindows[index + 1].open(chatRecommendMap, chatRecommendMarkers[index + 1]);
    }
  }
}

// 장소를 채팅방에 공유
async function sharePlaceToChat(index) {
  const place = chatRecommendPlaces[index];
  if (!place || !activeRoomId) return;
  
  const message = `[AI 추천 장소] ${place.place_name} (${place.address})`;
  
  // 웹소켓으로 메시지 전송
  if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
    chatSocket.send(JSON.stringify({ 
      content: message,
      type: "ai_recommend",
      place_data: place
    }));
    
    // 로컬에도 즉시 표시
    addChatMessage(currentUser?.name || "나", message, true, "ai-recommend", place);
    
    closeAiRecommendModalFn();
  } else {
    showAppAlert("채팅 연결이 끊어졌습니다. 다시 시도해주세요.", "오류", "⚠️");
  }
}

// 공통 alert 모달
function showAppAlert(message, title = "알림", icon = "ℹ️") {
  return new Promise((resolve) => {
    const modal = document.querySelector("#appAlertModal");
    const titleEl = document.querySelector("#appAlertTitle");
    const messageEl = document.querySelector("#appAlertMessage");
    const iconEl = document.querySelector(".app-alert-icon");
    const okBtn = document.querySelector("#appAlertOk");
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    iconEl.textContent = icon;
    
    modal.style.display = "flex";
    
    const handleOk = () => {
      modal.style.display = "none";
      okBtn.removeEventListener("click", handleOk);
      resolve();
    };
    
    okBtn.addEventListener("click", handleOk);
  });
}

// 장소 확정 - 커스텀 모달 사용
function showPlaceConfirmModal(placeName, onConfirm) {
  const modal = document.querySelector("#placeConfirmModal");
  const title = document.querySelector("#placeConfirmTitle");
  const message = document.querySelector("#placeConfirmMessage");
  const cancelBtn = document.querySelector("#placeConfirmCancel");
  const okBtn = document.querySelector("#placeConfirmOk");
  
  title.textContent = `[${placeName}]을(를)`;
  message.textContent = "모임 장소로 확정하시겠습니까?";
  
  modal.style.display = "flex";
  
  const handleCancel = () => {
    modal.style.display = "none";
    cancelBtn.removeEventListener("click", handleCancel);
    okBtn.removeEventListener("click", handleOk);
  };
  
  const handleOk = () => {
    modal.style.display = "none";
    cancelBtn.removeEventListener("click", handleCancel);
    okBtn.removeEventListener("click", handleOk);
    onConfirm();
  };
  
  cancelBtn.addEventListener("click", handleCancel);
  okBtn.addEventListener("click", handleOk);
}

// 장소 확정
async function confirmPlace(index) {
  const place = chatRecommendPlaces[index];
  if (!place || !activeRoomId) return;
  
  showPlaceConfirmModal(place.place_name, async () => {
    try {
      const result = await api(`/api/meetings/${activeRoomId}/confirm-place`, {
        method: "POST",
        body: JSON.stringify({
          place_name: place.place_name,
          address: place.address,
        }),
      });
      
      // 성공 메시지 채팅방에 전송
      const confirmMessage = `모임 장소가 [${place.place_name}]으로 최종 확정되었습니다.`;
      
      if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
        chatSocket.send(JSON.stringify({ 
          content: confirmMessage,
          type: "place_confirmed",
          place_data: place
        }));
        
        addChatMessage("시스템", confirmMessage, false, "system-message");
      }
      
      closeAiRecommendModalFn();
      
    } catch (error) {
      showAppAlert("장소 확정에 실패했습니다: " + error.message, "오류", "❌");
    }
  });
}

// 지도 정리
function clearChatRecommendMap() {
  chatRecommendMarkers.forEach(m => m.setMap && m.setMap(null));
  chatRecommendInfoWindows.forEach(i => i.close && i.close());
  chatRecommendMarkers = [];
  chatRecommendInfoWindows = [];
  chatRecommendMap = null;
}

// 채팅 메시지 추가 함수 확장 (시간 포함)
const originalAddChatMessage = addChatMessage;
addChatMessage = function(sender, content, mine = false, type = "", placeData = null, time = null) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${mine ? "mine" : ""} ${type}`;
  const timeStr = time ? formatTime(time) : formatTime(new Date());
  
  if (type === "ai-recommend" && placeData) {
    bubble.innerHTML = `
      <div class="ai-badge">🤖 AI 추천</div>
      <strong>${sender}</strong>
      <div class="place-share-card">
        <div class="place-name">${placeData.place_name}</div>
        <div class="place-address">${placeData.address}</div>
        <div class="confirm-hint">이 장소로 지정하려면 메시지를 길게 눌러주세요.</div>
      </div>
      <span class="chat-time">${timeStr}</span>
    `;
    
    // 장소 확정 버튼
    bubble.addEventListener("dblclick", () => {
      confirmPlaceByData(placeData);
    });
  } else if (type === "system-message") {
    bubble.innerHTML = `<p>${content}</p><span class="chat-time">${timeStr}</span>`;
  } else {
    bubble.innerHTML = `<strong>${sender}</strong><p>${content}</p><span class="chat-time">${timeStr}</span>`;
  }
  
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
};

// 장소 데이터로 확정
async function confirmPlaceByData(placeData) {
  if (!activeRoomId || !placeData) return;
  
  if (!confirm(`[${placeData.place_name}]을(를) 모임 장소로 확정하시겠습니까?`)) return;
  
  try {
    const result = await api(`/api/meetings/${activeRoomId}/confirm-place`, {
      method: "POST",
      body: JSON.stringify({
        place_name: placeData.place_name,
        address: placeData.address,
      }),
    });
    
    const confirmMessage = `모임 장소가 [${placeData.place_name}]으로 최종 확정되었습니다.`;
    
    if (chatSocket && chatSocket.readyState === WebSocket.OPEN) {
      chatSocket.send(JSON.stringify({ 
        content: confirmMessage,
        type: "place_confirmed"
      }));
      
      addChatMessage("시스템", confirmMessage, false, "system-message");
    }
    
    alert(result.message);
    
  } catch (error) {
    alert("장소 확정에 실패했습니다: " + error.message);
  }
}

// 글로벌 함수 등록 (HTML onclick에서 사용)
window.sharePlaceToChat = sharePlaceToChat;
window.confirmPlace = confirmPlace;
