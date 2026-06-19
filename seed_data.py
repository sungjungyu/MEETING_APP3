"""대전 서구 데모용 데이터 생성 스크립트"""

import random
from datetime import datetime, timedelta
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from database import hash_password
from models import User, Meeting, MeetingApplication, BoardPost, Interest, MeetingSchedule


# 대전 서구 모임 데이터
DAEJEON_SEOGU_MEETINGS = [
    {
        "title": "둔산동 카페 투어 ☕️",
        "category": "문화/여가",
        "description": "대전 둔산동의 인기 카페들을 함께 탐방해요! 감성 카페에서 커피 마시며 이야기 나누는 모임입니다. 초보자 환영!",
        "location": "대전광역시 서구 둔산동 카페거리",
        "max_members": 6,
    },
    {
        "title": "둔산공원 러닝 크루 🏃‍♂️",
        "category": "운동/스포츠",
        "description": "아침 7시 둔산공원에서 함께 달려요. 5km 완주 목표! 초보도 환영합니다. 일주일에 2번 정규 러닝 모임",
        "location": "대전광역시 서구 둔산공원 주차장 앞",
        "max_members": 10,
    },
    {
        "title": "대전역 근처 보드게임 모임 🎲",
        "category": "문화/여가",
        "description": "보드게임 좋아하는 분들 모여요! 대전역 근처 게임 카페에서 다양한 게임 함께 즐깁니다. 게임 규칙 설명도 해드려요",
        "location": "대전광역시 서구 대전역 보드게임 카페",
        "max_members": 8,
    },
    {
        "title": "탄방동 코딩 스터디 💻",
        "category": "공부/자기계발",
        "description": "파이썬/자바스크립트 함께 공부해요! 주니어 개발자들의 성장을 위한 스터디. 매주 문제 풀이 + 프로젝트 진행",
        "location": "대전광역시 서구 탄방동 스터디 카페",
        "max_members": 5,
    },
    {
        "title": "월평동 독서 모임 📚",
        "category": "공부/자기계발",
        "description": "한 달에 한 권, 깊이 있는 독서 토론. 이번 달 선정 도서: 'Atomic Habits'. 책과 관련 없는 이야기도 환영!",
        "location": "대전광역시 서구 월평동 도서관 카페",
        "max_members": 8,
    },
    {
        "title": "관저동 등산 동호회 ⛰️",
        "category": "운동/스포츠",
        "description": "대전 근교 산들을 함께 오릅니다. 이번 주말 계족산 등산 예정! 초보자도 쉽게 따라올 수 있는 코스",
        "location": "대전광역시 서구 관저동 출발 (카풀 가능)",
        "max_members": 12,
    },
    {
        "title": "복수동 요가 클래스 🧘‍♀️",
        "category": "운동/스포츠",
        "description": "매주 화요일 저녁 요가 함께해요. 초보자 환영! 소도구 제공됩니다. 바른 자세와 유연성 기르기",
        "location": "대전광역시 서구 복수동 요가 스튜디오",
        "max_members": 8,
    },
    {
        "title": "둔산동 맛집 탐방 🍽️",
        "category": "문화/여가",
        "description": "대전 둔산동 숨은 맛집을 찾아다녀요. 이번 주 테마: 일식집 투어. 4만원 내외 예상, 골고루 나눠서 결제",
        "location": "대전광역시 서구 둔산동 (집결 후 이동)",
        "max_members": 6,
    },
    {
        "title": "도마동 영화 감상회 🎬",
        "category": "문화/여가",
        "description": "cgv 대전터미널에서 최신 영화 보고 같이 감상평 나눠요. 팝콘+음료 포함! 영화 좋아하는 분들 모여요",
        "location": "대전광역시 서구 도마동 CGV 대전터미널",
        "max_members": 6,
    },
    {
        "title": "용문동 사진 산책 📸",
        "category": "음악/예술",
        "description": "대전의 숨은 명소에서 사진 찍어요. 스마트폰 카메라로도 충분! 인스타 감성 사진 팁 공유",
        "location": "대전광역시 서구 용문동 성심당 근처",
        "max_members": 8,
    },
    {
        "title": "창업자 네트워킹 밋업 🤝",
        "category": "공부/자기계발",
        "description": "대전에서 창업 준비 중이거나 창업한 분들의 교류 모임. 서로의 아이디어 공유하고 피드백 받아요",
        "location": "대전광역시 서구 둔산동 공유오피스",
        "max_members": 15,
    },
    {
        "title": "외국인 친구 언어교환 🌍",
        "category": "사교/인맥",
        "description": "한국어-영어 언어교환 모임. 한국인과 외국인이 함께 모여 자연스럽게 언어를 교환해요. 카페에서 가볍게",
        "location": "대전광역시 서구 탄방동 글로벌 카페",
        "max_members": 10,
    },
    {
        "title": "반려견 산책 모임 🐕",
        "category": "반려동물",
        "description": "둔산공원에서 강아지들과 함께 산책해요. 중형견 위주이며 사교성 좋은 강아지들 모여요. 견주 친구도 만들어요",
        "location": "대전광역시 서구 둔산공원 잔디광장",
        "max_members": 8,
    },
    {
        "title": "주니어 개발자 멘토링 👨‍🏫",
        "category": "공부/자기계발",
        "description": "시니어 개발자가 주니어들의 고민을 들어줍니다. 커리어 고민, 기술 스택 선택, 포트폴리오 리뷰 등",
        "location": "대전광역시 서구 둔산동 IT 기업 오피스",
        "max_members": 6,
    },
    {
        "title": "주말 브런치 모임 🥞",
        "category": "문화/여가",
        "description": "바쁜 주중을 보내고 주말 아침 여유롭게 브런치 먹으며 이야기 나눠요. 30대 직장인들 모임",
        "location": "대전광역시 서구 월평동 브런치 카페",
        "max_members": 6,
    },
    {
        "title": "노래방 번개 🎤",
        "category": "음악/예술",
        "description": "즉석에서 노래방 모임! 코노가 아닌 일반 노래방에서 함께 불러요. 장르 불문, 신나게 부르는 모임",
        "location": "대전광역시 서구 탄방동 코인노래방",
        "max_members": 6,
    },
    {
        "title": "봉사활동 - 유기견 쉼터 🐾",
        "category": "봉사활동",
        "description": "대전 유기견 쉼터에서 봉사활동해요. 산책, 목욕, 청소 도움. 동물 사랑하는 분들 모여요",
        "location": "대전광역시 서구 유기견 쉼터",
        "max_members": 8,
    },
    {
        "title": "주식/투자 스터디 📈",
        "category": "공부/자기계발",
        "description": "주식 초보자들의 공부 모임. 기초 개념부터 차근차근. 투자는 본인 책임! 정보 공유 목적",
        "location": "대전광역시 서구 둔산동 스터디룸",
        "max_members": 8,
    },
    {
        "title": "대전 야경 투어 🌃",
        "category": "문화/여가",
        "description": "대전의 아름다운 야경을 함께 봐요. 식장산 전망대, 엑스포 다리 등 명소 투어. 사진 찍기 좋은 코스",
        "location": "대전광역시 서구 둔산동 출발 (차량 공유)",
        "max_members": 8,
    },
    {
        "title": "수제맥주 맛집 투어 🍺",
        "category": "문화/여가",
        "description": "대전 수제맥주 맛집을 찾아다녀요. 맥주 초보도 괜찮습니다. 안주도 함께 즐겨요 (20세 이상 성인만)",
        "location": "대전광역시 서구 둔산동 수제맥주 펍",
        "max_members": 6,
    },
]

# 테스트 유저
TEST_USERS = [
    {
        "name": "김대전",
        "email": "daejeon1@test.com",
        "password": "test1234",
        "bio": "대전 서구에 사는 직장인입니다. 카페와 맛집 탐방을 좋아해요!",
        "region": "대전 서구",
        "interests": ["카페", "맛집"],
    },
    {
        "name": "이둔산",
        "email": "daejeon2@test.com",
        "password": "test1234",
        "bio": "러닝과 등산을 사랑하는 대전러입니다. 함께 뛰어요!",
        "region": "대전 서구",
        "interests": ["러닝/마라톤", "등산"],
    },
    {
        "name": "박코딩",
        "email": "daejeon3@test.com",
        "password": "test1234",
        "bio": "개발자 3년차. 스터디와 네트워킹을 찾고 있어요",
        "region": "대전 서구",
        "interests": ["코딩", "스터디"],
    },
    {
        "name": "최독서",
        "email": "daejeon4@test.com",
        "password": "test1234",
        "bio": "책과 커피가 있는 삶. 독서 모임 오래 참여 중입니다",
        "region": "대전 서구",
        "interests": ["독서", "카페"],
    },
    {
        "name": "정사진",
        "email": "daejeon5@test.com",
        "password": "test1234",
        "bio": "사진 찍는 것을 좋아하는 대학생입니다. 인스타 @daejeon_pic",
        "region": "대전 서구",
        "interests": ["사진", "여행"],
    },
]


async def seed_daejeon_data(session: AsyncSession) -> None:
    """대전 서구 데모 데이터 생성"""
    from database import get_or_create_interests
    
    # 기존 모임 개수 확인
    result = await session.execute(select(func.count(Meeting.id)))
    meeting_count = int(result.scalar_one() or 0)
    if meeting_count > 20:
        print("✓ 이미 충분한 모임 데이터가 있습니다.")
        return
    
    print("=" * 50)
    print("🌟 대전광역시 서구 시연 데이터 생성")
    print("=" * 50)
    
    # 테스트 유저 생성
    print("\n📌 테스트 유저 생성 중...")
    users = []
    for user_data in TEST_USERS:
        # 기존 유저 확인
        existing = await session.execute(
            select(User).where(User.email == user_data["email"])
        )
        existing_user = existing.scalar_one_or_none()
        if existing_user:
            print(f"✓ 유저 이미 존재: {user_data['email']}")
            users.append(existing_user)
            continue

        # 관심사 먼저 생성/조회
        interests = await get_or_create_interests(session, user_data["interests"])
        
        user = User(
            name=user_data["name"],
            email=user_data["email"],
            hashed_password=hash_password(user_data["password"]),
            bio=user_data["bio"],
            interests=interests,
        )
        session.add(user)
        users.append(user)
        print(f"✓ 유저 생성: {user.name} ({user.email})")
    
    await session.commit()
    
    if not users:
        result = await session.execute(select(User).limit(5))
        users = result.scalars().all()
    
    # 대전 서구 모임 생성
    print("\n📌 대전 서구 모임 생성 중...")
    now = datetime.utcnow()
    
    for i, meeting_data in enumerate(DAEJEON_SEOGU_MEETINGS):
        owner = users[i % len(users)]
        
        # 모임 시간 설정
        days_offset = (i % 14) + 1
        hour = 9 + (i % 12)
        start_at = now + timedelta(days=days_offset, hours=hour - now.hour)
        end_at = start_at + timedelta(hours=2 + (i % 4))
        
        meeting = Meeting(
            title=meeting_data["title"],
            description=meeting_data["description"],
            category=meeting_data["category"],
            location=meeting_data["location"],
            max_members=meeting_data["max_members"],
            start_at=start_at,
            end_at=end_at,
            owner_id=owner.id,
        )
        session.add(meeting)
        await session.flush()
        
        # 일정 생성
        schedule = MeetingSchedule(
            meeting_id=meeting.id,
            location=meeting_data["location"],
            scheduled_at=start_at,
            activity=meeting_data["title"],
            capacity=meeting_data["max_members"],
            settings="자유로운 분위기에서 즐겁게 모임 진행",
        )
        session.add(schedule)
        
        # 참가자 추가
        num_participants = random.randint(1, meeting_data["max_members"] - 1)
        other_users = [u for u in users if u.id != owner.id]
        if other_users:
            participants = random.sample(
                other_users,
                min(num_participants, len(other_users))
            )
            for participant in participants:
                application = MeetingApplication(
                    meeting_id=meeting.id,
                    user_id=participant.id,
                    message=f"{meeting_data['category']} 모임 참여하고 싶습니다!",
                    status="approved",
                )
                session.add(application)
        
        print(f"✓ 모임: {meeting.title}")
    
    await session.commit()
    
    # 게시글 생성
    print("\n📌 게시글 생성 중...")
    posts_data = [
        {"title": "대전 서구 추천 카페 모음 🗺️", "content": "둔산동: 카페 봄봄, 카페 미뉴트\n탄방동: 블랙업, 테라로사\n월평동: 로우키, 네스트\n\n다들 아는 곳 있으면 댓글로 공유해주세요!"},
        {"title": "둔산공원 러닝 코스 추천", "content": "초보자용: 주차장 → 음악분수 → 주차장 (약 3km)\n중급자용: 한 바퀴 + 둔산연못 (약 5km)\n\n아침 6-7시가 사람 적고 뛰기 좋아요!"},
        {"title": "대전 서구 맛집 리스트", "content": "일식: 스시소라 (둔산동)\n한식: 할매순대국 (탄방동)\n양식: 라 Pasta (월평동)\n중식: 만리장성 (도마동)\n\n검증된 맛집들입니다!"},
        {"title": "이번 주말 둔산공원 벚꽃 개화 현황 🌸", "content": "오늘 다녀왔는데 70% 정도 개화했습니다. 다음 주 주말이 절정일 것 같아요. 사진 찍으러 오세요!"},
        {"title": "개발자 모임 후기", "content": "어제 탄방동에서 진행한 코딩 스터디 후기입니다. 파이썬 알고리즘 3문제 풀었고, 다음주까지 개인 프로젝트 진행하기로 했습니다. 참여해주신 분들 감사합니다!"},
    ]
    
    for i, post_data in enumerate(posts_data):
        author = users[i % len(users)]
        post = BoardPost(
            author_id=author.id,
            title=post_data["title"],
            content=post_data["content"],
        )
        session.add(post)
        print(f"✓ 게시글: {post.title}")
    
    await session.commit()
    
    print("\n" + "=" * 50)
    print("✅ 대전 서구 시연 데이터 생성 완료!")
    print("=" * 50)
    print("\n📊 생성된 데이터:")
    print(f"   • 테스트 유저: {len(TEST_USERS)}명")
    print(f"   • 대전 서구 모임: {len(DAEJEON_SEOGU_MEETINGS)}개")
    print(f"   • 게시글: {len(posts_data)}개")
    print("\n💡 로그인 정보:")
    print("   이메일: daejeon1@test.com ~ daejeon5@test.com")
    print("   비밀번호: test1234")


async def main():
    """직접 실행 시 안내 메시지 출력"""
    import asyncio
    import sys
    print("=" * 60)
    print("🌟 대전광역시 서구 시연 데이터 생성")
    print("=" * 60)
    print("\n이 스크립트는 서버 실행 후 API 엔드포인트를 통해 데이터를 생성합니다.")
    print("\n사용 방법:")
    print("  1. 터미널 1에서 서버 실행:")
    print("     uvicorn main:app --reload")
    print("\n  2. 터미널 2에서 이 스크립트 실행:")
    print("     python seed_data.py")
    print("     또는 브라우저에서 접속:")
    print("     http://localhost:8000/api/seed-daejeon")
    print("\n  3. 또는 seed_data_simple.py 사용:")
    print("     python seed_data_simple.py")
    sys.exit(0)


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
