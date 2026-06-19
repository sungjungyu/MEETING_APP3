from datetime import datetime

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from auth import create_access_token, get_current_user, get_user_from_token, hash_password, verify_password
from database import AsyncSessionLocal, get_db, init_db
from gemini_recommendations import recommend_meetings_with_gemini
from models import BoardPost, ChatMessage, Interest, Meeting, MeetingApplication, MeetingSchedule, MeetingScheduleParticipant, User
from place_recommendations import router as place_recommendations_router
from schemas import (
    ApplicationCreate,
    ApplicationDecision,
    ApplicationInboxOut,
    ApplicationOut,
    BoardPostCreate,
    BoardPostOut,
    BoardPostUpdate,
    ChatMessageCreate,
    ChatMessageOut,
    MeetingCreate,
    MeetingOut,
    MeetingScheduleCreate,
    MeetingScheduleOut,
    MeetingUpdate,
    ScheduleParticipantOut,
    Token,
    UserCreate,
    UserLogin,
    UserOut,
    UserUpdate,
)

app = FastAPI(title="이음 API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")
app.include_router(place_recommendations_router)


class ConnectionManager:
    def __init__(self) -> None:
        self.rooms: dict[int, list[WebSocket]] = {}
        self.users: dict[int, WebSocket] = {}

    async def connect(self, meeting_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self.rooms.setdefault(meeting_id, []).append(websocket)

    def disconnect(self, meeting_id: int, websocket: WebSocket) -> None:
        room = self.rooms.get(meeting_id, [])
        if websocket in room:
            room.remove(websocket)

    async def broadcast(self, meeting_id: int, payload: dict) -> None:
        for connection in list(self.rooms.get(meeting_id, [])):
            await connection.send_json(payload)

    async def connect_user(self, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self.users[user_id] = websocket

    def disconnect_user(self, user_id: int) -> None:
        self.users.pop(user_id, None)

    async def notify(self, user_id: int, payload: dict) -> None:
        ws = self.users.get(user_id)
        if ws:
            try:
                await ws.send_json(payload)
            except Exception:
                self.disconnect_user(user_id)


manager = ConnectionManager()


@app.on_event("startup")
async def on_startup() -> None:
    await init_db()


@app.get("/")
async def index() -> FileResponse:
    return FileResponse("static/index.html")


async def get_or_create_interests(db: AsyncSession, names: list[str]) -> list[Interest]:
    clean_names = sorted({name.strip().lower() for name in names if name.strip()})
    if not clean_names:
        return []

    result = await db.execute(select(Interest).where(Interest.name.in_(clean_names)))
    existing = {interest.name: interest for interest in result.scalars().all()}
    interests = list(existing.values())
    for name in clean_names:
        if name not in existing:
            interest = Interest(name=name)
            db.add(interest)
            interests.append(interest)
    return interests


async def approved_member_count(db: AsyncSession, meeting_id: int) -> int:
    result = await db.execute(
        select(func.count(MeetingApplication.id)).where(
            MeetingApplication.meeting_id == meeting_id,
            MeetingApplication.status == "approved",
        )
    )
    return int(result.scalar() or 0)

async def is_approved_meeting_member(db: AsyncSession, meeting_id: int, user_id: int) -> bool:
    result = await db.execute(
        select(MeetingApplication)
        .where(
            MeetingApplication.meeting_id == meeting_id,
            MeetingApplication.user_id == user_id,
            MeetingApplication.status == "approved",
        )
    )
    return result.scalar_one_or_none() is not None


async def serialize_meeting(db: AsyncSession, meeting: Meeting) -> MeetingOut:
    data = MeetingOut.model_validate(meeting)
    data.approved_members = await approved_member_count(db, meeting.id)
    return data


@app.post("/api/auth/signup", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def signup(payload: UserCreate, db: AsyncSession = Depends(get_db)) -> User:
    result = await db.execute(select(User).where(User.email == payload.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="이미 가입된 이메일입니다.")

    user = User(
        email=payload.email,
        name=payload.name,
        bio=payload.bio,
        hashed_password=hash_password(payload.password),
    )
    # interests는 {name: ...} 형태로 들어옴
    interest_names = [i.get("name") for i in payload.interests if isinstance(i, dict) and i.get("name")]
    user.interests = await get_or_create_interests(db, interest_names)
    db.add(user)
    await db.commit()
    await db.refresh(user, attribute_names=["interests"])
    return user


@app.post("/api/auth/login", response_model=Token)
async def login(payload: UserLogin, db: AsyncSession = Depends(get_db)) -> Token:
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다.")
    return Token(access_token=create_access_token(str(user.id)))


@app.get("/api/users/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@app.patch("/api/users/me", response_model=UserOut)
async def update_me(
    payload: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> User:
    if payload.name is not None:
        current_user.name = payload.name
    if payload.bio is not None:
        current_user.bio = payload.bio
    if payload.interests is not None:
        # interests는 {name: ...} 형태로 들어옴
        interest_names = [i.get("name") for i in payload.interests if isinstance(i, dict) and i.get("name")]
        current_user.interests = await get_or_create_interests(db, interest_names)
    await db.commit()
    await db.refresh(current_user, attribute_names=["interests"])
    return current_user


@app.get("/api/applications/my", response_model=list[ApplicationInboxOut])
async def my_applications(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ApplicationInboxOut]:
    result = await db.execute(
        select(MeetingApplication)
        .where(MeetingApplication.user_id == current_user.id)
        .order_by(MeetingApplication.created_at.desc())
        .options(
            selectinload(MeetingApplication.meeting),
            selectinload(MeetingApplication.user).selectinload(User.interests),
        )
    )
    applications = result.scalars().all()
    return [
        ApplicationInboxOut(
            id=a.id,
            meeting_id=a.meeting_id,
            meeting_title=a.meeting.title,
            user=UserOut.model_validate(a.user),
            status=a.status,
            message=a.message,
            created_at=a.created_at,
        )
        for a in applications
    ]


@app.patch("/api/meetings/{meeting_id}", response_model=MeetingOut)
async def update_meeting(
    meeting_id: int,
    payload: MeetingUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MeetingOut:
    result = await db.execute(
        select(Meeting).where(Meeting.id == meeting_id).options(selectinload(Meeting.owner).selectinload(User.interests))
    )
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="모임을 찾을 수 없습니다.")
    if meeting.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="모임장만 수정할 수 있습니다.")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(meeting, field, value)
    await db.commit()
    return await serialize_meeting(db, meeting)


@app.get("/api/meetings/{meeting_id}/members/all", response_model=list[ApplicationOut])
async def list_all_members(
    meeting_id: int,
    db: AsyncSession = Depends(get_db),
) -> list[MeetingApplication]:
    result = await db.execute(
        select(MeetingApplication)
        .where(MeetingApplication.meeting_id == meeting_id, MeetingApplication.status == "approved")
        .options(selectinload(MeetingApplication.user).selectinload(User.interests))
    )
    return list(result.scalars().all())


@app.post("/api/meetings", response_model=MeetingOut, status_code=status.HTTP_201_CREATED)
async def create_meeting(
    payload: MeetingCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MeetingOut:
    meeting = Meeting(**payload.model_dump(), owner_id=current_user.id, start_at=datetime.utcnow())
    db.add(meeting)
    await db.flush()
    db.add(MeetingApplication(meeting_id=meeting.id, user_id=current_user.id, status="approved"))
    # 모임 생성하면 게시글도 자동 등록
    post = BoardPost(
        meeting_id=meeting.id,
        author_id=current_user.id,
        title=meeting.title,
        content=meeting.description,
    )
    db.add(post)
    await db.commit()

    result = await db.execute(
        select(Meeting).where(Meeting.id == meeting.id).options(selectinload(Meeting.owner).selectinload(User.interests))
    )
    return await serialize_meeting(db, result.scalar_one())


@app.get("/api/meetings", response_model=list[MeetingOut])
async def list_meetings(db: AsyncSession = Depends(get_db)) -> list[MeetingOut]:
    result = await db.execute(
        select(Meeting)
        .order_by(Meeting.created_at.desc())
        .options(selectinload(Meeting.owner).selectinload(User.interests))
    )
    return [await serialize_meeting(db, meeting) for meeting in result.scalars().all()]


@app.get("/api/meetings/recommendations", response_model=list[MeetingOut])
async def recommend_meetings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[MeetingOut]:
    joined = await db.execute(
        select(MeetingApplication.meeting_id).where(
            MeetingApplication.user_id == current_user.id,
            MeetingApplication.status == "approved",
        )
    )
    joined_ids = set(joined.scalars().all())

    result = await db.execute(
        select(Meeting)
        .where(
            Meeting.start_at >= datetime.utcnow(),
            Meeting.owner_id != current_user.id,
        )
        .options(selectinload(Meeting.owner).selectinload(User.interests))
    )
    candidates = [m for m in result.scalars().all() if m.id not in joined_ids]

    ranked = await recommend_meetings_with_gemini(current_user, candidates, limit=8)
    return [await serialize_meeting(db, meeting) for meeting in ranked]


@app.post("/api/meetings/{meeting_id}/apply", response_model=ApplicationOut, status_code=status.HTTP_201_CREATED)
async def apply_to_meeting(
    meeting_id: int,
    payload: ApplicationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MeetingApplication:
    meeting = await db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="모임을 찾을 수 없습니다.")

    count = await approved_member_count(db, meeting_id)
    if count >= meeting.max_members:
        raise HTTPException(status_code=400, detail="모집 인원이 이미 마감되었습니다.")

    application = MeetingApplication(meeting_id=meeting_id, user_id=current_user.id, message=payload.message)
    db.add(application)
    try:
        await db.commit()
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="이미 신청한 모임입니다.") from exc

    result = await db.execute(
        select(MeetingApplication)
        .where(MeetingApplication.id == application.id)
        .options(selectinload(MeetingApplication.user).selectinload(User.interests))
    )
    saved = result.scalar_one()
    # 모임장에게 신청 알림 보내기
    await manager.notify(meeting.owner_id, {
        "type": "new_application",
        "message": f"{current_user.name}님이 '{meeting.title}' 모임에 참여 신청했습니다.",
        "meeting_id": meeting_id,
        "meeting_title": meeting.title,
    })
    return saved


@app.get("/api/applications/inbox", response_model=list[ApplicationInboxOut])
async def application_inbox(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ApplicationInboxOut]:
    result = await db.execute(
        select(MeetingApplication)
        .join(Meeting, MeetingApplication.meeting_id == Meeting.id)
        .where(Meeting.owner_id == current_user.id, MeetingApplication.user_id != current_user.id)
        .order_by(MeetingApplication.created_at.desc())
        .options(
            selectinload(MeetingApplication.meeting),
            selectinload(MeetingApplication.user).selectinload(User.interests),
        )
    )
    applications = result.scalars().all()
    return [
        ApplicationInboxOut(
            id=application.id,
            meeting_id=application.meeting_id,
            meeting_title=application.meeting.title,
            user=UserOut.model_validate(application.user),
            status=application.status,
            message=application.message,
            created_at=application.created_at,
        )
        for application in applications
    ]


@app.patch("/api/applications/{application_id}", response_model=ApplicationOut)
async def decide_application(
    application_id: int,
    payload: ApplicationDecision,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MeetingApplication:
    result = await db.execute(
        select(MeetingApplication)
        .where(MeetingApplication.id == application_id)
        .options(
            selectinload(MeetingApplication.meeting),
            selectinload(MeetingApplication.user).selectinload(User.interests),
        )
    )
    application = result.scalar_one_or_none()
    if not application:
        raise HTTPException(status_code=404, detail="신청 내역을 찾을 수 없습니다.")
    if application.meeting.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="모임장만 승인/거절할 수 있습니다.")
    if payload.status == "approved":
        count = await approved_member_count(db, application.meeting_id)
        if count >= application.meeting.max_members:
            raise HTTPException(status_code=400, detail="모집 인원이 이미 마감되었습니다.")

    application.status = payload.status
    await db.commit()
    await db.refresh(application)
    # 신청자에게 결과 알림 보내기
    status_label = "승인" if payload.status == "approved" else "거절"
    await manager.notify(application.user_id, {
        "type": "application",
        "message": f"'{application.meeting.title}' 모임 참여 신청이 {status_label}되었습니다.",
        "status": payload.status,
        "meeting_id": application.meeting_id,
        "meeting_title": application.meeting.title,
    })
    return application


@app.delete("/api/meetings/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_meeting(
    meeting_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    meeting = await db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="모임을 찾을 수 없습니다.")
    if meeting.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="모임장만 삭제할 수 있습니다.")
    from sqlalchemy import delete as sql_delete
    await db.execute(sql_delete(ChatMessage).where(ChatMessage.meeting_id == meeting_id))
    await db.execute(sql_delete(BoardPost).where(BoardPost.meeting_id == meeting_id))
    await db.execute(sql_delete(MeetingApplication).where(MeetingApplication.meeting_id == meeting_id))
    await db.delete(meeting)
    await db.commit()


@app.get("/api/meetings/{meeting_id}/members", response_model=list[ApplicationOut])
async def list_members(
    meeting_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[MeetingApplication]:
    meeting = await db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="모임을 찾을 수 없습니다.")
    if meeting.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="모임장만 참여인원을 관리할 수 있습니다.")
    result = await db.execute(
        select(MeetingApplication)
        .where(MeetingApplication.meeting_id == meeting_id, MeetingApplication.status == "approved")
        .options(selectinload(MeetingApplication.user).selectinload(User.interests))
    )
    return list(result.scalars().all())


@app.delete("/api/meetings/{meeting_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    meeting_id: int,
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    meeting = await db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="모임을 찾을 수 없습니다.")
    if meeting.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="모임장만 참여인원을 관리할 수 있습니다.")
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="모임장은 강퇴할 수 없습니다.")
    result = await db.execute(
        select(MeetingApplication).where(
            MeetingApplication.meeting_id == meeting_id,
            MeetingApplication.user_id == user_id,
        )
    )
    application = result.scalar_one_or_none()
    if not application:
        raise HTTPException(status_code=404, detail="해당 참여자를 찾을 수 없습니다.")
    await db.delete(application)
    await db.commit()


@app.post("/api/posts", response_model=BoardPostOut, status_code=status.HTTP_201_CREATED)
async def create_post(
    payload: BoardPostCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BoardPost:
    if payload.meeting_id is not None:
        meeting = await db.get(Meeting, payload.meeting_id)
        if not meeting:
            raise HTTPException(status_code=404, detail="모임을 찾을 수 없습니다.")
        if not await is_approved_meeting_member(db, payload.meeting_id, current_user.id):
            raise HTTPException(status_code=403, detail="모임에 속한 멤버만 게시글을 작성할 수 있습니다.")

    post = BoardPost(**payload.model_dump(), author_id=current_user.id)
    db.add(post)
    await db.commit()
    result = await db.execute(
        select(BoardPost)
        .where(BoardPost.id == post.id)
        .options(selectinload(BoardPost.author).selectinload(User.interests))
    )
    return result.scalar_one()


@app.get("/api/posts", response_model=list[BoardPostOut])
async def list_posts(db: AsyncSession = Depends(get_db)) -> list[BoardPost]:
    result = await db.execute(
        select(BoardPost)
        .order_by(BoardPost.created_at.desc())
        .options(selectinload(BoardPost.author).selectinload(User.interests))
    )
    return list(result.scalars().all())


@app.get("/api/meetings/{meeting_id}/posts", response_model=list[BoardPostOut])
async def list_meeting_posts(meeting_id: int, db: AsyncSession = Depends(get_db)) -> list[BoardPost]:
    result = await db.execute(
        select(BoardPost)
        .where(BoardPost.meeting_id == meeting_id)
        .order_by(BoardPost.created_at.desc())
        .options(selectinload(BoardPost.author).selectinload(User.interests))
    )
    return list(result.scalars().all())


@app.post("/api/meetings/{meeting_id}/schedules", response_model=MeetingScheduleOut, status_code=status.HTTP_201_CREATED)
async def create_meeting_schedule(
    meeting_id: int,
    payload: MeetingScheduleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MeetingSchedule:
    meeting = await db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="모임을 찾을 수 없습니다.")
    if meeting.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="모임장만 일정을 추가할 수 있습니다.")
    schedule = MeetingSchedule(meeting_id=meeting.id, **payload.model_dump())
    db.add(schedule)
    await db.commit()
    result = await db.execute(
        select(MeetingSchedule).where(MeetingSchedule.id == schedule.id)
    )
    return result.scalar_one()


@app.get("/api/meetings/{meeting_id}/schedules", response_model=list[MeetingScheduleOut])
async def list_meeting_schedules(meeting_id: int, db: AsyncSession = Depends(get_db)) -> list[MeetingSchedule]:
    result = await db.execute(
        select(MeetingSchedule)
        .where(MeetingSchedule.meeting_id == meeting_id)
        .order_by(MeetingSchedule.scheduled_at)
    )
    return list(result.scalars().all())


@app.get("/api/schedules/{schedule_id}/participants", response_model=list[ScheduleParticipantOut])
async def list_schedule_participants(schedule_id: int, db: AsyncSession = Depends(get_db)) -> list[MeetingScheduleParticipant]:
    result = await db.execute(
        select(MeetingScheduleParticipant)
        .where(MeetingScheduleParticipant.schedule_id == schedule_id)
        .order_by(MeetingScheduleParticipant.created_at)
        .options(selectinload(MeetingScheduleParticipant.user).selectinload(User.interests))
    )
    return list(result.scalars().all())


@app.post("/api/schedules/{schedule_id}/join", response_model=ScheduleParticipantOut, status_code=status.HTTP_201_CREATED)
async def join_schedule(
    schedule_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MeetingScheduleParticipant:
    schedule = await db.get(MeetingSchedule, schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="일정을 찾을 수 없습니다.")
    if not await is_approved_meeting_member(db, schedule.meeting_id, current_user.id):
        raise HTTPException(status_code=403, detail="모임 멤버만 일정에 참여할 수 있습니다.")
    result = await db.execute(
        select(MeetingScheduleParticipant).where(
            MeetingScheduleParticipant.schedule_id == schedule_id,
            MeetingScheduleParticipant.user_id == current_user.id,
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="이미 이 일정에 참여 신청되어 있습니다.")
    count_result = await db.execute(
        select(func.count(MeetingScheduleParticipant.id)).where(MeetingScheduleParticipant.schedule_id == schedule_id)
    )
    joined_count = int(count_result.scalar() or 0)
    if joined_count >= schedule.capacity:
        raise HTTPException(status_code=400, detail="이 일정은 이미 정원이 꽉 찼습니다.")
    participant = MeetingScheduleParticipant(schedule_id=schedule_id, user_id=current_user.id)
    db.add(participant)
    await db.commit()
    await db.refresh(participant)
    return participant


@app.get("/api/my-posts", response_model=list[BoardPostOut])
async def my_posts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[BoardPostOut]:
    result = await db.execute(
        select(BoardPost)
        .where(BoardPost.author_id == current_user.id)
        .order_by(BoardPost.created_at.desc())
        .options(selectinload(BoardPost.author).selectinload(User.interests), selectinload(BoardPost.meeting))
    )
    posts = result.scalars().all()
    out = []
    for post in posts:
        data = BoardPostOut.model_validate(post)
        data.meeting_title = post.meeting.title if post.meeting else None
        out.append(data)
    return out


@app.patch("/api/posts/{post_id}", response_model=BoardPostOut)
async def update_post(
    post_id: int,
    payload: BoardPostUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BoardPost:
    result = await db.execute(
        select(BoardPost).where(BoardPost.id == post_id).options(selectinload(BoardPost.author).selectinload(User.interests))
    )
    post = result.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
    if post.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="작성자만 수정할 수 있습니다.")
    if payload.title is not None:
        post.title = payload.title
    if payload.content is not None:
        post.content = payload.content
    await db.commit()
    await db.refresh(post)
    return post


@app.delete("/api/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_post(
    post_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    post = await db.get(BoardPost, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
    if post.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="작성자만 삭제할 수 있습니다.")
    await db.delete(post)
    await db.commit()


@app.get("/api/calendar", response_model=list[MeetingOut])
async def calendar(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[MeetingOut]:
    result = await db.execute(
        select(Meeting)
        .join(MeetingApplication, MeetingApplication.meeting_id == Meeting.id)
        .where(MeetingApplication.user_id == current_user.id, MeetingApplication.status == "approved")
        .order_by(Meeting.start_at)
        .options(selectinload(Meeting.owner).selectinload(User.interests))
    )
    return [await serialize_meeting(db, meeting) for meeting in result.scalars().all()]


@app.get("/api/my-meetings", response_model=list[MeetingOut])
async def my_meetings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[MeetingOut]:
    result = await db.execute(
        select(Meeting)
        .join(MeetingApplication, MeetingApplication.meeting_id == Meeting.id)
        .where(MeetingApplication.user_id == current_user.id, MeetingApplication.status == "approved")
        .order_by(Meeting.created_at.desc())
        .options(selectinload(Meeting.owner).selectinload(User.interests))
    )
    return [await serialize_meeting(db, meeting) for meeting in result.scalars().all()]


@app.post("/api/meetings/{meeting_id}/messages", response_model=ChatMessageOut, status_code=status.HTTP_201_CREATED)
async def create_message(
    meeting_id: int,
    payload: ChatMessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ChatMessage:
    message = ChatMessage(meeting_id=meeting_id, sender_id=current_user.id, content=payload.content)
    db.add(message)
    await db.commit()
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.id == message.id)
        .options(selectinload(ChatMessage.sender).selectinload(User.interests))
    )
    saved_message = result.scalar_one()
    await manager.broadcast(
        meeting_id,
        {
            "id": saved_message.id,
            "sender": saved_message.sender.name,
            "content": saved_message.content,
            "created_at": saved_message.created_at.isoformat(),
        },
    )
    return saved_message


@app.get("/api/meetings/{meeting_id}/messages", response_model=list[ChatMessageOut])
async def list_messages(meeting_id: int, db: AsyncSession = Depends(get_db)) -> list[ChatMessage]:
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.meeting_id == meeting_id)
        .order_by(ChatMessage.created_at)
        .options(selectinload(ChatMessage.sender).selectinload(User.interests))
    )
    return list(result.scalars().all())


@app.post("/api/seed-daejeon", response_model=dict)
async def seed_daejeon_data_endpoint(db: AsyncSession = Depends(get_db)) -> dict:
    """대전 서구 데모 데이터 생성 엔드포인트"""
    from seed_data import seed_daejeon_data
    await seed_daejeon_data(db)
    return {"message": "대전 서구 시연 데이터가 생성되었습니다."}


@app.websocket("/ws/notify")
async def notify_ws(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token")
    user_id: int | None = None
    async with AsyncSessionLocal() as db:
        try:
            user = await get_user_from_token(token, db)
            user_id = user.id
        except HTTPException:
            await websocket.close()
            return
    await manager.connect_user(user_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect_user(user_id)


@app.websocket("/ws/meetings/{meeting_id}/chat")
async def meeting_chat(websocket: WebSocket, meeting_id: int) -> None:
    await manager.connect(meeting_id, websocket)
    token = websocket.query_params.get("token")
    try:
        while True:
            payload = await websocket.receive_json()
            content = str(payload.get("content", "")).strip()
            if not content:
                continue

            async with AsyncSessionLocal() as db:
                user: User | None = None
                if token:
                    try:
                        user = await get_user_from_token(token, db)
                    except HTTPException:
                        user = None

                meeting = await db.get(Meeting, meeting_id)
                saved_message: ChatMessage | None = None
                if user and meeting:
                    saved_message = ChatMessage(meeting_id=meeting_id, sender_id=user.id, content=content)
                    db.add(saved_message)
                    await db.commit()
                    await db.refresh(saved_message)

                await manager.broadcast(
                    meeting_id,
                    {
                        "id": saved_message.id if saved_message else None,
                        "sender": user.name if user else payload.get("sender", "게스트"),
                        "content": content,
                        "created_at": (
                            saved_message.created_at.isoformat()
                            if saved_message
                            else datetime.utcnow().isoformat()
                        ),
                    },
                )
    except WebSocketDisconnect:
        manager.disconnect(meeting_id, websocket)


# 채팅방용 장소 추천/확정

class ChatRoomPlaceRecommendationRequest(BaseModel):
    meeting_id: int
    meeting_title: str = Field(min_length=2, max_length=120)
    meeting_category: str = Field(min_length=2, max_length=50)
    meeting_description: str = Field(min_length=5)
    meeting_location: str = Field(min_length=2, max_length=120)
    keywords: list[str] = Field(default_factory=list, max_length=12)
    limit: int = Field(default=5, ge=1, le=10)


class PlaceConfirmRequest(BaseModel):
    place_name: str = Field(min_length=2, max_length=120)
    address: str = Field(min_length=5)




@app.post("/api/meetings/{meeting_id}/confirm-place")
async def confirm_meeting_place(
    meeting_id: int,
    payload: PlaceConfirmRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """모임 장소 확정하면 location 갱신"""
    # 모임 조회
    meeting = await db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="모임을 찾을 수 없습니다.",
        )
    
    # 권한 확인 (모임장 또는 멤버)
    is_owner = meeting.owner_id == current_user.id
    membership = await db.execute(
        select(MeetingApplication)
        .where(
            MeetingApplication.meeting_id == meeting_id,
            MeetingApplication.user_id == current_user.id,
            MeetingApplication.status == "approved",
        )
    )
    is_member = membership.scalar_one_or_none() is not None
    
    if not (is_owner or is_member):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="해당 모임의 멤버만 장소를 확정할 수 있습니다.",
        )
    
    # 장소 확정 반영
    meeting.location = f"{payload.place_name} ({payload.address})"
    await db.commit()
    
    return {
        "success": True,
        "meeting_id": meeting_id,
        "confirmed_place": payload.place_name,
        "address": payload.address,
        "message": f"모임 장소가 [{payload.place_name}]으로 확정되었습니다.",
    }


@app.get("/api/meetings/{meeting_id}/info")
async def get_meeting_info_for_chat(
    meeting_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """채팅방용 모임 정보 조회"""
    # 멤버십 확인
    membership = await db.execute(
        select(MeetingApplication)
        .where(
            MeetingApplication.meeting_id == meeting_id,
            MeetingApplication.user_id == current_user.id,
            MeetingApplication.status == "approved",
        )
    )
    if not membership.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="해당 모임의 멤버만 접근할 수 있습니다.",
        )
    
    meeting = await db.get(Meeting, meeting_id)
    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="모임을 찾을 수 없습니다.",
        )
    
    return {
        "id": meeting.id,
        "title": meeting.title,
        "category": meeting.category,
        "description": meeting.description,
        "location": meeting.location,
        "max_members": meeting.max_members,
        "keywords": [],  # 필요하면 keywords 추가
    }
